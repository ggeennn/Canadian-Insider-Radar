/**
 * src/core/analyzer.js (v3.0 - Professional SEDI Codes)
 * * Feature: Full SEDI Transaction Code Support.
 * * Logic: Distinguish between Grants (Comp), Exercises (Conversion), and Market Buys (Conviction).
 * * Ref: Official SEDI Codes (10, 11, 16, 30, 50-59, etc.)
 */

import { Parser } from '../utils/parser.js';

// --- A. SEDI Code Definitions ---
const CODES = {
    // General
    OPENING_BALANCE: '00',
    PUBLIC_MARKET: '10',    // The Gold Standard (Buy/Sell)
    PRIVATE_MARKET: '11',
    PROSPECTUS: '15',
    PROSPECTUS_EXEMPT: '16', // Private Placement (Accredited Investors)
    TAKEOVER: '22',
    PLAN: '30',             // ESPP / DRIP (Passive)
    STOCK_DIVIDEND: '35',
    CONVERSION: '36',
    
    // Issuer Derivatives (The Noise Makers)
    GRANT_OPTIONS: '50',
    EXERCISE_OPTIONS: '51',
    EXPIRATION_OPTIONS: '52',
    GRANT_WARRANTS: '53',
    EXERCISE_WARRANTS: '54',
    EXPIRATION_WARRANTS: '55',
    GRANT_RIGHTS: '56',     // RSU/DSU Grants often here
    EXERCISE_RIGHTS: '57',  // RSU/DSU Settlement
    EXPIRATION_RIGHTS: '58',
    EXERCISE_CASH: '59'
};

// Security Types Keywords (用于识别衍生品)
const DERIVATIVE_KEYWORDS = [
    'Option', 'Warrant', 'Right', 'RSU', 'DSU', 'PSU', 'Unit', 
    'Debenture', 'Deferred', 'Restricted', 'Performance'
];

export class Analyzer {
    /**
     * Analyze a batch of transactions.
     * @param {Array} records - Records containing { raw: { ... } } structure
     * @param {Set} watchlist - Tickers to watch closely
     */
    static analyze(records, watchlist = new Set()) {
        const grouped = this._groupByInsiderAndDate(records);
        const signals = [];

        for (const key in grouped) {
            const group = grouped[key];
            const ticker = group[0].raw.symbol; 
            const isWatchlisted = watchlist.has(ticker);

            const result = this._evaluateGroup(group, isWatchlisted);
            
            // Filter Logic
            if (isWatchlisted) {
                // Watchlist: Report ANY activity that isn't purely noise
                if (result.score !== 0 || result.isRiskAlert || result.isSignificant) {
                    result.tags.push("👀 WATCHLIST");
                    signals.push(result);
                }
            } else {
                // Standard: Only High Score Buys
                if (result.score > 0 && result.netCashInvested > 5000) {
                    signals.push(result);
                }
            }
        }
        return signals.sort((a, b) => b.score - a.score);
    }

    static _groupByInsiderAndDate(records) {
        const groups = {};
        records.forEach(record => {
            const tx = record.raw;
            // Key: Insider + Date (Transaction Date, not Filing Date for analysis logic)
            // Note: In backtesting, we might verify filing_date lag.
            const key = `${tx.insider_name}|${tx.transaction_date}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(record);
        });
        return groups;
    }

    static _evaluateGroup(recordList, isWatchlisted) {
        let buyVol = 0; let sellVol = 0;
        let buyCost = 0; let sellProceeds = 0;
        
        // Flags
        let hasPublicBuy = false;   // Code 10 Buy
        let hasPublicSell = false;  // Code 10 Sell
        let hasPrivateBuy = false;  // Code 11/16
        let hasExercise = false;    // Code 51/54/57/59
        let hasGrant = false;       // Code 50/53/56
        let hasPlan = false;        // Code 30

        const meta = recordList[0].raw;
        const summary = {
            insider: meta.insider_name,
            date: meta.transaction_date,
            relation: meta.relationship_type,
            ticker: meta.symbol,
            reasons: [],
            tags: [],
            isRiskAlert: false,
            isSignificant: false
        };

        // --- A. Process Transactions ---
        recordList.forEach(record => {
            const tx = record.raw;
            
            // 1. Parse Numbers
            // Price Logic: Try price -> unit_price -> 0
            let priceVal = Parser.cleanNumber(tx.price);
            if (priceVal === 0 && tx.unit_price) {
                priceVal = Parser.cleanNumber(tx.unit_price);
            }
            
            const rawAmount = Parser.cleanNumber(tx.number_moved); // Signed: +Buy, -Sell
            const amount = Math.abs(rawAmount);
            const cashFlow = amount * priceVal;
            
            const code = Parser.extractTxCode(tx.type); // e.g., "10"
            const security = tx.security || "";
            
            // 2. Classify Action
            if (rawAmount > 0) {
                // --- ACQUISITION (获得) ---
                
                // Categorize by Code
                if (code === CODES.PUBLIC_MARKET) {
                    hasPublicBuy = true;
                    buyVol += amount;
                    buyCost += cashFlow;
                } 
                else if ([CODES.PRIVATE_MARKET, CODES.PROSPECTUS_EXEMPT].includes(code)) {
                    hasPrivateBuy = true;
                    buyVol += amount;
                    buyCost += cashFlow;
                }
                else if (code === CODES.PLAN) {
                    hasPlan = true;
                    buyVol += amount;
                    buyCost += cashFlow;
                }
                else if ([CODES.GRANT_OPTIONS, CODES.GRANT_WARRANTS, CODES.GRANT_RIGHTS].includes(code)) {
                    hasGrant = true;
                    // Grants usually have Price=0 or Strike Price (not cash paid now). 
                    // We DO NOT add to buyCost because they didn't pay cash yet.
                }
                else if ([CODES.EXERCISE_OPTIONS, CODES.EXERCISE_WARRANTS, CODES.EXERCISE_RIGHTS, CODES.EXERCISE_CASH].includes(code)) {
                    hasExercise = true;
                    // If they exercised, they acquired shares.
                    buyVol += amount;
                    buyCost += cashFlow; // Assuming priceVal is the Exercise Price paid
                }

            } else if (rawAmount < 0) {
                // --- DISPOSITION (处置) ---
                
                if (code === CODES.PUBLIC_MARKET) {
                    hasPublicSell = true;
                    sellVol += amount;
                    sellProceeds += cashFlow;
                }
                else if ([CODES.PRIVATE_MARKET, CODES.PROSPECTUS_EXEMPT].includes(code)) {
                    sellVol += amount;
                    sellProceeds += cashFlow;
                }
                // Check if this is an "Exercise" event (Source side: Option count decreases)
                else if ([CODES.EXERCISE_OPTIONS, CODES.EXERCISE_WARRANTS, CODES.EXERCISE_RIGHTS].includes(code)) {
                    // This is just the derivative disappearing. Not a "Sell" of equity.
                    // Ignore for net equity calculation, but note the event.
                    hasExercise = true;
                }
                else {
                    // Other sells (Plan sell, Gift, etc.)
                    sellVol += amount;
                    sellProceeds += cashFlow;
                }
            }
        });

        const netCashInvested = buyCost - sellProceeds;

        // --- B. Scoring Engine ---
        let score = 0;

        // 1. Positive Drivers (加分项)
        if (hasPublicBuy) {
            score += 50; // 公开市场买入：最强信号
            summary.reasons.push("🔥 Market Buy (Code 10)");
        }
        else if (hasPrivateBuy) {
            score += 20; // 私募：中等信号 (有锁定期)
            summary.reasons.push("🔒 Private Placement (Code 11/16)");
        }
        else if (hasPlan && !hasGrant) {
            score += 10; // 自动计划：低信号
            summary.reasons.push("📅 Purchase Plan (Code 30)");
        }

        // 2. Negative/Trap Drivers (减分/过滤项)
        
        // Trap: Option Flip (Exercise + Sell)
        // 既有行权 (获得股票) 又有卖出 (抛售股票)
        if (hasExercise && (hasPublicSell || sellVol > 0)) {
            summary.reasons.push("⛔ Option Flip (Exercised & Sold)");
            score = -10; // 这是一个套利行为，不是看涨
        }

        // Trap: Grant Only (Compensation)
        // 只有 Grant，没有真金白银投入
        if (hasGrant && buyCost === 0 && !hasPublicBuy) {
            summary.reasons.push("🎁 Compensation Grant (No Cash)");
            score = 0;
        }

        // 3. Multipliers (乘数效应)
        if (score > 0) {
            // Insider Rank
            if (summary.relation.includes('Senior Officer') || summary.relation.includes('Director')) {
                score += 20;
                summary.reasons.push("⭐ Top Insider");
            }
            // Size Threshold (Dynamic)
            if (netCashInvested > 50000) {
                score += 20;
                summary.reasons.push("💰 Large Size (>50k)");
                summary.isSignificant = true;
            }
        }

        // --- C. Watchlist Logic ---
        if (isWatchlisted) {
            if (hasPublicSell) {
                summary.isRiskAlert = true;
                summary.reasons.push("🚨 ALERT: Market Sell on Watchlist");
            }
            if (hasExercise && !hasPublicSell) {
                summary.reasons.push("ℹ️ Info: Exercised Options (Hold)");
            }
        }

        // Result Construction
        return {
            ...summary,
            score,
            netCashInvested,
            netVol: buyVol - sellVol
        };
    }
}