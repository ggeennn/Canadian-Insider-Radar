/**
 * src/core/analyzer.js (v9.6 - Detail Capture)
 * [Fix] Ignores Type 56 (Grants). Captures precise Date/Price details per insider.
 */
import { Parser } from '../utils/parser.js';
import { MarketContextFactory } from '../services/market_data/market_context_factory.js';
import { SCORING_CONFIG } from '../config/scoring.js';
import { NewsService } from '../services/news/news_service.js';
import { LLMService } from '../services/llm/llm_service.js';

const newsService = new NewsService();
const llmService = new LLMService();

export class Analyzer {
    
    static _groupByTicker(records) { 
        return records.reduce((acc, r) => { 
            const t = r.symbol || r.raw.symbol; 
            (acc[t] = acc[t] || []).push(r); 
            return acc; 
        }, {}); 
    }
    
    static _groupByInsider(records) { 
        return records.reduce((acc, r) => { 
            const n = r.raw.insider_name; 
            (acc[n] = acc[n] || []).push(r); 
            return acc; 
        }, {}); 
    }

    static async analyze(records, watchlist = new Set()) {
        const uniqueMap = new Map();
        records.forEach(r => uniqueMap.set(r.raw.sedi_transaction_id, r));
        const uniqueRecords = Array.from(uniqueMap.values());
        const tickerGroups = this._groupByTicker(uniqueRecords);
        const allSignals = [];

        for (const ticker in tickerGroups) {
            const tickerRecords = tickerGroups[ticker];
            const tickerSignals = await this._analyzeTicker(ticker, tickerRecords, watchlist);
            if (tickerSignals && tickerSignals.length > 0) allSignals.push(...tickerSignals);
        }
        return allSignals.sort((a, b) => b.score - a.score);
    }

    static async _analyzeTicker(ticker, records, watchlist) {
        const insiderGroups = this._groupByInsider(records);
        const insiderSignals = [];
        const buyingSignals = []; 
        const planSignals = []; 

        const firstRecord = records[0];
        const companyName = firstRecord.raw.issuer_name || firstRecord.raw.issuer || null;
        
        // Extract Issuer Link
        const issuerNum = firstRecord.raw.issuer_number || firstRecord.raw.issuer_num;
        const sediLink = issuerNum ? `https://ceo.ca/content/sedi/issuers/${issuerNum}` : "N/A";
        // --- Stage 1: Market Data ---
        let marketContext = null;
        try {
            const provider = MarketContextFactory.getProvider();
            marketContext = await provider.getMarketContext(ticker);
        } catch (e) {}

        // --- Stage 2: Evaluate Insiders ---
        for (const insiderName in insiderGroups) {
            const iRecords = insiderGroups[insiderName];
            const signal = this._evaluateInsider(ticker, insiderName, iRecords, watchlist.has(ticker), marketContext);
            
            if (signal) {
            // Only pass if score > 0 and net buy > 0
                if (signal.score > 0 && signal.netCashInvested > 0) {
                    insiderSignals.push(signal);
                    
                    if (signal.netCashInvested > 3000 || signal.score > 15) {
                        buyingSignals.push(signal);
                        if (signal.reasons.some(r => r.includes("Auto-Plan"))) {
                            planSignals.push(signal);
                        }
                    }
                } 
                else if (watchlist.has(ticker)) {
                    insiderSignals.push(signal);
                }
            }
        }

        // --- Stage 3: Consensus Logic ---
        const totalBuyers = buyingSignals.length;
        const planBuyers = planSignals.length;
        
        if (totalBuyers > 1) {
            const isRobotConsensus = (planBuyers / totalBuyers) > 0.5;
            if (isRobotConsensus) {
                insiderSignals.forEach(sig => {
                    if (sig.netCashInvested > 0) {
                        sig.reasons.push(`🤖 Robot Consensus`);
                        // 使用配置中的惩罚分 (确保 scoring.js 已更新)
                        sig.score += (SCORING_CONFIG.SCORES.CLUSTER_PENALTY || -50); 
                    }
                });
            } else {
                const multiplier = 1 + Math.min((totalBuyers - 1) * SCORING_CONFIG.CLUSTER.MULTIPLIER, SCORING_CONFIG.CLUSTER.MAX_MULTIPLIER);
                insiderSignals.forEach(sig => {
                    if (sig.netCashInvested > 0) {
                        sig.score = Math.round(sig.score * multiplier);
                        sig.reasons.push(`👥 Consensus (${totalBuyers})`);
                    }
                });
            }
        }

        // --- Stage 4: AI Analysis ---
        const activeSignals = insiderSignals.filter(s => s.score >= 20 && s.netCashInvested > 0);
        
        if (activeSignals.length > 0) {
            const maxScoreSignal = activeSignals.reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);
            
            if (watchlist.has(ticker) || maxScoreSignal.score >= SCORING_CONFIG.THRESHOLDS.AI_ANALYSIS_TRIGGER_SCORE) {
                
                // No longer console.log here, all information is passed to index.js via object
                const news = await newsService.getRecentNews(ticker, companyName);
                const totalNetCash = buyingSignals.reduce((sum, s) => sum + s.netCashInvested, 0);
                
                const aiAnalysis = await llmService.analyzeSentiment({
                    ticker,
                    insiders: activeSignals.map(s => ({
                        name: s.insider,
                        amount: s.netCashInvested,
                        reasons: s.reasons,
                        relation: s.relation
                    })),
                    totalNetCash,
                    maxScore: maxScoreSignal.score,
                    marketData: marketContext,
                    news: news 
                });

                activeSignals.forEach(sig => {
                    sig.aiAnalysis = aiAnalysis;
                    sig.aiNews = news;
                    sig.sediLink = sediLink; // 传递 SEDI 链接
                });
            }
        }

        return activeSignals;
    }

    static _evaluateInsider(ticker, insiderName, recordList, isWatchlisted, marketContext) {
        const CFG = SCORING_CONFIG;
        const meta = recordList[0].raw;
        
        let buyVol = 0; 
        let buyCost = 0; 
        let sellProceeds = 0;
        let isPlan = false; let isPrivate = false; let hasPublicBuy = false;

        // [NEW] 1. Prepare arrays to collect dates and prices
        let txDates = [];
        let txPrices = [];

        recordList.forEach(r => {
            const tx = r.raw;
            const code = Parser.extractTxCode(tx.type);
            
            if (CFG.CODES.IGNORE.includes(code)) return;

            // [CRITICAL] 2. This interception is very important: if it's a GRANT (56/50 etc.), skip directly, do not count as any buy
            if (CFG.CODES.GRANT && CFG.CODES.GRANT.includes(code)) return;

            let price = Parser.cleanNumber(tx.price || tx.unit_price);
            const amount = Parser.cleanNumber(tx.number_moved);
            const absAmount = Math.abs(amount);
            
            let multiplier = 1.0;
            if ((tx.currency || "").includes("USD")) multiplier = CFG.THRESHOLDS.USD_CAD_RATE;
            const cash = absAmount * price * multiplier;

            if (amount > 0) { // BUY
                buyCost += cash;
                buyVol += absAmount;
                
                // [NEW] 3. Collect details of valid buys
                if (tx.transaction_date) txDates.push(tx.transaction_date);
                if (price > 0) txPrices.push(price);

                if (CFG.CODES.PLAN_BUY.includes(code)) isPlan = true;
                else if (CFG.CODES.PRIVATE_BUY.includes(code)) isPrivate = true;
                else if (CFG.CODES.PUBLIC_BUY === code) hasPublicBuy = true;
            } else { // SELL
                sellProceeds += cash;
            }
        });

        const netCash = buyCost - sellProceeds;
        
        if (netCash < 0 && !isWatchlisted) return null;
        if (netCash < 5000 && netCash >= 0 && !isWatchlisted) return null;

        let score = 0;
        const reasons = [];

        // [NEW] 4. Generate transaction summary string for this insider
        txDates.sort();
        const lastDate = txDates.length > 0 ? txDates[txDates.length - 1] : "N/A";
        const avgPrice = txPrices.length > 0 
            ? (txPrices.reduce((a, b) => a + b, 0) / txPrices.length).toFixed(2) 
            : "N/A";
        // Format example: "2026-01-05 @ $62.50"
        const txDetailStr = `${lastDate} @ $${avgPrice}`;

        if (netCash > 0) {
            if (isPlan) { score += CFG.SCORES.BASE_PLAN_BUY; reasons.push("📅 Auto-Plan"); }
            else if (isPrivate) { score += CFG.SCORES.BASE_PRIVATE_BUY; reasons.push("🔒 Private"); }
            else { score += CFG.SCORES.BASE_MARKET_BUY; reasons.push("🔥 Market Buy"); }

            if (marketContext && marketContext.marketCap > 0) {
                const impactRatio = netCash / marketContext.marketCap;
                if (impactRatio > CFG.THRESHOLDS.SIGNIFICANT_IMPACT_RATIO) {
                    score += CFG.SCORES.SIZE_BONUS * 2; 
                    reasons.push(`🐋 Whale (${(impactRatio*100).toFixed(2)}% MC)`);
                } else if (netCash > CFG.THRESHOLDS.LARGE_SIZE) {
                    score += CFG.SCORES.SIZE_BONUS;
                    reasons.push("💰 Large Size");
                }
                
                // Calculate premium only for public buys
                if (hasPublicBuy && buyVol > 0 && marketContext.price > 0) {
                    const realAvgPrice = buyCost / buyVol;
                    const discountRate = (marketContext.price - realAvgPrice) / marketContext.price;
                    if (discountRate < -0.05) { score += CFG.SCORES.PREMIUM_BUY_BONUS; reasons.push(`💪 Premium`); }
                    else if (discountRate > 0.30) { score += CFG.SCORES.DISCOUNT_PENALTY; reasons.push(`📉 Discount`); }
                }
                
                if (marketContext.price > marketContext.ma50) { score += CFG.SCORES.UPTREND_BONUS; reasons.push("📈 Uptrend"); }
            } else {
                if (netCash > CFG.THRESHOLDS.LARGE_SIZE) { score += CFG.SCORES.SIZE_BONUS; reasons.push("💰 Large Size"); }
            }

            if (meta.relationship_type && (meta.relationship_type.includes('Director') || meta.relationship_type.includes('Officer'))) {
                score += CFG.SCORES.RANK_BONUS;
                reasons.push("⭐ Top Insider");
            }

            if (isPrivate) { score += CFG.SCORES.DILUTION_PENALTY; reasons.push("⚠️ Potential Dilution"); }
        } else {
            score = 0;
            reasons.push("📉 Net Sell");
        }

        return { 
            ticker, 
            insider: insiderName, 
            relation: meta.relationship_type, 
            score, 
            netCashInvested: netCash, 
            reasons, 
            isWatchlisted, 
            sediUrl: null, 
            marketContext,
            txDetailStr // [NEW] 5. Pass out details
        };
    }
}
