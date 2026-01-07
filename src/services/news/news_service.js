/**
 * src/services/news/news_service.js
 * [Updated] Returns 'isDeep' flag and preserves 'link' for auditing.
 */
import YahooFinance from 'yahoo-finance2';
import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
];

export class NewsService {
    constructor() {
        let YFClass = YahooFinance;
        if (typeof YFClass !== 'function' && YFClass && YFClass.default) {
            YFClass = YFClass.default;
        }
        this.yf = new YFClass();
    }

    async getRecentNews(ticker, companyName) {
        try {
            const queries = this._buildQueries(ticker, companyName);
            const searchPromises = queries.map(q => this._fetchFromYahooSearch(q));
            const results = await Promise.all(searchPromises);
            
            const allNews = results.flat();
            const uniqueNews = [];
            const seenLinks = new Set();

            for (const item of allNews) {
                if (item && !seenLinks.has(item.link)) {
                    seenLinks.add(item.link);
                    uniqueNews.push(item);
                }
            }

            const relevantNews = uniqueNews.filter(n => 
                this._isRelevant(n, ticker, companyName)
            );

            const deepNewsPromises = relevantNews.slice(0, 3).map(async (article) => {
                const fullText = await this._fetchArticleContent(article.link);
                
                const isDeep = (fullText && fullText.length > 50);
                
                return { 
                   ...article, 
                    content: isDeep ? fullText : article.summary,
                    isDeep: isDeep 
                };
            });

            return await Promise.all(deepNewsPromises);

        } catch (error) {
            console.warn(`⚠️ News service error for ${ticker}: ${error.message}`);
            return [];
        }
    }

    _buildQueries(ticker, companyName) {
        const queries = [];
        const cleanTicker = ticker.replace('$', '').trim();
        if (cleanTicker.includes('.')) queries.push(cleanTicker);
        else {
            queries.push(`${cleanTicker}.V`); 
            queries.push(`${cleanTicker}.TO`);
            queries.push(`${cleanTicker}.CN`);
        }
        if (companyName) {
            const cleanName = companyName.replace(/ (inc|ltd|corp|corporation|limited)\.?$/i, '').trim();
            if (cleanName.length > 3) queries.push(cleanName);
        }
        return queries; 
    }

    async _fetchFromYahooSearch(query) {
        try {
            const result = await this.yf.search(query, { newsCount: 5 });
            if (!result || !result.news) return [];
            const now = Date.now();
            const twoWeeksMs = 14 * 86400 * 1000;
            return result.news.map(item => {
                let pubTime = item.providerPublishTime;
                if (pubTime && pubTime < 10000000000) pubTime *= 1000;
                if (pubTime && (now - pubTime) > twoWeeksMs) return null;
                return {
                    title: item.title,
                    link: item.link,
                    summary: item.summary || "", 
                    time: pubTime ? new Date(pubTime).toISOString().split('T')[0] : 'N/A',
                    publisher: item.publisher
                };
            }).filter(Boolean);
        } catch (e) { return []; }
    }

    async _fetchArticleContent(url) {
        if (url.includes('finance.yahoo.com/m/') || url.includes('/video/')) return null;

        try {
            const agent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const { data } = await axios.get(url, {
                headers: { 
                    'User-Agent': agent,
                    'Accept': 'text/html,application/xhtml+xml',
                },
                timeout: 6000,
                maxRedirects: 5
            });

            const $ = cheerio.load(data);
            let text = "";

            text = $('div[data-testid="article-body"]').text();
            if (!text || text.length < 50) text = $('.caas-body').text();
            if (!text || text.length < 50) text = $('div[class*="body"]').text();
            if (!text || text.length < 50) text = $('article').text();
            if (!text || text.length < 50) text = $('p').map((i, el) => $(el).text()).get().join(' ');

            const cleanText = text.replace(/\s+/g, ' ').replace(/Advertisement/gi, '').trim();
            return cleanText.substring(0, 1500) + (cleanText.length > 1500 ? "..." : "");
        } catch (error) {
            return null;
        }
    }

    _isRelevant(newsItem, tickerRoot, companyName) {
        const text = (newsItem.title + " " + newsItem.summary).toLowerCase();
        const t = tickerRoot.replace('$', '').toLowerCase().split('.')[0];
        try {
            const regex = new RegExp(`\\b${t}\\b`, 'i');
            if (regex.test(text)) return true;
        } catch (e) { if (text.includes(` ${t} `)) return true; }
        if (companyName) {
            const n = companyName.toLowerCase().replace(/ (inc|ltd|corp)\.?$/i, '').trim();
            if (n.length > 3 && text.includes(n)) return true;
        }
        return false;
    }
}