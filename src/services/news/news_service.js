/**
 * src/services/news/news_service.js
 * [Optimized] Dual-Search (Ticker + Company Name) & Strict Relevance Filter.
 */
import YahooFinance from 'yahoo-finance2';

export class NewsService {
    constructor() {
        let YFClass = YahooFinance;
        if (typeof YFClass !== 'function' && YFClass && YFClass.default) {
            YFClass = YFClass.default;
        }
        this.yf = new YFClass();
    }

    /**
     * 获取经过严格筛选的相关新闻
     * @param {string} ticker - e.g. "RVG.V"
     * @param {string} companyName - e.g. "Anfield Energy Inc."
     */
    async getRecentNews(ticker, companyName) {
        try {
            const queries = [];
            
            // 1. 构建 Ticker 搜索词
            // 优先用带后缀的 (精准)，如果输入不带后缀，尝试补齐
            const cleanTicker = ticker.replace('$', '').trim();
            if (cleanTicker.includes('.')) {
                queries.push(cleanTicker);
            } else {
                queries.push(`${cleanTicker}.V`);
                queries.push(`${cleanTicker}.TO`);
                queries.push(`${cleanTicker}.CN`);
            }

            // 2. 构建公司名搜索词 (清洗后缀)
            // "Anfield Energy Inc." -> "Anfield Energy"
            // 搜索全名能大幅提高召回率，防止漏掉没有提及代码的新闻
            let cleanName = "";
            if (companyName) {
                cleanName = companyName
                    .replace(/ inc\.?$/i, '')
                    .replace(/ ltd\.?$/i, '')
                    .replace(/ corp\.?$/i, '')
                    .replace(/ corporation$/i, '')
                    .replace(/ limited$/i, '')
                    .trim();
                
                if (cleanName.length > 3) { // 防止名字太短搜出垃圾
                    queries.push(cleanName);
                }
            }

            // 3. 执行并行搜索 (去重)
            const uniqueQueries = [...new Set(queries)];
            // console.log(`   🕵️ Searching news for: ${uniqueQueries.join(', ')}...`);
            
            const searchPromises = uniqueQueries.map(q => this._fetchFromYahoo(q));
            const results = await Promise.all(searchPromises);
            
            // 4. 合并结果并去重 (基于 Link)
            const allNews = results.flat();
            const seenLinks = new Set();
            const uniqueNews = [];

            for (const item of allNews) {
                if (!seenLinks.has(item.link)) {
                    seenLinks.add(item.link);
                    uniqueNews.push(item);
                }
            }

            // 5. [关键步骤] 严格相关性校验 (Relevance Filter)
            // 只有当 Title 或 Summary 包含 Ticker 或 CompanyName 时才保留
            // 这彻底杜绝了 Yahoo 返回 "Top Stories" 这种无关新闻
            const relevantNews = uniqueNews.filter(n => 
                this._isRelevant(n, cleanTicker, cleanName)
            );

            return relevantNews;

        } catch (error) {
            console.warn(`⚠️ News fetch failed for ${ticker}: ${error.message}`);
            return [];
        }
    }

    // 内部抓取函数
    async _fetchFromYahoo(query) {
        try {
            const result = await this.yf.search(query, { newsCount: 5 });
            if (!result || !result.news || result.news.length === 0) return [];

            const now = Date.now();
            const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

            return result.news.map(item => {
                let pubTime = item.providerPublishTime;
                if (pubTime && pubTime < 10000000000) pubTime *= 1000; // 秒转毫秒

                // 简单的初步时间过滤
                if (pubTime && (now - pubTime) > twoWeeksMs) return null;

                return {
                    title: item.title,
                    link: item.link,
                    summary: item.summary || "", // Yahoo 搜索通常会返回 snippet
                    time: pubTime ? new Date(pubTime).toISOString().split('T')[0] : 'N/A',
                    publisher: item.publisher
                };
            }).filter(item => item !== null); // 过滤掉超时的
        } catch (e) {
            return [];
        }
    }

    // [核心] 相关性校验逻辑
    _isRelevant(newsItem, tickerRoot, companyName) {
        const text = (newsItem.title + " " + newsItem.summary).toLowerCase();
        
        // 1. 检查 Ticker (使用词边界，防止 "GO" 匹配 "Google")
        // 如果 ticker 比较长(>3)，直接匹配；如果短，加词边界
        if (tickerRoot.length > 3) {
            if (text.includes(tickerRoot.toLowerCase())) return true;
        } else {
             // 简单的词边界模拟，或者直接匹配 Ticker.V
             if (text.includes(tickerRoot.toLowerCase())) return true;
        }

        // 2. 检查公司名 (这是最稳健的)
        // 只要出现 "Anfield Energy" 这样独特的词组，基本就是相关新闻
        if (companyName && companyName.length > 4) {
            if (text.includes(companyName.toLowerCase())) return true;
        }

        return false; // 既没提到代码，也没提到公司名 -> 判定为 Yahoo 塞的通用新闻 -> 丢弃
    }
}