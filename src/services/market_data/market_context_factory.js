/**
 * src/services/market_data/market_context_factory.js
 * Singleton Factory to access market data.
 */
import { YahooAdapter } from './providers/yahoo_adapter.js';

const provider = new YahooAdapter();

export const MarketContextFactory = {

    getProvider() {
        return provider;
    }
};