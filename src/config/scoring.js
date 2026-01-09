/**
 * src/config/scoring.js
 * Centralized configuration for Scoring, Thresholds, and Codes.
 * Added Anomaly Detection & Semantic Weighting.
 */

export const SCORING_CONFIG = {
    // --- Scoring Weights (Points) ---
    SCORES: {
        // Transaction Types
        // [New] Distinguish Common Shares vs. Others
        PREMIUM_COMMON_BUY: 80, // "Gold Standard": Public buy of Common Shares
        BASE_MARKET_BUY: 50,    // Standard market buy (could be warrants/units)
        BASE_PRIVATE_BUY: 15,   // Often carries warrants/dilution. Lower quality.
        BASE_PLAN_BUY: 5,       // Routine trades have near-zero predictive power.
        BASE_EXERCISE: 5,       // [Lowered] Mostly compensation realization.
        
        // Insider Context
        RANK_BONUS: 25,         // C-Suite/Directors have superior info.
        SIZE_BONUS: 20,         // Base bonus for nominal size.
        CONVICTION_BONUS: 30,   // >25% increase in personal holdings.
        
        // Market Context Modifiers
        PREMIUM_BUY_BONUS: 25,  // Paying >5% above market price.
        DISCOUNT_PENALTY: -30,  // Buying at discount.
        UPTREND_BONUS: 10,      // Momentum confirmation.
        
        // Penalties
        DILUTION_PENALTY: -40,  // Private Placements.
        CLUSTER_PENALTY: -50    // Robot Consensus.
    },

    // --- Thresholds & Constants ---
    THRESHOLDS: {
        // Analysis Window
        LOOKBACK_DAYS: 30,          // [New] Only analyze data from last 45 days
        
        // Size
        LARGE_SIZE: 50000,          // $50k
        MEGA_SIZE: 500000,          // $500k
        SIGNIFICANT_IMPACT_RATIO: 0.001, // 0.1% of Market Cap

        USD_CAD_RATE: 1.40,         
        AI_ANALYSIS_TRIGGER_SCORE: 90 
    },

    // --- [New] Anomaly Detection / Sanity Checks ---
    ANOMALY: {
        // If Tx Price > 5x Market Price -> Likely Data Error (e.g. DMGI)
        MAX_PRICE_DISCREPANCY: 5.0, 
        
        // If Single Tx > 10% of Market Cap -> Likely Error (e.g. SOI)
        MAX_CAP_IMPACT: 0.10,

        // If Price is suspiciously close to Volume (e.g. Price 29906 vs Vol 29906)
        // This handles the specific data corruption seen in DMGI
        SUSPICIOUS_PRICE_VOL_MATCH_TOLERANCE: 1.0 
    },

    // --- Clustering Logic ---
    CLUSTER: {
        MULTIPLIER: 0.2,        
        MAX_MULTIPLIER: 2.0,    
    },

    // --- SEDI Transaction Codes ---
    CODES: {
        PUBLIC_BUY: '10',       // "Acquisition in the public market"
        PRIVATE_BUY: ['11', '16'], 
        PLAN_BUY: ['30', '31'], 
        EXERCISE: ['51', '54', '57', '59'], 
        GRANT: ['50', '52', '53','55', '56'], 
        
        // Noise codes
        IGNORE: ['90', '97', '99', '00', '35', '37', '38'] 
    }
};