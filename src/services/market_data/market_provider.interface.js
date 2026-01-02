/**
 * src/services/market_data/market_provider.interface.js
 * * [Architecture Note]
 * This acts as an Abstract Base Class (ABC) or Interface.
 * It defines the "Contract" that all adapters (Yahoo, AlphaVantage, Bloomberg) must follow.
 * This allows us to switch data providers without changing a single line of code in Analyzer.js.
 */

export class IMarketDataProvider {
    /**
     * Get snapshot of market context (Price, Volume, etc.)
     * @param {string} ticker - Standardized ticker (e.g., "AEC.TO")
     * @returns {Promise<MarketContext|null>}
     * @throws {Error} If the method is not implemented by the subclass.
     */
    async getMarketContext(ticker) {
        throw new Error("Method 'getMarketContext()' must be implemented.");
    }

    /**
     * (Optional) Get company profile or news
     * Future proofing for Phase 2.
     */
    async getCompanyProfile(ticker) {
        throw new Error("Method 'getCompanyProfile()' must be implemented.");
    }
}

/**
 * @typedef {Object} MarketContext
 * @property {number} price - Regular market price
 * @property {number} volume - Daily volume
 * @property {number} avgVolume - 3-month average volume
 * @property {number} marketCap - Market capitalization
 * @property {string} currency - 'CAD' or 'USD'
 */