import { Analyzer } from './src/core/analyzer.js';

// Mock Data adapted for v3.0 logic
const mockRawRecords = [
    // 1. CEO Market Buy (Code 10) - Should be High Score
    {
        raw: {
            symbol: "T.TO", insider_name: "Darren Entwistle", transaction_date: "2025-12-19",
            relationship_type: "5 - Senior Officer", type: "10 - Acquisition in public market",
            number_moved: "+10000", price: "17.50", security: "Common Shares"
        }
    },
    // 2. Officer Grant (Code 56) - Should be Zero Score
    {
        raw: {
            symbol: "T.TO", insider_name: "Mario Mele", transaction_date: "2025-11-26",
            relationship_type: "5 - Senior Officer", type: "56 - Grant of rights",
            number_moved: "+5000", price: "0", security: "RSU"
        }
    },
    // 3. Watchlist Sell (Code 10 Sell) - Should Alert
    {
        raw: {
            symbol: "SUNN", insider_name: "Paper Hands", transaction_date: "2025-12-30",
            relationship_type: "4 - Director", type: "10 - Disposition in public market",
            number_moved: "-5000", price: "1.50", security: "Common Shares"
        }
    }
];

const watchlist = new Set(["SUNN"]);
const signals = Analyzer.analyze(mockRawRecords, watchlist);

console.log("🧠 Analyzer v3.0 Test Results:\n");
signals.forEach(s => {
    console.log(`User: ${s.insider} | Score: ${s.score} | Cash: $${s.netCashInvested}`);
    console.log(`Reasons: ${s.reasons.join(", ")}`);
    console.log("---");
});