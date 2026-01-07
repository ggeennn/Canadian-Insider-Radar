/**
 * src/services/llm/llm_service.js
 * [Fix] Now injects full article 'content' into the prompt.
 * [Fix] Updated instructions to recognize deep content.
 */
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

export class LLMService {
    constructor() {
        this.client = new OpenAI({
            baseURL: process.env.LLM_BASE_URL,
            apiKey: process.env.LLM_API,
        });
        this.model = process.env.LLM_MODEL;
    }

    async analyzeSentiment(context) {
        const { ticker, insiders, totalNetCash, maxScore, marketData, news } = context;

        const newsText = news && news.length > 0 
            ? news.map(n => {
                const body = n.content ? `[CONTENT]: ${n.content}` : `[SUMMARY]: ${n.summary || 'N/A'}`;
                return `### ARTICLE (${n.time})\nTITLE: ${n.title}\n${body}\n`;
            }).join('\n') 
            : "No specific recent news found.";

        const insidersText = insiders.map(i => {
            const reasonList = i.reasons || [];
            const type = reasonList.includes('🔒 Private Placement') ? 'Private Placement' : 'Open Market';
            return `${i.name} ($${(i.amount/1000).toFixed(1)}k via ${type})`;
        }).join('\n- ');

        const mktInfo = marketData 
            ? `Price $${marketData.price}, Cap $${(marketData.marketCap/1e6).toFixed(1)}M, Trend: ${marketData.price > marketData.ma50 ? 'Uptrend' : 'Downtrend'}` 
            : "N/A";

        const prompt = `
You are a strict financial auditor. Analyze this insider activity for ${ticker}.

DATA SNAPSHOT:
- Market: ${mktInfo}
- Total Insider Net Buy: $${totalNetCash.toLocaleString()} (Score: ${maxScore})
- Insider Details:
- ${insidersText}

NEWS CONTEXT:
${newsText}

INSTRUCTIONS:
1. **Source Check**: If the news contains "[CONTENT]", you have deep context. If only "[SUMMARY]" or titles are present, start with "⚠️ Analysis based on headlines/snippets only."
2. **Analysis**: Correlate the insider's buy timing with the news content. Is the news a catalyst?
3. **Verdict**: Differentiate between "Private Placement" (Dilution risk) vs "Open Market" (Conviction).

OUTPUT FORMAT:
**⚠️ Data Level: [Deep Read / Headlines Only / No News]**

**🐂 BULL THESIS**
- Point 1
- Point 2

**🐻 BEAR RISKS**
- Point 1
- Point 2

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