/**
 * src/core/analyzer.js (v10.0 - The Unified Analyzer)
 * Integrates ALL features:
 * 1. Lookback Window (Stale data fix)
 * 2. Anomaly Detection (DMGI/SOI fix)
 * 3. Grant Isolation (Compensation fix)
 * 4. Watchlist Sell Alerts (Follow-sell logic)
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

    /**
     * Filter records to ensure we only analyze recent valid data.
     */
    static _filterRecentRecords(records) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - SCORING_CONFIG.THRESHOLDS.LOOKBACK_DAYS);
        
        return records.filter(r => {
            if (!r.date) return false; 
            const txDate = new Date(r.date);
            return txDate >= cutoffDate;
        });
    }

    static async analyze(allFetchedRecords, watchlist = new Set()) {
        // [Step 1] Apply Time-Window Filter globally
        const recentRecords = this._filterRecentRecords(allFetchedRecords);
        
        // Deduplicate
        const uniqueMap = new Map();
        recentRecords.forEach(r => uniqueMap.set(r.raw.sedi_transaction_id, r));
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
        // 1. [Fix] Move definition to top scope so it's available everywhere
        const isWatchlisted = watchlist.has(ticker); 
        
        const insiderGroups = this._groupByInsider(records);
        const allRawSignals = []; 

        // --- Stage 1: Market Data ---
        let marketContext = null;
        try {
            const provider = MarketContextFactory.getProvider();
            marketContext = await provider.getMarketContext(ticker);
        } catch (e) {}

        // --- Stage 2: Evaluate Insiders (Shadow Mode) ---
        for (const insiderName in insiderGroups) {
            const iRecords = insiderGroups[insiderName];
            // Pass marketContext but NOT isWatchlisted (logic handled externally now)
            const signal = this._evaluateInsider(ticker, insiderName, iRecords, marketContext);
            if (signal) allRawSignals.push(signal);
        }

        // --- Stage 3: Calculate Ticker-Level Sentiment ---
        // Calculate Global Net Flow (Including hidden sells)
        const totalNetFlow = allRawSignals.reduce((sum, s) => sum + s.netCashInvested, 0);
        
        // --- Stage 4: Process Signals ---
        const finalSignals = [];
        
        for (const sig of allRawSignals) {
            sig.isWatchlisted = isWatchlisted; // Assign the flag

            // 4.1 Apply Context Penalty (Smart Scoring)
            // If heavy selling pressure exists, penalize buy signals
            if (totalNetFlow < -30000 && sig.netCashInvested > 0) {
                sig.score -= 50; 
                sig.reasons.push(`📉 Heavy Selling Pressure (Net: $${(totalNetFlow/1000).toFixed(0)}k)`);
            }

            // 4.2 Visibility Filter
            let isVisible = false;
            
            // Case A: Valid Buy (Thresholds)
            if (sig.score > 0 && sig.netCashInvested > 0) {
                 if (sig.netCashInvested > 1500 || sig.score > 15) isVisible = true;
            }
            
            // Case B: Watchlist (Always Show)
            if (isWatchlisted) isVisible = true;

            // 4.3 Add to Final Output
            if (isVisible) finalSignals.push(sig);
        }

        // --- Stage 5: AI Logic ---
        // [Fix] Removed unused 'buyingSignals'
        const activeSignals = finalSignals.filter(s => s.score >= 20 && s.netCashInvested > 0);
        
        if (activeSignals.length > 0) {
            const maxScoreSignal = activeSignals.reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);
            
            // [Fix] Now 'isWatchlisted' is correctly accessed from the top scope
            if (isWatchlisted || maxScoreSignal.score >= SCORING_CONFIG.THRESHOLDS.AI_ANALYSIS_TRIGGER_SCORE) {
                 
                 const news = await newsService.getRecentNews(ticker, null);
                 
                 const aiAnalysis = await llmService.analyzeSentiment({
                    ticker,
                    insiders: activeSignals.map(s => ({ ...s, name: s.insider, amount: s.netCashInvested })),
                    totalNetCash: totalNetFlow, // Correctly passes the global flow
                    maxScore: maxScoreSignal.score,
                    marketData: marketContext,
                    news: news 
                });

                activeSignals.forEach(sig => { 
                    sig.aiAnalysis = aiAnalysis; 
                    sig.aiNews = news; 
                    // Safe guard for issuer_number access
                    const issuerNum = records[0].raw.issuer_number || records[0].raw.issuer_num;
                    sig.sediLink = issuerNum ? `https://ceo.ca/content/sedi/issuers/${issuerNum}` : null;
                });
            }
        }

        return finalSignals;
    }

    static _evaluateInsider(ticker, insiderName, recordList, marketContext) {
        const CFG = SCORING_CONFIG;
        const ANOMALY = CFG.ANOMALY; // [Restored] 恢复异常检测配置
        const meta = recordList[0].raw;
        
        let buyVol = 0; 
        let buyCost = 0; 
        let sellProceeds = 0;
        let isPlan = false; let isPrivate = false; let hasPublicBuy = false;

        let txDates = [];
        let txPrices = [];

        // [New] Sell tracking for Watchlist
        let sellDates = [];
        let sellPrices = [];
        let sellVol = 0;

        for (const r of recordList) {
            const tx = r.raw;
            const code = Parser.extractTxCode(tx.type);
            
            if (CFG.CODES.IGNORE.includes(code)) continue;
            
            // [Check 1] Grant Isolation: Ignore compensation
            if (CFG.CODES.GRANT && CFG.CODES.GRANT.includes(code)) continue;

            let price = Parser.cleanNumber(tx.price || tx.unit_price);
            const amount = Parser.cleanNumber(tx.number_moved);
            const absAmount = Math.abs(amount);
            
            let multiplier = 1.0;
            if ((tx.currency || "").includes("USD")) multiplier = CFG.THRESHOLDS.USD_CAD_RATE;
            
            // --- [Check 2] ANOMALY DETECTION (Restored) ---
            // 2.1: Price vs Volume Glitch (e.g. DMGI)
            if (Math.abs(price - absAmount) < ANOMALY.SUSPICIOUS_PRICE_VOL_MATCH_TOLERANCE && price > 100) {
                 continue; // Skip corrupted record
            }

            // 2.2: Market Context Sanity Checks
            if (marketContext) {
                // Price Sanity
                if (marketContext.price > 0 && price > (marketContext.price * ANOMALY.MAX_PRICE_DISCREPANCY)) {
                    continue; // Skip ridiculous prices
                }
                // Cap Impact Sanity
                const tentativeCash = absAmount * price * multiplier;
                if (marketContext.marketCap > 0 && tentativeCash > (marketContext.marketCap * ANOMALY.MAX_CAP_IMPACT)) {
                    continue; // Skip ridiculous sizes
                }
            }

            const cash = absAmount * price * multiplier;

            if (amount > 0) { // BUY
                buyCost += cash;
                buyVol += absAmount;
                
                if (tx.transaction_date) txDates.push(tx.transaction_date);
                if (price > 0) txPrices.push(price);

                if (CFG.CODES.PLAN_BUY.includes(code)) isPlan = true;
                else if (CFG.CODES.PRIVATE_BUY.includes(code)) isPrivate = true;
                else if (CFG.CODES.PUBLIC_BUY === code) hasPublicBuy = true;
            } else { // SELL
                sellProceeds += cash;

                // [New] Watchlist Follow-Sell Logic
                // Catch Code 10 (Public Disposition) specifically
                if (code === CFG.CODES.PUBLIC_BUY) { 
                    if (tx.transaction_date) sellDates.push(tx.transaction_date);
                    if (price > 0) sellPrices.push(price);
                    sellVol += absAmount;
                }
            }
        }

        const netCash = buyCost - sellProceeds;

        let score = 0;
        const reasons = [];

        // 1. Generate Buy Details
        txDates.sort();
        const lastDate = txDates.length > 0 ? txDates[txDates.length - 1] : "N/A";
        const avgPrice = txPrices.length > 0 
           ? (txPrices.reduce((a, b) => a + b, 0) / txPrices.length).toFixed(2) 
            : "N/A";
        const txDetailStr = (buyVol > 0) ? `${lastDate} @ ~$${avgPrice}` : null;

        // 2. Generate Sell Alerts
        let sellDetailStr = null;
        if (sellDates.length > 0) {
            sellDates.sort();
            const lastSellDate = sellDates[sellDates.length - 1];
            const avgSellPrice = sellPrices.length > 0 
                ? (sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length).toFixed(2) 
                : "N/A";
            sellDetailStr = `⚠️ SOLD ${sellVol.toLocaleString()} shares @ ~$${avgSellPrice} (Last: ${lastSellDate})`;
        }

        if (netCash > 0) {
            // Semantic Weighting
            if (isPlan) { 
                score += CFG.SCORES.BASE_PLAN_BUY; 
                reasons.push("📅 Auto-Plan"); 
            }
            else if (isPrivate) { 
                score += CFG.SCORES.BASE_PRIVATE_BUY; 
                reasons.push("🔒 Private"); 
            }
            else { 
                // Common Shares Check
                const securityName = (meta.security || "").toLowerCase();
                const isCommon = securityName.includes("common") || securityName.includes("voting");
                
                if (hasPublicBuy && isCommon) {
                    score += CFG.SCORES.PREMIUM_COMMON_BUY;
                    reasons.push("💎 Common Shares"); 
                } else {
                    score += CFG.SCORES.BASE_MARKET_BUY;
                    reasons.push("🔥 Market Buy");
                }
            }

            if (marketContext && marketContext.marketCap > 0) {
                const impactRatio = netCash / marketContext.marketCap;
                if (impactRatio > CFG.THRESHOLDS.SIGNIFICANT_IMPACT_RATIO) {
                    score += CFG.SCORES.SIZE_BONUS * 2; 
                    reasons.push(`🐋 Whale (${(impactRatio*100).toFixed(2)}% MC)`);
                } else if (netCash > CFG.THRESHOLDS.LARGE_SIZE) {
                    score += CFG.SCORES.SIZE_BONUS;
                    reasons.push("💰 Large Size");
                }
                
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
            //isWatchlisted, 
            sediUrl: null, 
            marketContext,
            txDetailStr,
            sellDetailStr 
        };
    }
}