/**
 * src/config/scoring.js
 * Centralized configuration for Scoring, Thresholds, and Codes.
 */

export const SCORING_CONFIG = {
    // --- 评分权重 (Points) ---
    SCORES: {
        BASE_MARKET_BUY: 50,    // 公开市场买入 (最强)
        BASE_PRIVATE_BUY: 35,   // 私募配售
        BASE_PLAN_BUY: 10,      // 自动定投计划
        BASE_EXERCISE: 15,      // 行权
        
        RANK_BONUS: 20,         // 高管/董事加分
        SIZE_BONUS: 20,         // 大额交易加分
        CONVICTION_BONUS: 25,   // 持仓大幅增加加分
        LATE_FILING_BONUS: 10,  // 延迟申报加分
        
        // 市场环境修正分 (New)
        PREMIUM_BUY_BONUS: 20,  // 溢价买入
        DISCOUNT_PENALTY: -25,  // 深折扣行权
        UPTREND_BONUS: 5,       // 顺势交易
        LIQUIDITY_BONUS: 10     // 强力吸筹
    },

    // --- 阈值门槛 (Thresholds) ---
    THRESHOLDS: {
        LARGE_SIZE: 50000,          // 大额资金线 ($50k)
        HIGH_CONVICTION_PCT: 0.20,  // 持仓增幅 (20%)
        LATE_FILING_DAYS: 5,        // 迟报天数
        ANOMALY_CAP: 100000000,     // 数据异常熔断值
        
        USD_CAD_RATE: 1.40,         // 汇率
        
        // AI 触发阈值 (New)
        AI_ANALYSIS_TRIGGER_SCORE: 100 // 只有分数 > 100 才调用 AI
    },

    // --- 聚类乘数 ---
    CLUSTER: {
        MULTIPLIER: 0.2 // 每多一个人买入，总分 x 1.2
    },

    // --- 交易代码 (SEDI Codes) ---
    CODES: {
        PUBLIC_BUY: '10',
        PRIVATE_BUY: ['11', '16'],
        PLAN_BUY: ['30'],
        EXERCISE: ['51', '54', '57', '59'],
        GRANT: ['50', '53', '56']
    }
};