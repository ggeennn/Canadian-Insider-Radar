/**
 * test/test_llm.js
 * Testing Cluster Analysis capabilities.
 * [Fix] Added 'reasons' to mock data to match new LLMService requirements.
 */
import { LLMService } from '../src/services/llm/llm_service.js';

async function testLLM() {
    console.log("🧪 Testing LLMService (Cluster Mode)...");
    const service = new LLMService();

    // 模拟集群数据
    const mockContext = {
        ticker: "CLUSTER.V",
        insiders: [
            // [FIX] 必须包含 reasons 字段，否则报错
            { name: "CEO John", amount: 150000, reasons: ["🔥 Market Buy", "⭐ Top Insider"] },
            { name: "CFO Jane", amount: 50000, reasons: ["🔒 Private Placement", "👥 Consensus"] }
        ],
        totalNetCash: 200000,
        maxScore: 145,
        // 这只是给 AI 看的汇总
        marketData: { price: 2.50, marketCap: 50000000, ma50: 2.10 }, 
        news: [{ title: "CLUSTER.V reports record earnings", time: "2026-01-01" }]
    };

    console.log("➳ Sending request to Gemini (Expect long response)...");
    const start = Date.now();
    
    try {
        const result = await service.analyzeSentiment(mockContext);
        const duration = Date.now() - start;

        console.log(`\n⏱️ Response time: ${duration}ms`);
        console.log("📝 AI Output:");
        console.log("---------------------------------------------------");
        console.log(result);
        console.log("---------------------------------------------------");

        if (result && result.length > 100) {
            console.log("✅ LLM Test Passed.");
        }
    } catch (e) {
        console.error("❌ Test Failed:", e);
    }
}

testLLM();