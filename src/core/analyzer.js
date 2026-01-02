/**
 * src/core/analyzer.js (v7.0 - Hedge Fund Grade Logic)
 * * Feature: Two-Stage Analysis (Lazy Loading).
 * * Feature: Granular Market Context (Trend, Positioning, Valuation).
 * * Feature: Zombie Defense (Score Capping).
 */
import { Parser } from '../utils/parser.js';
import { MarketContextFactory } from '../services/market_data/market_context_factory.js';

const CONFIG = {
    SCORING: {
        BASE_MARKET_BUY: 50,    
        BASE_PRIVATE_BUY: 35,   
        BASE_PLAN_BUY: 10,      
        BASE_EXERCISE: 15,      
        RANK_BONUS: 20,         
        SIZE_BONUS: 20,         
        CONVICTION_BONUS: 25,   
        LATE_FILING_BONUS: 10,  
        CLUSTER_MULTIPLIER: 0.2 
    },
    THRESHOLDS: {
        LARGE_SIZE: 50000,
        HIGH_CONVICTION_PCT: 0.20, 
        LATE_FILING_DAYS: 5,
        ANOMALY_CAP: 100000000,
        USD_CAD_RATE: 1.40      
    },
    CODES: {
        PUBLIC_BUY: '10',
        PRIVATE_BUY: ['11', '16'],
        PLAN_BUY: ['30'],       
        EXERCISE: ['51', '54', '57', '59'],
        GRANT: ['50', '53', '56']
    }
};

export class Analyzer {
    /**
     * Main Entry Point (Async)
     */
    static async analyze(records, watchlist = new Set()) {
        // [Deduplication] ID 去重
        const uniqueMap = new Map();
        records.forEach(r => {
            uniqueMap.set(r.raw.sedi_transaction_id, r);
        });
        const uniqueRecords = Array.from(uniqueMap.values());

        const tickerGroups = this._groupByTicker(uniqueRecords);
        const allSignals = [];

        for (const ticker in tickerGroups) {
            const tickerRecords = tickerGroups[ticker];
            
            // Suffix Handling: "AEC.TO" -> "AEC" for Watchlist matching
            const cleanTicker = ticker.split('.')[0]; 
            const isWatchlisted = watchlist.has(ticker) || watchlist.has(cleanTicker);
            
            const tickerSignals = await this._analyzeTicker(ticker, tickerRecords, isWatchlisted);
            
            if (tickerSignals && tickerSignals.length > 0) {
                allSignals.push(...tickerSignals);
            }
        }

        return allSignals.sort((a, b) => b.score - a.score);
    }

    static _groupByTicker(records) {
        return records.reduce((acc, record) => {
            const ticker = record.symbol || record.raw.symbol;
            if (!acc[ticker]) acc[ticker] = [];
            acc[ticker].push(record);
            return acc;
        }, {});
    }

    static _groupByInsider(records) {
        return records.reduce((acc, record) => {
            const name = record.raw.insider_name;
            if (!acc[name]) acc[name] = [];
            acc[name].push(record);
            return acc;
        }, {});
    }

    static async _analyzeTicker(ticker, records, isWatchlisted) {
        const insiderGroups = this._groupByInsider(records);
        const insiderSignals = [];
        
        // --- Stage 1: Fast Pass (本地快速初筛) ---
        const candidates = [];
        for (const insiderName in insiderGroups) {
            const iRecords = insiderGroups[insiderName];
            // 初评：无市场数据
            const rawSignal = this._evaluateInsider(ticker, insiderName, iRecords, isWatchlisted, null);
            
            // Gatekeeper: 值得查股价吗？
            // 1. 分数尚可 (>=30)
            // 2. OR 钱多 (>$10k)
            // 3. OR 在监控列表
            if (rawSignal && (rawSignal.score >= 30 || Math.abs(rawSignal.netCashInvested) > 10000 || isWatchlisted)) {
                candidates.push({ name: insiderName, records: iRecords });
            }
        }

        if (candidates.length === 0) return [];

        // --- Stage 2: Data Enrichment (外部数据增强) ---
        let marketContext = null;
        try {
            const provider = MarketContextFactory.getProvider();
            marketContext = await provider.getMarketContext(ticker);
            // 可以在这里打印日志确认获取成功，但在 index.js 打印更整齐
        } catch (e) {
            // console.warn(`⚠️ Market Data skipped: ${e.message}`);
        }

        // --- Stage 3: Final Scoring (最终评分) ---
        const buyingInsiders = new Set();

        for (const candidate of candidates) {
            // 复评：带入市场数据
            const finalSignal = this._evaluateInsider(ticker, candidate.name, candidate.records, isWatchlisted, marketContext);
            
            if (finalSignal) {
                insiderSignals.push(finalSignal);
                if (finalSignal.score > 0 && finalSignal.netCashInvested > 0) {
                    buyingInsiders.add(candidate.name);
                }
            }
        }

        // --- Consensus Logic ---
        const buyerCount = buyingInsiders.size;
        if (buyerCount > 1) {
            const multiplier = 1 + ((buyerCount - 1) * CONFIG.SCORING.CLUSTER_MULTIPLIER); 
            insiderSignals.forEach(sig => {
                if (sig.score > 0 && sig.netCashInvested > 0) {
                    sig.score = Math.round(sig.score * multiplier);
                    sig.reasons.push(`👥 Consensus (${buyerCount})`);
                }
            });
        }

        return insiderSignals.filter(sig => {
            if (sig.isWatchlisted) return true; 
            if (sig.score <= 0) return false;
            return sig.score >= 20 && Math.abs(sig.netCashInvested) > 5000;
        });
    }

    static _evaluateInsider(ticker, insiderName, recordList, isWatchlisted, marketContext = null) {
        const meta = recordList[0].raw; 
        
        let buyVol = 0; let sellVol = 0;
        let buyCost = 0; let sellProceeds = 0;
        
        let hasPublicBuy = false; 
        let hasPrivateBuy = false;
        let hasPlanBuy = false; 
        let hasExercise = false; 
        let hasSell = false;

        const sortedByDate = [...recordList].sort((a, b) => 
            new Date(b.raw.transaction_date) - new Date(a.raw.transaction_date)
        );
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
            if (currencyField.includes("USD") || currencyField.includes("U.S.")) {
                currencyMultiplier = CONFIG.THRESHOLDS.USD_CAD_RATE;
            }

            const cash = absAmount * price * currencyMultiplier;

            if (amount > 0) {
                if (code === CONFIG.CODES.PUBLIC_BUY) {
                    hasPublicBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.PRIVATE_BUY.includes(code)) {
                    hasPrivateBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.PLAN_BUY.includes(code)) {
                    hasPlanBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.EXERCISE.includes(code)) {
                    hasExercise = true;
                    buyVol += absAmount;
                    buyCost += cash; 
                }
            } else {
                if (code === CONFIG.CODES.PUBLIC_BUY) { 
                    hasSell = true;
                    sellVol += absAmount;
                    sellProceeds += cash;
                }
            }
        });

        const netCash = buyCost - sellProceeds;
        
        const sediUrl = meta.issuer_number 
            ? `https://ceo.ca/content/sedi/issuers/${meta.issuer_number}`
            : null;

        if (Math.abs(netCash) > CONFIG.THRESHOLDS.ANOMALY_CAP) {
            return {
                ticker, insider: insiderName, score: 0, relation: meta.relationship_type,
                reasons: ["⚠️ Data Anomaly"], netCashInvested: netCash, isRiskAlert: true, 
                isWatchlisted, sediUrl, tags: [], marketContext
            };
        }

        // --- Scoring ---
        let score = 0;
        const reasons = [];

        // A. Base Score
        if (hasPublicBuy) {
            score += CONFIG.SCORING.BASE_MARKET_BUY;
            reasons.push("🔥 Market Buy");
        } else if (hasPrivateBuy) {
            score += CONFIG.SCORING.BASE_PRIVATE_BUY;
            reasons.push("🔒 Private Placement");
        } else if (hasPlanBuy) {
            score += CONFIG.SCORING.BASE_PLAN_BUY; 
            reasons.push("📅 Auto-Plan Buy");
        } else if (hasExercise) {
            score += CONFIG.SCORING.BASE_EXERCISE;
            reasons.push("🎫 Exercised Rights");
        }

        // ====================================================
        // [UPGRADED] Market Context Modifiers (v7.0)
        // ====================================================
        if (marketContext && marketContext.price > 0) {
            const m = marketContext; 
            
            // 1. Price Efficiency (价格锚点)
            const avgBuyPrice = buyVol > 0 ? (buyCost / buyVol) : 0;
            if (avgBuyPrice > 0) {
                // 计算折价率 (e.g. 现价1.0, 成本0.7 -> Discount 0.3)
                const discountRate = (m.price - avgBuyPrice) / m.price;
                
                if (discountRate > 0.30) {
                    score -= 25; 
                    reasons.push(`📉 Deep Discount (Cost $${avgBuyPrice.toFixed(2)} vs Mkt $${m.price.toFixed(2)})`);
                } else if (discountRate > 0.10) {
                    score -= 10; 
                    reasons.push(`🏷️ Discounted (-${(discountRate*100).toFixed(0)}%)`);
                } else if (discountRate < -0.05) {
                    score += 20; 
                    reasons.push(`💪 Premium Buy (Cost $${avgBuyPrice.toFixed(2)} > Mkt $${m.price.toFixed(2)})`);
                } else {
                    // 市价附近
                    if (hasPublicBuy) {
                        score += 10; 
                        reasons.push(`⚖️ At Market Price`);
                    }
                }
            }

            // 2. Positioning (位置感)
            if (m.high52w && m.low52w) {
                const range = m.high52w - m.low52w;
                // 位置百分比: 0.0 (Low) -> 1.0 (High)
                const position = range > 0 ? (m.price - m.low52w) / range : 0.5;
                
                if (position < 0.15) {
                    score += 15;
                    reasons.push(`⚓ Bottom Fishing (Near 52w Low: $${m.low52w})`);
                } else if (position > 0.85) {
                    score += 15;
                    reasons.push(`🚀 Breakout Play (Near 52w High: $${m.high52w})`);
                }
            }

            // 3. Trend (趋势)
            if (m.ma50) {
                if (m.price > m.ma50) {
                    reasons.push(`📈 Uptrend (>MA50 $${m.ma50.toFixed(2)})`);
                    score += 5;
                } else {
                    reasons.push(`📉 Downtrend (<MA50 $${m.ma50.toFixed(2)})`);
                }
            }

            // 4. Zombie Defense (僵尸股防御)
            // 市值 < $3M 或 日成交 < $5k -> 流动性枯竭
            const isZombie = (m.marketCap && m.marketCap < 3000000) || (m.avgVolume && m.avgVolume * m.price < 5000);
            if (isZombie) {
                reasons.push(`🧟 Illiquid/Nano-Cap`);
                if (score > 80) score = 80; // 封顶
            }

            // 5. Liquidity Impact (吸筹力度)
            if (m.avgVolume > 0) {
                const volumeImpact = (buyVol - sellVol) / m.avgVolume;
                if (volumeImpact > 0.15) { 
                    if (!isZombie) score += 10;
                    reasons.push(`🌊 High Vol Impact (${(volumeImpact*100).toFixed(0)}% of Daily)`);
                }
            }
        }

        // B. Negative filtering
        if (hasExercise && hasSell) {
            return {
                ticker, insider: insiderName, score: 0, relation: meta.relationship_type,
                reasons: ["⛔ Option Flip"], netCashInvested: netCash, 
                isWatchlisted, sediUrl, tags: [], marketContext
            };
        }

        // C. Bonuses (Rank, Size, Conviction)
        const isTopInsider = meta.relationship_type && (meta.relationship_type.includes('Director') || meta.relationship_type.includes('Senior Officer'));
        if (isTopInsider && score > 0) {
            score += CONFIG.SCORING.RANK_BONUS;
            reasons.push("⭐ Top Insider");
        }

        if (netCash > CONFIG.THRESHOLDS.LARGE_SIZE) {
            score += CONFIG.SCORING.SIZE_BONUS;
            reasons.push("💰 Large Size");
        }

        if (buyVol > 0 && score > 0) {
            const netVol = buyVol - sellVol;
            const initialHoldings = finalBalance - netVol;
            let pctIncrease = 0;
            
            if (initialHoldings <= 0) {
                 if (netVol > 0) {
                    reasons.push("🆕 New Position");
                    score += 10; 
                 }
            } else {
                pctIncrease = netVol / initialHoldings;
            }

            if (pctIncrease > CONFIG.THRESHOLDS.HIGH_CONVICTION_PCT) {
                score += CONFIG.SCORING.CONVICTION_BONUS;
                reasons.push(`🚀 +${(pctIncrease*100).toFixed(0)}% Holdings`);
            }
        }

        // D. Filing Lag
        const fileDateStr = (meta.filing_date && meta.filing_date.length > 10) ? meta.filing_date.substring(0, 10) : meta.filing_date;
        if (fileDateStr) {
            const diffDays = Math.ceil(Math.abs(new Date(fileDateStr) - new Date(meta.transaction_date)) / (86400000)); 
            if (diffDays > CONFIG.THRESHOLDS.LATE_FILING_DAYS && score > 0) {
                score += CONFIG.SCORING.LATE_FILING_BONUS;
                reasons.push(`🐢 ${diffDays}d Late`);
            }
        }

        return {
            ticker,
            insider: insiderName,
            relation: meta.relationship_type,
            score,
            netCashInvested: netCash,
            reasons,
            isWatchlisted, 
            sediUrl,       
            tags: [],
            marketContext // 传出去给 Logger 用
        };
    }
}