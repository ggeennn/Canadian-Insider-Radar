/**
 * src/config/scoring.js
 * Centralized configuration for Scoring, Thresholds, and Codes.
 * [Optimized] Re-engineered based on Cohen-Malloy-Pomorski "Opportunistic vs. Routine" logic.
 */

export const SCORING_CONFIG = {
    // --- Scoring Weights (Points) ---
    SCORES: {
        // Transaction Types
        BASE_MARKET_BUY: 60,    // [Increased] The gold standard signal. True conviction.
        BASE_PRIVATE_BUY: 20,   // Often carries warrants/dilution. Lower quality signal.
        BASE_PLAN_BUY: 5,       // [Crushed] Routine trades have near-zero predictive power.
        BASE_EXERCISE: 10,      // Mostly compensation realization, neutral signal.
        
        // Insider Context
        RANK_BONUS: 25,         // C-Suite/Directors have superior information asymmetry.
        SIZE_BONUS: 20,         // Base bonus for nominal size.
        CONVICTION_BONUS: 30,   // >25% increase in personal holdings.
        LATE_FILING_BONUS: 15,  // Late filings often delay positive news flow.
        
        // Market Context Modifiers
        PREMIUM_BUY_BONUS: 25,  // Paying >5% above market price = extremely bullish.
        DISCOUNT_PENALTY: -30,  // Buying at discount = "free money", not a market signal.
        UPTREND_BONUS: 10,      // Confirming the trend (Momentum).
        LIQUIDITY_BONUS: 15,    // Buying illiquid stock requires high confidence.
        
        // Penalties
        DILUTION_PENALTY: -40,  // Private Placements that dilute equity.
        CLUSTER_PENALTY: -50    // Used to dampen "Robot Consensus" (e.g. 6 directors DRIP).
    },

    // --- Thresholds & Constants ---
    THRESHOLDS: {
        LARGE_SIZE: 50000,          // Nominal large trade ($50k)
        MEGA_SIZE: 500000,          // Institutional level conviction ($500k)
        HIGH_CONVICTION_PCT: 0.25,  // 25% holding increase
        LATE_FILING_DAYS: 5,        // 5 calendar days late
        
        // [New] Relative Size Thresholds
        // Buying 0.1% of the entire company's Market Cap in one go is massive.
        SIGNIFICANT_IMPACT_RATIO: 0.001, 
        
        USD_CAD_RATE: 1.40,         
        
        // AI Analysis Trigger
        // Only burn tokens on high-quality signals
        AI_ANALYSIS_TRIGGER_SCORE: 90 
    },

    // --- Clustering Logic ---
    CLUSTER: {
        MULTIPLIER: 0.2,        // Standard multiplier for Consensus
        MAX_MULTIPLIER: 2.0,    // Cap the bonus
        PLAN_DAMPENER: 0.0      // Plan buys get ZERO consensus bonus
    },

    // --- SEDI Transaction Codes ---
    CODES: {
        PUBLIC_BUY: '10',       // "Acquisition in the public market"
        PRIVATE_BUY: ['11', '16'], // "Private placement", "Acquisition under prospectus"
        PLAN_BUY: ['30', '31'], // "Acquisition under purchase/ownership plan"
        EXERCISE: ['51', '54', '57', '59'], // Derivatives exercises
        GRANT: ['50', '53', '56'], // Grants (Compensation)
        
        // Noise codes to strictly ignore to save processing time
        IGNORE: ['90', '97', '99', '00', '35', '37', '38'] 
    }
};