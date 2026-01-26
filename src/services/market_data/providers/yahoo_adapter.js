/**
 * src/services/market_data/providers/yahoo_adapter.js (v2.0 - Historical Data Support)
 * Adapter for yahoo-finance2 library (v3+).
 * * [Changelog]
 * 1. Refactored ticker generation logic into `_generateCandidates` (DRY).
 * 2. Added `getHistoricalPrice` to fix Snapshot Bias (Audit Report Ch.4).
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

    /**
     * [Refactor] Extracted from getMarketContext to reuse in getHistoricalPrice.
     * Generates potential Canadian ticker suffixes (.V, .TO, .CN).
     */
    _generateCandidates(ticker) {
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
        
        return [...new Set(candidates)];
    }

    async getMarketContext(ticker) {
        // [Modified] Use the extracted helper method
        const candidates = this._generateCandidates(ticker);

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
                        ma200: quote.twoHundredDayAverage,
                        symbol: symbol // [Added] Return the resolved symbol for future use
                    };
                }
            } catch (e) {
                // Ignore specific fetch errors
            }
        }
        return null;
    }

    /**
     * [New] Implementation for Audit Report Chapter 4.1
     * Fetches historical price for a specific date to compare with Insider Tx Price.
     * @param {string} ticker - Original ticker (e.g. "DNTL")
     * @param {Date} dateObj - Transaction Date
     * @returns {Promise<number|null>} Closing price on that date
     */
    async getHistoricalPrice(ticker, dateObj) {
        if (!dateObj) return null;
        
        const candidates = this._generateCandidates(ticker);
        
        // Define query window: Target Date -> Target Date + 1 Day
        const period1 = dateObj.toISOString().split('T')[0]; 
        const nextDay = new Date(dateObj);
        nextDay.setDate(dateObj.getDate() + 1);
        const period2 = nextDay.toISOString().split('T')[0];

        for (const symbol of candidates) {
            try {
                // Fetch daily history for the specific 24h window
                const history = await this.yf.historical(symbol, {
                    period1: period1,
                    period2: period2,
                    interval: '1d'
                });

                // If we get a record, it means the market was open and symbol is valid
                if (history && history.length > 0) {
                    // Prefer 'adjClose' (Adjusted Close) for accurate return calculation
                    // Fallback to 'close'
                    return history[0].adjClose || history[0].close || null;
                }
            } catch (e) {
                // Symbol might not exist or no data for this date (weekend/holiday)
                continue; 
            }
        }
        return null; // No data found for any candidate
    }
}