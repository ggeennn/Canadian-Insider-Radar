/**
 * src/services/llm/llm_service.js
 * [Update] Added defensive check for reasons array.
 */
import OpenAI from 'openai';

const LLM_CONFIG = {
    baseURL: 'http://localhost:8000/openai/v1',
    apiKey: 'sk969',
    model: 'gemini-2.5-flash'
};

export class LLMService {
    constructor() {
        this.client = new OpenAI({
            baseURL: LLM_CONFIG.baseURL,
            apiKey: LLM_CONFIG.apiKey,
        });
        this.model = LLM_CONFIG.model;
    }

    async analyzeSentiment(context) {
        const { ticker, insiders, totalNetCash, maxScore, marketData, news } = context;

        // 1. News
        const newsText = news && news.length > 0 
            ? news.map(n => `- [${n.time}] ${n.title} ${n.summary ? `\n  (Summary: ${n.summary})` : ''}`).join('\n') 
            : "No specific recent news found.";

        // 2. Insiders Detail
        const insidersText = insiders.map(i => {
            // [FIX] 增加 (i.reasons || []) 防御性检查，防止 undefined 报错
            const reasonList = i.reasons || [];
            const type = reasonList.includes('🔒 Private Placement') ? 'Private Placement' : 'Open Market';
            return `${i.name} ($${(i.amount/1000).toFixed(1)}k via ${type})`;
        }).join('\n- ');

        const mktInfo = marketData 
            ? `Price $${marketData.price}, Cap $${(marketData.marketCap/1e6).toFixed(1)}M, Trend: ${marketData.price > marketData.ma50 ? 'Uptrend' : 'Downtrend'}` 
            : "N/A";

        const prompt = `
You are a strict financial auditor. Analyze this insider activity for ${ticker}.

DATA:
- Market: ${mktInfo}
- Total Insider Buy: $${totalNetCash.toLocaleString()} (Score: ${maxScore})
- Details:
- ${insidersText}

NEWS HEADLINES (Limit: Titles/Snippets only):
${newsText}

INSTRUCTIONS:
1. **Source Warning**: Start with "⚠️ Analysis based on headlines/snippets only." if news is shallow.
2. **Distinguish**: Differentiate between "Private Placement" (often discounted/warrants attached, lower conviction) vs "Open Market" (true skin in the game).
3. **Brevity**: Use short sentences. No fluff. Max 3 bullet points per section.

OUTPUT FORMAT:
**⚠️ Data Level: [Headlines Only / No News / Deep]**

**🐂 BULL THESIS**
- (Why is this good? Focus on value/growth)

**🐻 BEAR RISKS**
- (Dilution? Downtrend? Promotional news?)

**⚖️ VERDICT**
- [BULLISH / NEUTRAL / BEARISH] (One sentence summary)
`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 8192
            });

            return response.choices[0].message.content;

        } catch (error) {
            console.error(`🚨 LLM Analysis failed: ${error.message}`);
            return "AI Analysis Unavailable.";
        }
    }
}