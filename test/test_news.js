// test/test_news.js
import { NewsService } from '../src/services/news/news_service.js';

async function testNews() {
    console.log("🧪 Testing NewsService...");
    const service = new NewsService();
    
    // 使用一个大盘股，保证有新闻
    const ticker = "TD.TO"; 
    console.log(`➳ Fetching news for ${ticker}...`);
    
    const start = Date.now();
    const news = await service.getRecentNews(ticker);
    const duration = Date.now() - start;

    if (Array.isArray(news)) {
        console.log(`✅ Success (${duration}ms). Found ${news.length} recent articles.`);
        news.slice(0, 2).forEach(n => console.log(`   - [${n.time}] ${n.title}`));
    } else {
        console.error("❌ Failed: Returned value is not an array.");
    }
}

testNews();