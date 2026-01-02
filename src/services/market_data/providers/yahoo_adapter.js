/**
 * src/services/market_data/providers/yahoo_adapter.js
 * Adapter for yahoo-finance2 library (v3+).
 * [Refined] Enforces CAD currency check and prioritizes Canadian suffixes.
 */
import YahooFinance from 'yahoo-finance2';

export class YahooAdapter {
    constructor() {
        let YFClass = YahooFinance;
        if (typeof YFClass !== 'function' && YFClass && YFClass.default) {
            YFClass = YFClass.default;
        }

        try {
            this.yf = new YFClass({
                logger: { info: () => {}, warn: () => {}, error: (...args) => console.error(...args) }
            });
        } catch (e) {
            console.error("🚨 YahooAdapter Init Error:", e);
            throw new Error("Failed to instantiate YahooFinance class.");
        }
    }

    async getMarketContext(ticker) {
        const rootTicker = ticker.replace(/\.(TO|V|CN|CSE|K)$/i, '');
        const existingSuffix = ticker.split('.').pop();

        // 优化：不再把无后缀的原始 ticker 放在第一位，而是放在最后做兜底
        // 这样可以避免意外匹配到美股同名代码
        let candidates = [];
        
        if (existingSuffix === ticker) { 
            // 无后缀输入 (e.g. "AEC") -> 优先尝试加拿大后缀
            candidates.push(`${rootTicker}.V`);  // TSX Venture (微盘股最多)
            candidates.push(`${rootTicker}.TO`); // TSX Main
            candidates.push(`${rootTicker}.CN`); // CSE
            candidates.push(ticker);             // 最后才试原样
        } else {
            // 有后缀输入 -> 优先尝试互换
            candidates.push(ticker);
            if (existingSuffix === 'CN') candidates.push(`${rootTicker}.CSE`);
            if (existingSuffix === 'CSE') candidates.push(`${rootTicker}.CN`);
            if (existingSuffix === 'V') candidates.push(`${rootTicker}.TO`);
        }
        
        candidates = [...new Set(candidates)];

        for (const symbol of candidates) {
            try {
                const quote = await this.yf.quote(symbol);

                // [CRITICAL CHECK] 强制检查货币是否为 CAD
                // 这能防止 T (Telus) 匹配到 AT&T (USD)
                if (quote && quote.currency === 'CAD') {
                    return {
                        price: quote.regularMarketPrice,
                        volume: quote.regularMarketVolume,         // 当日成交量
                        avgVolume: quote.averageDailyVolume3Month, // 3个月平均 (用于计算 Impact)
                        marketCap: quote.marketCap,
                        currency: quote.currency,
                        high52w: quote.fiftyTwoWeekHigh,
                        low52w: quote.fiftyTwoWeekLow,
                        ma50: quote.fiftyDayAverage,
                        ma200: quote.twoHundredDayAverage
                    };
                }
            } catch (e) {
                // Ignore specific fetch errors
            }
        }
        return null;
    }
}