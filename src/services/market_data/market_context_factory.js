/**
 * src/services/market_data/market_context_factory.js
 * Singleton Factory to access market data.
 */
import { YahooAdapter } from './providers/yahoo_adapter.js';

// 单例模式，避免重复创建连接
const provider = new YahooAdapter();

export const MarketContextFactory = {
    /**
     * 获取市场数据提供商实例
     * 目前只支持 Yahoo，未来可以换成 AlphaVantage 等
     */
    getProvider() {
        return provider;
    }
};