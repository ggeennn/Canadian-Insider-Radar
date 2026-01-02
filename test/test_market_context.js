/**
 * test/test_market_context.js
 * 单元测试：验证 MarketContextFactory 能否正确处理 sample.jsonl 中的 Ticker
 * 运行方式: node test/test_market_context.js
 */

import { MarketContextFactory } from '../src/services/market_data/market_context_factory.js';

async function runTest() {
    console.log("🧪 Starting MarketContext Unit Test...");

    // 从你的 sample.jsonl 中挑选的典型 Ticker
    const testTickers = [
        "AUOZ.CN",  // CSE 股票，Yahoo 可能叫 .CN 或 .CSE
        "DYG.V",    // TSX-V 股票
        "PHOS.CN",  // 另一只 CSE 股票
        "AEC",      // 无后缀测试
        "INVALID.XYZ" // 预期失败测试
    ];

    const provider = MarketContextFactory.getProvider();

    for (const ticker of testTickers) {
        console.log(`\n-----------------------------------`);
        console.log(`Testing Ticker: ${ticker}`);
        const start = Date.now();
        
        try {
            const data = await provider.getMarketContext(ticker);
            const duration = Date.now() - start;

            if (data) {
                console.log(`✅ SUCCESS (${duration}ms)`);
                console.log(`   Price: $${data.price}`);
                console.log(`   Vol:   ${data.volume}`);
                console.log(`   Cap:   ${data.marketCap}`);
                console.log(`   avgVolume:   ${data.avgVolume}`);
                console.log(`   currency:   ${data.currency}`);
                console.log(`   high52w:   ${data.high52w}`);
                console.log(`   low52w:   ${data.low52w}`);
                console.log(`   ma50:   ${data.ma50}`);
                console.log(`   ma200:   ${data.ma200}`);

            } else {
                console.log(`❌ FAILED (${duration}ms) - No data returned`);
            }
        } catch (error) {
            console.error(`🚨 ERROR: ${error.message}`);
        }
    }
}

runTest();