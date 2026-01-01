/**
 * src/core/analyzer.js (v5.2 - Currency & Dedupe)
 * * Feature: USD Currency Conversion (Fixed rate 1.40).
 * * Feature: Code 30 (Plan Buy) inclusion.
 * * Stability: Transaction Deduplication by ID.
 */

import { Parser } from '../utils/parser.js';

const CONFIG = {
    SCORING: {
        BASE_MARKET_BUY: 50,    
        BASE_PRIVATE_BUY: 35,   
        BASE_EXERCISE: 15,      
        BASE_PLAN_BUY: 10,      // [NEW] 自动定投计划
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
        USD_CAD_RATE: 1.40      // [NEW] 汇率常量
    },
    CODES: {
        PUBLIC_BUY: '10',
        PRIVATE_BUY: ['11', '16'],
        PLAN_BUY: ['30'],       // [NEW]
        EXERCISE: ['51', '54', '57', '59'],
        GRANT: ['50', '53', '56']
    }
};

export class Analyzer {
    static analyze(records, watchlist = new Set()) {
        // [STEP 0] Deduplication Strategy (ID 去重)
        // 防止 API 返回修正前(A)和修正后(New)的两条记录导致重复计算
        const uniqueMap = new Map();
        records.forEach(r => {
            // Map 的特性：后设置的 key 会覆盖前面的。
            // 假设 records 按时间排序，保留最新的；或者直接信赖 ID 唯一性
            uniqueMap.set(r.raw.sedi_transaction_id, r);
        });
        const uniqueRecords = Array.from(uniqueMap.values());

        // Step 1: Group
        const tickerGroups = this._groupByTicker(uniqueRecords);
        const allSignals = [];

        for (const ticker in tickerGroups) {
            const tickerRecords = tickerGroups[ticker];
            // [CRITICAL FIX] Suffix Handling for Watchlist
            // API returns "AEC.TO", Watchlist has "AEC".
            // We strip the suffix to check against the watchlist.
            const cleanTicker = ticker.split('.')[0]; // "AEC.TO" -> "AEC"
            
            // Check both: Raw ("AEC.TO") OR Clean ("AEC")
            const isWatchlisted = watchlist.has(ticker) || watchlist.has(cleanTicker);
            
            const tickerSignals = this._analyzeTicker(ticker, tickerRecords, isWatchlisted);
            allSignals.push(...tickerSignals);
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

    static _analyzeTicker(ticker, records, isWatchlisted) {
        const insiderGroups = this._groupByInsider(records);
        const insiderSignals = [];
        const buyingInsiders = new Set();

        for (const insiderName in insiderGroups) {
            const iRecords = insiderGroups[insiderName];
            const signal = this._evaluateInsider(ticker, insiderName, iRecords, isWatchlisted);
            
            if (signal) {
                insiderSignals.push(signal);
                if (signal.score > 0 && signal.netCashInvested > 0) {
                    buyingInsiders.add(insiderName);
                }
            }
        }

        // Consensus Logic
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
            if (sig.isWatchlisted) return true; // Watchlist 强制显示
            if (sig.score <= 0) return false;
            return sig.score >= 20 && Math.abs(sig.netCashInvested) > 5000;
        });
    }

    static _evaluateInsider(ticker, insiderName, recordList, isWatchlisted) {
        const meta = recordList[0].raw; 
        
        let buyVol = 0; let sellVol = 0;
        let buyCost = 0; let sellProceeds = 0;
        
        let hasPublicBuy = false; 
        let hasPrivateBuy = false;
        let hasPlanBuy = false; // [NEW]
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

            // [NEW] Currency Conversion Logic
            // 检查 exchange_unit_price 是否包含 USD 或 U.S.
            let currencyMultiplier = 1.0;
            const currencyField = (tx.exchange_unit_price || tx.exchange_price || "").toUpperCase();
            if (currencyField.includes("USD") || currencyField.includes("U.S.")) {
                currencyMultiplier = CONFIG.THRESHOLDS.USD_CAD_RATE;
            }

            const cash = absAmount * price * currencyMultiplier;

            if (amount > 0) {
                // --- ACQUISITION ---
                if (code === CONFIG.CODES.PUBLIC_BUY) {
                    hasPublicBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.PRIVATE_BUY.includes(code)) {
                    hasPrivateBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.PLAN_BUY.includes(code)) {
                    // [NEW] Plan Buy 计入资金，但标记不同
                    hasPlanBuy = true;
                    buyVol += absAmount;
                    buyCost += cash;
                } else if (CONFIG.CODES.EXERCISE.includes(code)) {
                    hasExercise = true;
                    buyVol += absAmount;
                    buyCost += cash; 
                }
            } else {
                // --- DISPOSITION ---
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

        // Anomaly Check
        if (Math.abs(netCash) > CONFIG.THRESHOLDS.ANOMALY_CAP) {
            return {
                ticker, insider: insiderName, score: 0, relation: meta.relationship_type,
                reasons: ["⚠️ Data Anomaly"], netCashInvested: netCash, isRiskAlert: true, 
                isWatchlisted, sediUrl, tags: []
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
            score += CONFIG.SCORING.BASE_PLAN_BUY; // 较低的分数 (10分)
            reasons.push("📅 Auto-Plan Buy");
        } else if (hasExercise) {
            score += CONFIG.SCORING.BASE_EXERCISE;
            reasons.push("🎫 Exercised Rights");
        }

        // B. Negative filtering
        if (hasExercise && hasSell) {
            return {
                ticker, insider: insiderName, score: 0, relation: meta.relationship_type,
                reasons: ["⛔ Option Flip"], netCashInvested: netCash, 
                isWatchlisted, sediUrl, tags: []
            };
        }

        // C. Bonuses
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
            tags: []
        };
    }
}