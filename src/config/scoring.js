/**
 * src/config/scoring.js (v10.1 - Optimization Release)
 * * [Audit Implementation]
 * 1. Added Sigmoid Parameters for Probability Normalization.
 * 2. Added Role Multipliers for Weighted Flow Analysis.
 * 3. Refined Scores based on Statistical Properties.
 */

export const SCORING_CONFIG = {
    // --- [New] Sigmoid Normalization Config (Phase 1) ---
    // Formula: 100 / (1 + Math.exp(-k * (rawScore - midpoint)))
    // Target: Map unbounded scores to 0-100 probability scale.
    SIGMOID: {
        k: 0.1,        // Steepness (陡峭度): Controls sensitivity around the midpoint.
        midpoint: 50   // Pivot Point (中点): Score considered "Neutral" (50% probability).
    },

    // --- [New] Role Weights (Phase 2) ---
    // Based on Information Asymmetry Theory (Wang et al., 2012)
    // CFOs > CEOs > Senior Officers > Directors > 10% Owners
    ROLE_MULTIPLIERS: {
        CFO: 2.0,           // Highest info asymmetry (Financial health access)
        CEO: 1.5,           // High info, but potential signaling/PR bias
        OFFICER: 1.2,       // Operational insight (VP, Senior Officer)
        DIRECTOR: 1.0,      // Baseline (Non-executive directors)
        OWNER: 0.5,         // Low signal-to-noise (Funds, VC exits)
        DEFAULT: 1.0
    },

    // --- Scoring Weights (Points) ---
    // Re-calibrated for Linear Inputs before Sigmoid
    SCORES: {
        // [Categorical] Transaction Quality
        PREMIUM_COMMON_BUY: 60, // Reduced from 80 (Let volume/role drive the score)
        BASE_MARKET_BUY: 40,    
        BASE_PRIVATE_BUY: 10,   // High dilution risk
        BASE_PLAN_BUY: 0,       // Plans are noise, 0 points (neutral)
        
        // [Ordinal] Insider Context
        RANK_BONUS: 20,         // Additional bonus on top of Role Multiplier
        CONVICTION_BONUS: 25,   // >25% holdings increase
        
        // [Continuous/Binary] Market Context
        PREMIUM_PRICE_BONUS: 20,// Buying above market price (Strength)
        DISCOUNT_PENALTY: -20,  // Buying below market (Weakness/Warrants)
        UPTREND_BONUS: 10,      
        
        // [Event] Penalties
        DILUTION_PENALTY: -30,
        CLUSTER_PENALTY: -50,   // Robot consensus
        SELLING_PRESSURE_PENALTY: -40 // [New] Replaces hardcoded -50 in Analyzer
    },

    // --- Thresholds & Constants ---
    THRESHOLDS: {
        LOOKBACK_DAYS: 45,          // Extended lookback for better trend analysis
        
        // Size Filters
        LARGE_SIZE: 50000,          // $50k
        SIGNIFICANT_IMPACT_RATIO: 0.001, // 0.1% of Market Cap

        USD_CAD_RATE: 1.40,         
        AI_ANALYSIS_TRIGGER_SCORE: 75 // [Adjusted] Lower threshold due to Sigmoid normalization
    },

    // --- Anomaly Detection ---
    ANOMALY: {
        MAX_PRICE_DISCREPANCY: 5.0, 
        MAX_CAP_IMPACT: 0.10,
        SUSPICIOUS_PRICE_VOL_MATCH_TOLERANCE: 1.0 
    },

    // --- Clustering Logic ---
    CLUSTER: {
        WINDOW_DAYS: 7,         // [New] Sliding window size
        MIN_INSIDERS: 2,        // Minimum unique insiders for a cluster
        MULTIPLIER: 1.2         // 20% Boost for cluster events
    },

    // --- SEDI Transaction Codes (Unchanged) ---
    CODES: {
        PUBLIC_BUY: '10',       
        PRIVATE_BUY: ['11', '16'], 
        PLAN_BUY: ['30', '31'], 
        EXERCISE: ['51', '54', '57', '59'], 
        GRANT: ['50', '52', '53','55', '56'], 
        IGNORE: ['90', '97', '99', '00', '35', '37', '38'] 
    }
};