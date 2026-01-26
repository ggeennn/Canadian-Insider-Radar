/**
 * src/core/analyzer.js (v10.1 - The Probabilistic Analyzer)
 * * [Audit Implementation]
 * 1. Historical Price Back-testing (Fixes Snapshot Bias).
 * 2. Role-Weighted Net Flow (Fixes Herd Mentality).
 * 3. Sigmoid Normalization (Fixes Unbounded Scores).
 */
import { Parser } from '../utils/parser.js';
import { MarketContextFactory } from '../services/market_data/market_context_factory.js';
import { SCORING_CONFIG } from '../config/scoring.js';
import { NewsService } from '../services/news/news_service.js';
import { LLMService } from '../services/llm/llm_service.js';

const newsService = new NewsService();
const llmService = new LLMService();

export class Analyzer {
    
    // --- [New] Helper: Sigmoid Normalization ---
    // Maps raw score (e.g., -50 to 200) to 0-100 probability
    static _calculateSigmoidScore(rawScore) {
        const { k, midpoint } = SCORING_CONFIG.SIGMOID;
        const probability = 100 / (1 + Math.exp(-k * (rawScore - midpoint)));
        return Number(probability.toFixed(1)); // Keep 1 decimal
    }

    // --- [New] Helper: Role Weighting ---
    static _getRoleWeight(relation) {
        const ROLES = SCORING_CONFIG.ROLE_MULTIPLIERS;
        const r = (relation || "").toUpperCase();
        
        if (r.includes("CHIEF FINANCIAL") || r.includes("CFO")) return ROLES.CFO;
        if (r.includes("CHIEF EXECUTIVE") || r.includes("CEO")) return ROLES.CEO;
        if (r.includes("OFFICER") || r.includes("PRESIDENT") || r.includes("VICE")) return ROLES.OFFICER;
        if (r.includes("DIRECTOR")) return ROLES.DIRECTOR;
        if (r.includes("10%") || r.includes("OWNER")) return ROLES.OWNER;
        
        return ROLES.DEFAULT;
    }

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
        
        // Sort by Normalized Score (Probability)
        return allSignals.sort((a, b) => b.score - a.score);
    }

    static async _analyzeTicker(ticker, records, watchlist) {
        const isWatchlisted = watchlist.has(ticker); 
        const insiderGroups = this._groupByInsider(records);
        
        // --- Stage 1: Market Data & Provider Access ---
        const provider = MarketContextFactory.getProvider(); // Access provider instance
        let marketContext = null;
        try {
            marketContext = await provider.getMarketContext(ticker);
        } catch (e) {}

        // --- Stage 2: Evaluate Insiders (Async Parallel) ---
        // Must be async to allow getHistoricalPrice calls
        const evalPromises = Object.keys(insiderGroups).map(insiderName => {
            return this._evaluateInsider(ticker, insiderName, insiderGroups[insiderName], marketContext, provider);
        });

        const allRawSignals = (await Promise.all(evalPromises)).filter(s => s !== null);

        // --- Stage 3: Role-Weighted Aggregation ---
        // [Audit Fix] Don't just sum scalars. Use vector sum of (Money * RoleWeight)
        let weightedNetFlow = 0;
        let totalNominalFlow = 0;

        for (const sig of allRawSignals) {
            weightedNetFlow += (sig.netCashInvested * sig.roleWeight);
            totalNominalFlow += sig.netCashInvested;
        }
        
        // --- Stage 4: Process Signals ---
        const finalSignals = [];
        
        for (const sig of allRawSignals) {
            sig.isWatchlisted = isWatchlisted;

            // 4.1 Context Penalty based on WEIGHTED flow
            // If "Smart Money" is selling (Weighted Flow is negative), penalize everyone
            if (weightedNetFlow < -50000 && sig.netCashInvested > 0) {
                sig.rawScore += SCORING_CONFIG.SCORES.SELLING_PRESSURE_PENALTY;
                sig.reasons.push(`📉 Smart Money Selling (W.Flow: $${(weightedNetFlow/1000).toFixed(0)}k)`);
            }

            // 4.2 Sigmoid Normalization (The Final Score)
            sig.score = this._calculateSigmoidScore(sig.rawScore);

            // 4.3 Visibility Filter (Based on Probability Score)
            let isVisible = false;
            
            // Case A: Valid Buy (> 50% Probability)
            if (sig.score > 50 && sig.netCashInvested > 0) {
                 if (sig.netCashInvested > 1500) isVisible = true;
            }
            // Case B: Watchlist
            if (isWatchlisted) isVisible = true;

            if (isVisible) finalSignals.push(sig);
        }

        // --- Stage 5: AI Logic ---
        const activeSignals = finalSignals.filter(s => s.score >= 60 && s.netCashInvested > 0);
        
        if (activeSignals.length > 0) {
            const maxScoreSignal = activeSignals.reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);
            
            if (isWatchlisted || maxScoreSignal.score >= SCORING_CONFIG.THRESHOLDS.AI_ANALYSIS_TRIGGER_SCORE) {
                 
                 const news = await newsService.getRecentNews(ticker, null);
                 
                 const aiAnalysis = await llmService.analyzeSentiment({
                    ticker,
                    insiders: activeSignals.map(s => ({ ...s, name: s.insider, amount: s.netCashInvested })),
                    totalNetCash: totalNominalFlow,
                    maxScore: maxScoreSignal.score,
                    marketData: marketContext,
                    news: news 
                });

                activeSignals.forEach(sig => { 
                    sig.aiAnalysis = aiAnalysis; 
                    sig.aiNews = news; 
                    const issuerNum = records[0].raw.issuer_number || records[0].raw.issuer_num;
                    sig.sediLink = issuerNum ? `https://ceo.ca/content/sedi/issuers/${issuerNum}` : null;
                });
            }
        }

        return finalSignals;
    }

    static async _evaluateInsider(ticker, insiderName, recordList, marketContext, provider) {
        const CFG = SCORING_CONFIG;
        const ANOMALY = CFG.ANOMALY;
        const meta = recordList[0].raw;
        
        let buyVol = 0; let buyCost = 0; let sellProceeds = 0;
        let isPlan = false; let isPrivate = false; let hasPublicBuy = false;
        
        let txDates = [];
        let txPrices = [];
        
        // Watchlist tracking
        let sellDates = [];
        let sellPrices = [];
        let sellVol = 0;

        // [New] Track historical comparisons
        let historicalChecks = []; 

        for (const r of recordList) {
            const tx = r.raw;
            const code = Parser.extractTxCode(tx.type);
            
            if (CFG.CODES.IGNORE.includes(code)) continue;
            if (CFG.CODES.GRANT && CFG.CODES.GRANT.includes(code)) continue;

            let price = Parser.cleanNumber(tx.price || tx.unit_price);
            const amount = Parser.cleanNumber(tx.number_moved);
            const absAmount = Math.abs(amount);
            
            let multiplier = 1.0;
            if ((tx.currency || "").includes("USD")) multiplier = CFG.THRESHOLDS.USD_CAD_RATE;
            
            // --- Anomaly Check ---
            if (Math.abs(price - absAmount) < ANOMALY.SUSPICIOUS_PRICE_VOL_MATCH_TOLERANCE && price > 100) continue;
            if (marketContext) {
                if (marketContext.price > 0 && price > (marketContext.price * ANOMALY.MAX_PRICE_DISCREPANCY)) continue;
                const tentativeCash = absAmount * price * multiplier;
                if (marketContext.marketCap > 0 && tentativeCash > (marketContext.marketCap * ANOMALY.MAX_CAP_IMPACT)) continue;
            }

            const cash = absAmount * price * multiplier;

            if (amount > 0) { // BUY
                buyCost += cash;
                buyVol += absAmount;
                if (tx.transaction_date) txDates.push(tx.transaction_date);
                if (price > 0) txPrices.push(price);

                if (CFG.CODES.PLAN_BUY.includes(code)) isPlan = true;
                else if (CFG.CODES.PRIVATE_BUY.includes(code)) isPrivate = true;
                else if (CFG.CODES.PUBLIC_BUY === code) {
                    hasPublicBuy = true;
                    
                    // --- [Audit Feature] Historical Price Check ---
                    // Only check significant open market buys to save API calls
                    if (provider && provider.getHistoricalPrice && cash > 5000) {
                        try {
                            const histPrice = await provider.getHistoricalPrice(ticker, new Date(tx.transaction_date));
                            if (histPrice) {
                                historicalChecks.push({ txPrice: price, histPrice: histPrice });
                            }
                        } catch(e) {}
                    }
                }

            } else { // SELL
                sellProceeds += cash;
                if (code === CFG.CODES.PUBLIC_BUY) { 
                    if (tx.transaction_date) sellDates.push(tx.transaction_date);
                    if (price > 0) sellPrices.push(price);
                    sellVol += absAmount;
                }
            }
        }

        const netCash = buyCost - sellProceeds;
        
        // [New] Determine Role Weight
        const roleWeight = this._getRoleWeight(meta.relationship_type);
        
        let rawScore = 0; // Renamed from score
        const reasons = [];

        // Details String Generation
        txDates.sort();
        const lastDate = txDates.length > 0 ? txDates[txDates.length - 1] : "N/A";
        const avgPrice = txPrices.length > 0 ? (txPrices.reduce((a, b) => a + b, 0) / txPrices.length).toFixed(2) : "N/A";
        const txDetailStr = (buyVol > 0) ? `${lastDate} @ ~$${avgPrice}` : null;

        let sellDetailStr = null;
        if (sellDates.length > 0) {
            sellDates.sort();
            const lastSellDate = sellDates[sellDates.length - 1];
            const avgSellPrice = sellPrices.length > 0 ? (sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length).toFixed(2) : "N/A";
            sellDetailStr = `⚠️ SOLD ${sellVol.toLocaleString()} shares @ ~$${avgSellPrice} (Last: ${lastSellDate})`;
        }

        if (netCash > 0) {
            // 1. Transaction Type Scoring
            if (isPlan) { rawScore += CFG.SCORES.BASE_PLAN_BUY; reasons.push("📅 Auto-Plan"); }
            else if (isPrivate) { rawScore += CFG.SCORES.BASE_PRIVATE_BUY; reasons.push("🔒 Private"); }
            else { 
                const securityName = (meta.security || "").toLowerCase();
                const isCommon = securityName.includes("common") || securityName.includes("voting");
                if (hasPublicBuy && isCommon) {
                    rawScore += CFG.SCORES.PREMIUM_COMMON_BUY;
                    reasons.push("💎 Common Shares"); 
                } else {
                    rawScore += CFG.SCORES.BASE_MARKET_BUY;
                    reasons.push("🔥 Market Buy");
                }
            }

            // 2. Size & Impact
            if (marketContext && marketContext.marketCap > 0) {
                const impactRatio = netCash / marketContext.marketCap;
                if (impactRatio > CFG.THRESHOLDS.SIGNIFICANT_IMPACT_RATIO) {
                    rawScore += CFG.SCORES.SIZE_BONUS * 2; 
                    reasons.push(`🐋 Whale (${(impactRatio*100).toFixed(2)}% MC)`);
                } else if (netCash > CFG.THRESHOLDS.LARGE_SIZE) {
                    rawScore += CFG.SCORES.SIZE_BONUS;
                    reasons.push("💰 Large Size");
                }
                
                // 3. Price Context (Historical vs Snapshot)
                if (hasPublicBuy && buyVol > 0) {
                    let discountRate = 0;
                    let refPriceSource = "Snapshot";

                    // Priority: Historical Check > Snapshot
                    if (historicalChecks.length > 0) {
                        // Average out the historical discrepancies
                        // (Hist - Tx) / Hist.  If Tx > Hist (Paid more), result is negative (Discount negative = Premium)
                        // Wait, logic: (Market - Pay) / Market. 
                        // If Market 10, Pay 11. (10-11)/10 = -0.1 (-10% Discount = 10% Premium)
                        let totalDisc = 0;
                        historicalChecks.forEach(c => {
                             totalDisc += (c.histPrice - c.txPrice) / c.histPrice;
                        });
                        discountRate = totalDisc / historicalChecks.length;
                        refPriceSource = "Hist.Day";
                    } else if (marketContext.price > 0) {
                        const realAvgPrice = buyCost / buyVol;
                        discountRate = (marketContext.price - realAvgPrice) / marketContext.price;
                    }

                    if (discountRate < -0.05) { 
                        rawScore += CFG.SCORES.PREMIUM_PRICE_BONUS; // Updated Key
                        reasons.push(`💪 Premium Buy (${refPriceSource})`); 
                    } else if (discountRate > 0.30) { 
                        rawScore += CFG.SCORES.DISCOUNT_PENALTY; 
                        reasons.push(`📉 Deep Discount (${refPriceSource})`); 
                    }
                }
                
                if (marketContext.price > marketContext.ma50) { rawScore += CFG.SCORES.UPTREND_BONUS; reasons.push("📈 Uptrend"); }

            } else {
                if (netCash > CFG.THRESHOLDS.LARGE_SIZE) { rawScore += CFG.SCORES.SIZE_BONUS; reasons.push("💰 Large Size"); }
            }

            // 4. Role Bonus (On top of weight)
            if (roleWeight >= CFG.ROLE_MULTIPLIERS.CFO) {
                 rawScore += CFG.SCORES.RANK_BONUS;
                 reasons.push("⭐ C-Suite Conviction");
            } else if (roleWeight >= CFG.ROLE_MULTIPLIERS.OFFICER) {
                 rawScore += CFG.SCORES.RANK_BONUS / 2;
                 reasons.push("👔 Officer Buy");
            }

            if (isPrivate) { rawScore += CFG.SCORES.DILUTION_PENALTY; reasons.push("⚠️ Potential Dilution"); }

        } else {
            rawScore = 0; // Sells are neutral-to-negative, handled by net flow penalty
            reasons.push("📉 Net Sell");
        }

        return { 
            ticker, 
            insider: insiderName, 
            relation: meta.relationship_type, 
            rawScore, // Keep raw for debugging
            score: 0, // Placeholder, calculated in aggregation
            netCashInvested: netCash, 
            roleWeight, // [New] Pass weight to aggregator
            reasons, 
            sediUrl: null, 
            marketContext,
            txDetailStr,
            sellDetailStr 
        };
    }
}