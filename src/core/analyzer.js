/**
 * src/core/analyzer.js (v8.5 - Company Name Search)
 * [Update] Passes issuer_name to NewsService for enhanced relevance.
 */
import { Parser } from '../utils/parser.js';
import { MarketContextFactory } from '../services/market_data/market_context_factory.js';
import { SCORING_CONFIG } from '../config/scoring.js';
import { NewsService } from '../services/news/news_service.js';
import { LLMService } from '../services/llm/llm_service.js';

const newsService = new NewsService();
const llmService = new LLMService();

export class Analyzer {
    // ... analyze, _groupByTicker, _groupByInsider 保持不变 ...
    static async analyze(records, watchlist = new Set()) {
        const uniqueMap = new Map();
        records.forEach(r => uniqueMap.set(r.raw.sedi_transaction_id, r));
        const uniqueRecords = Array.from(uniqueMap.values());
        const tickerGroups = this._groupByTicker(uniqueRecords);
        const allSignals = [];

        for (const ticker in tickerGroups) {
            const tickerRecords = tickerGroups[ticker];
            const cleanTicker = ticker.split('.')[0]; 
            const isWatchlisted = watchlist.has(ticker) || watchlist.has(cleanTicker);
            const tickerSignals = await this._analyzeTicker(ticker, tickerRecords, isWatchlisted);
            if (tickerSignals && tickerSignals.length > 0) allSignals.push(...tickerSignals);
        }
        return allSignals.sort((a, b) => b.score - a.score);
    }

    static _groupByTicker(records) { return records.reduce((acc, r) => { const t = r.symbol || r.raw.symbol; (acc[t] = acc[t] || []).push(r); return acc; }, {}); }
    static _groupByInsider(records) { return records.reduce((acc, r) => { const n = r.raw.insider_name; (acc[n] = acc[n] || []).push(r); return acc; }, {}); }

    static async _analyzeTicker(ticker, records, isWatchlisted) {
        const insiderGroups = this._groupByInsider(records);
        const insiderSignals = [];
        const candidates = [];

        // 获取公司名称 (从第一条记录的 meta 中提取)
        // SEDI 数据中 issuer_name 通常存在
        const firstRecord = records[0];
        const companyName = firstRecord.raw.issuer_name || firstRecord.raw.issuer || null;

        // Stage 1: Fast Pass
        for (const insiderName in insiderGroups) {
            const iRecords = insiderGroups[insiderName];
            const rawSignal = this._evaluateInsider(ticker, insiderName, iRecords, isWatchlisted, null);
            if (rawSignal && (rawSignal.score >= 30 || Math.abs(rawSignal.netCashInvested) > 10000 || isWatchlisted)) {
                candidates.push({ name: insiderName, records: iRecords });
            }
        }
        if (candidates.length === 0) return [];

        // Stage 2: Market Data
        let marketContext = null;
        try {
            const provider = MarketContextFactory.getProvider();
            marketContext = await provider.getMarketContext(ticker);
        } catch (e) {}

        // Stage 3: Scoring
        const buyingSignals = [];
        for (const candidate of candidates) {
            const finalSignal = this._evaluateInsider(ticker, candidate.name, candidate.records, isWatchlisted, marketContext);
            if (finalSignal) {
                insiderSignals.push(finalSignal);
                if (finalSignal.score > 0 && finalSignal.netCashInvested > 0) {
                    buyingSignals.push(finalSignal);
                }
            }
        }

        // Consensus Bonus
        const buyerCount = buyingSignals.length;
        if (buyerCount > 1) {
            const multiplier = 1 + ((buyerCount - 1) * SCORING_CONFIG.CLUSTER.MULTIPLIER); 
            insiderSignals.forEach(sig => {
                if (sig.score > 0 && sig.netCashInvested > 0) {
                    sig.score = Math.round(sig.score * multiplier);
                    sig.reasons.push(`👥 Consensus (${buyerCount})`);
                }
            });
        }

        // --- Stage 4: AI Analysis ---
        if (buyingSignals.length > 0) {
            const maxScoreSignal = buyingSignals.reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);
            const shouldTriggerAI = isWatchlisted || maxScoreSignal.score >= SCORING_CONFIG.THRESHOLDS.AI_ANALYSIS_TRIGGER_SCORE;
            
            if (shouldTriggerAI) {
                console.log(`🧠 [AI] Triggered for ${ticker} (${companyName}). Fetching news...`);

                // [UPDATE] 传入公司名进行增强搜索
                const news = await newsService.getRecentNews(ticker, companyName);
                
                if (news && news.length > 0) {
                    console.log(`   📰 Found ${news.length} RELEVANT articles:`);
                    news.forEach(n => console.log(`      - [${n.time}] ${n.title}`));
                } else {
                    console.log(`   📭 No relevant news found for ${ticker} / ${companyName}.`);
                }

                const totalNetCash = buyingSignals.reduce((sum, s) => sum + s.netCashInvested, 0);
                const insidersList = buyingSignals.map(s => ({
                    name: s.insider,
                    amount: s.netCashInvested,
                    reasons: s.reasons
                }));

                const aiAnalysis = await llmService.analyzeSentiment({
                    ticker,
                    insiders: insidersList,
                    totalNetCash,
                    maxScore: maxScoreSignal.score,
                    marketData: marketContext,
                    news: news
                });

                insiderSignals.forEach(sig => {
                    if (sig.netCashInvested > 0) {
                        sig.aiAnalysis = aiAnalysis;
                        sig.aiNews = news; 
                    }
                });
            }
        }

        return insiderSignals.filter(sig => {
            if (sig.isWatchlisted) return true; 
            if (sig.score <= 0) return false;
            return sig.score >= 20 && Math.abs(sig.netCashInvested) > 5000;
        });
    }

    static _evaluateInsider(ticker, insiderName, recordList, isWatchlisted, marketContext = null) {
        const meta = recordList[0].raw; 
        const CFG = SCORING_CONFIG; // Alias
        
        let buyVol = 0; let sellVol = 0;
        let buyCost = 0; let sellProceeds = 0;
        let hasPublicBuy = false; let hasPrivateBuy = false;
        let hasPlanBuy = false; let hasExercise = false; let hasSell = false;

        const sortedByDate = [...recordList].sort((a, b) => new Date(b.raw.transaction_date) - new Date(a.raw.transaction_date));
        const finalBalance = sortedByDate.length > 0 ? Parser.cleanNumber(sortedByDate[0].raw.balance) : 0;

        recordList.forEach(r => {
            const tx = r.raw;
            const code = Parser.extractTxCode(tx.type);
            let price = Parser.cleanNumber(tx.price);
            if (price === 0) price = Parser.cleanNumber(tx.unit_price);
            const amount = Parser.cleanNumber(tx.number_moved);
            const absAmount = Math.abs(amount);

            let currencyMultiplier = 1.0;
            const currencyField = (tx.exchange_unit_price || tx.exchange_price || "").toUpperCase();
            if (currencyField.includes("USD") || currencyField.includes("U.S.")) currencyMultiplier = CFG.THRESHOLDS.USD_CAD_RATE;

            const cash = absAmount * price * currencyMultiplier;

            if (amount > 0) {
                if (code === CFG.CODES.PUBLIC_BUY) { hasPublicBuy = true; buyVol += absAmount; buyCost += cash; }
                else if (CFG.CODES.PRIVATE_BUY.includes(code)) { hasPrivateBuy = true; buyVol += absAmount; buyCost += cash; }
                else if (CFG.CODES.PLAN_BUY.includes(code)) { hasPlanBuy = true; buyVol += absAmount; buyCost += cash; }
                else if (CFG.CODES.EXERCISE.includes(code)) { hasExercise = true; buyVol += absAmount; buyCost += cash; }
            } else {
                if (code === CFG.CODES.PUBLIC_BUY) { hasSell = true; sellVol += absAmount; sellProceeds += cash; }
            }
        });

        const netCash = buyCost - sellProceeds;
        const sediUrl = meta.issuer_number ? `https://ceo.ca/content/sedi/issuers/${meta.issuer_number}` : null;

        if (Math.abs(netCash) > CFG.THRESHOLDS.ANOMALY_CAP) {
            return { ticker, insider: insiderName, score: 0, relation: meta.relationship_type, reasons: ["⚠️ Data Anomaly"], netCashInvested: netCash, isRiskAlert: true, isWatchlisted, sediUrl, tags: [], marketContext };
        }

        let score = 0;
        const reasons = [];

        if (hasPublicBuy) { score += CFG.SCORES.BASE_MARKET_BUY; reasons.push("🔥 Market Buy"); }
        else if (hasPrivateBuy) { score += CFG.SCORES.BASE_PRIVATE_BUY; reasons.push("🔒 Private Placement"); }
        else if (hasPlanBuy) { score += CFG.SCORES.BASE_PLAN_BUY; reasons.push("📅 Auto-Plan Buy"); }
        else if (hasExercise) { score += CFG.SCORES.BASE_EXERCISE; reasons.push("🎫 Exercised Rights"); }

        if (marketContext && marketContext.price > 0) {
            const m = marketContext;
            const avgBuyPrice = buyVol > 0 ? (buyCost / buyVol) : 0;
            
            if (avgBuyPrice > 0) {
                const discountRate = (m.price - avgBuyPrice) / m.price;
                if (discountRate > 0.30) { score += CFG.SCORES.DISCOUNT_PENALTY; reasons.push(`📉 Deep Discount`); }
                else if (discountRate < -0.05) { score += CFG.SCORES.PREMIUM_BUY_BONUS; reasons.push(`💪 Premium Buy`); }
                else if (hasPublicBuy) { reasons.push(`⚖️ At Market`); }
            }

            if (m.high52w && m.low52w) {
                const range = m.high52w - m.low52w;
                const position = range > 0 ? (m.price - m.low52w) / range : 0.5;
                if (position < 0.15) { score += 15; reasons.push(`⚓ Bottom Fishing`); }
                else if (position > 0.85) { score += 15; reasons.push(`🚀 Breakout Play`); }
            }

            if (m.ma50) {
                if (m.price > m.ma50) { score += CFG.SCORES.UPTREND_BONUS; reasons.push(`📈 Uptrend`); }
                else { reasons.push(`📉 Downtrend`); }
            }

            const isZombie = (m.marketCap && m.marketCap < 3000000) || (m.avgVolume && m.avgVolume * m.price < 5000);
            if (isZombie) { reasons.push(`🧟 Illiquid`); if (score > 80) score = 80; }

            if (m.avgVolume > 0) {
                const volumeImpact = (buyVol - sellVol) / m.avgVolume;
                if (volumeImpact > 0.15) { 
                    if (!isZombie) score += CFG.SCORES.LIQUIDITY_BONUS;
                    reasons.push(`🌊 High Vol Impact`);
                }
            }
        }

        if (hasExercise && hasSell) return { ticker, insider: insiderName, score: 0, relation: meta.relationship_type, reasons: ["⛔ Option Flip"], netCashInvested: netCash, isWatchlisted, sediUrl, tags: [], marketContext };

        const isTopInsider = meta.relationship_type && (meta.relationship_type.includes('Director') || meta.relationship_type.includes('Senior Officer'));
        if (isTopInsider && score > 0) { score += CFG.SCORES.RANK_BONUS; reasons.push("⭐ Top Insider"); }
        if (netCash > CFG.THRESHOLDS.LARGE_SIZE) { score += CFG.SCORES.SIZE_BONUS; reasons.push("💰 Large Size"); }

        if (buyVol > 0 && score > 0) {
            const netVol = buyVol - sellVol;
            const initialHoldings = finalBalance - netVol;
            if (initialHoldings <= 0 && netVol > 0) { reasons.push("🆕 New Position"); score += 10; }
            else if (initialHoldings > 0) {
                const pctIncrease = netVol / initialHoldings;
                if (pctIncrease > CFG.THRESHOLDS.HIGH_CONVICTION_PCT) { score += CFG.SCORES.CONVICTION_BONUS; reasons.push(`🚀 +${(pctIncrease*100).toFixed(0)}% Holdings`); }
            }
        }

        const fileDateStr = (meta.filing_date && meta.filing_date.length > 10) ? meta.filing_date.substring(0, 10) : meta.filing_date;
        if (fileDateStr) {
            const diffDays = Math.ceil(Math.abs(new Date(fileDateStr) - new Date(meta.transaction_date)) / (86400000));
            if (diffDays > CFG.THRESHOLDS.LATE_FILING_DAYS && score > 0) { score += CFG.SCORES.LATE_FILING_BONUS; reasons.push(`🐢 ${diffDays}d Late`); }
        }

        return { ticker, insider: insiderName, relation: meta.relationship_type, score, netCashInvested: netCash, reasons, isWatchlisted, sediUrl, tags: [], marketContext };
    }
}