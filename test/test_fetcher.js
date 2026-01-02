/**
 * test_fetcher.js (Final Integration)
 * * Goal: Test the full pipeline: API -> Clean -> Store.
 */

import { ApiService } from '../src/services/api_client.js';
import { StorageService } from '../src/services/storage.js';

async function runTest() {
    console.log("🧪 Starting Data Ingestion Test...");

    // 1. 模拟 Monitor 传来的 Ticker
    const targetTicker = "SUNN"; 
    
    // 2. 获取 ID
    const id = await ApiService.getIssuerId(targetTicker);
    
    if (id) {
        // 3. 获取数据
        console.log(`\n📥 Fetching transactions for ID: ${id}...`);
        const txs = await ApiService.getTransactions(id);
        
        console.log(`📊 Received ${txs.length} transactions from API.`);
        
        if (txs.length > 0) {
            // 4. 存入硬盘 (关键步骤)
            console.log("💾 Saving to local storage...");
            const savedCount = StorageService.save(txs);
            
            console.log(`✅ Successfully saved ${savedCount} new records to data/transactions_history.jsonl`);
            
            if (savedCount === 0) {
                console.log("   (Duplicate protection works: No new records added)");
            }

        } else {
            console.warn("⚠️ No transactions found to save.");
        }
    } else {
        console.error("❌ Failed to resolve ID.");
    }
}

runTest();