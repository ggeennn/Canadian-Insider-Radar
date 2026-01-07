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


        let candidates = [];
        
        if (existingSuffix === ticker) { 
            candidates.push(`${rootTicker}.V`);  // TSX Venture 
            candidates.push(`${rootTicker}.TO`); // TSX Main
            candidates.push(`${rootTicker}.CN`); // CSE
            candidates.push(ticker);            
        } else {
            candidates.push(ticker);
            if (existingSuffix === 'CN') candidates.push(`${rootTicker}.CSE`);
            if (existingSuffix === 'CSE') candidates.push(`${rootTicker}.CN`);
            if (existingSuffix === 'V') candidates.push(`${rootTicker}.TO`);
        }
        
        candidates = [...new Set(candidates)];

        for (const symbol of candidates) {
            try {
                const quote = await this.yf.quote(symbol);

                if (quote && quote.currency === 'CAD') {
                    return {
                        price: quote.regularMarketPrice,
                        volume: quote.regularMarketVolume,        
                        avgVolume: quote.averageDailyVolume3Month, 
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