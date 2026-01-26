/**
 * src/services/llm/llm_service.js
 * [Audit Fix] Implements Structured JSON Output & Chain of Thought.
 * Returns a JSON Object instead of a Markdown string.
 */
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

export class LLMService {
    constructor() {
        this.client = new OpenAI({
            baseURL: process.env.LLM_BASE_URL,
            apiKey: process.env.LLM_API
        });
        this.model = process.env.LLM_MODEL;
    }

    async analyzeSentiment(context) {
        const { ticker, insiders, totalNetCash, maxScore, marketData, news } = context;

        // 1. Prepare Data Context
        const newsText = news && news.length > 0 
            ? news.map(n => {
                const body = n.content ? `[CONTENT]: ${n.content.substring(0, 1000)}...` : `[SUMMARY]: ${n.summary || 'N/A'}`;
                return `### ARTICLE (${n.time})\nTITLE: ${n.title}\n${body}\n`;
            }).join('\n') 
            : "No specific recent news found.";

        const insidersText = insiders.map(i => {
            const reasonList = i.reasons || [];
            // Use the weighted score from Analyzer if available, else raw
            const scoreDisplay = i.score ? `(Score: ${i.score})` : '';
            return `${i.name}: $${(i.amount/1000).toFixed(1)}k ${scoreDisplay} - [${reasonList.join(', ')}]`;
        }).join('\n- ');

        const mktInfo = marketData 
            ? `Price $${marketData.price}, Cap $${(marketData.marketCap/1e6).toFixed(1)}M, Trend: ${marketData.price > marketData.ma50 ? 'Uptrend' : 'Downtrend'}` 
            : "N/A";

        // 2. JSON Schema Definition (The Contract)
        const systemPrompt = `
You are a quantitative financial auditor. You must output valid JSON only.

Your goal is to analyze insider trading activity for ${ticker}.

INPUT DATA:
- Market: ${mktInfo}
- Aggregate Net Flow: $${totalNetCash.toLocaleString()} (Max Score: ${maxScore})
- Insiders:
- ${insidersText}

NEWS CONTEXT:
${newsText}

ANALYSIS LOGIC:
1. **Correlation**: Does the insider buying coincide with a dip (Discount) or news (Catalyst)?
2. **Quality**: Is this a "Routine Plan" (Ignore) or "Opportunistic Buy" (High Value)?
3. **Data Quality**: If news is "No specific news" or only headlines, admit low confidence.

JSON OUTPUT SCHEMA:
{
  "hidden_reasoning": "Step-by-step logic before conclusion...",
  "meta": {
    "data_quality": "High (Deep Read) | Medium (Headlines) | Low (No News)",
    "catalyst_identified": boolean
  },
  "bull_thesis": ["Point 1", "Point 2 (max 3)"],
  "bear_risks": ["Risk 1", "Risk 2 (max 3)"],
  "verdict": {
    "direction": "BULLISH | NEUTRAL | BEARISH",
    "confidence_score": 0-100,
    "one_sentence_summary": "Concise conclusion."
  }
}`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: "You are a JSON-speaking financial analyst." },
                    { role: 'user', content: systemPrompt }
                ],
                temperature: 0.2, // Lower temperature for structured data stability
                max_tokens: 4096,
                response_format: { type: "json_object" } // FORCE JSON
            });

            const rawContent = response.choices[0].message.content;
            
            // Parse JSON safely
            try {
                return JSON.parse(rawContent);
            } catch (parseError) {
                console.error("❌ JSON Parse Failed:", rawContent);
                return null;
            }

        } catch (error) {
            console.error(`🚨 LLM Analysis failed: ${error.message}`);
            return null;
        }
    }
}