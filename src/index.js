/**
 * src/index.js (v2.0 - Production Ready)
 * * Feature: File Logging (logs/YYYY-MM-DD.log)
 * * Feature: Random Jitter (Anti-Scraping Safety)
 * * Logic: Recursive Loop instead of setInterval
 */

import fs from 'fs';
import path from 'path';
import { startMonitor } from './monitors/sedi_monitor.js';
import { ApiService } from './services/api_client.js';
import { StorageService } from './services/storage.js';
import { Analyzer } from './core/analyzer.js';

// --- Configuration ---
const WATCHLIST_FILE = 'config/watchlist.json';
const LOG_DIR = 'logs';

// [安全策略] 随机延迟区间 (毫秒)
const MIN_DELAY = 5000;  // 5秒
const MAX_DELAY = 15000; // 15秒

// --- State ---
const taskQueue = [];
let watchlist = new Set();

// --- 0. Logger Utility (New) ---
// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const Logger = {
    // 获取当天的日志文件名 e.g. "logs/2025-01-01.log"
    getLogFile() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(LOG_DIR, `${today}.log`);
    },

    // 格式化时间
    getTime() {
        return new Date().toLocaleTimeString();
    },

    // 核心日志函数
    info(message, ...args) {
        // 1. Console 输出 (保持带颜色的对象打印)
        console.log(message, ...args);

        // 2. File 写入 (追加模式)
        try {
            const timestamp = this.getTime();
            let line = `[${timestamp}] ${message}`;
            
            // 如果有额外参数 (如对象)，转为字符串追加
            if (args.length > 0) {
                line += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            }
            
            fs.appendFileSync(this.getLogFile(), line + '\n');
        } catch (e) {
            console.error("Logger Write Error:", e);
        }
    },

    error(message, error) {
        const timestamp = this.getTime();
        console.error(message, error);
        
        const errorMsg = error.message || error;
        const line = `[${timestamp}] [ERROR] ${message} - ${errorMsg}\n`;
        try {
            fs.appendFileSync(this.getLogFile(), line);
        } catch (e) {}
    }
};

// --- 1. Load Watchlist ---
function loadWatchlist() {
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
            if (data.tickers && Array.isArray(data.tickers)) {
                watchlist = new Set(data.tickers);
                Logger.info(`📋 Watchlist loaded: ${watchlist.size} tickers.`);
            }
        } else {
            Logger.info("⚠️ No watchlist file found. Running without special alerts.");
        }
    } catch (e) {
        Logger.error("Failed to load watchlist", e);
    }
}

// --- 2. The Worker (Recursive Consumer) ---
async function runWorkerLoop() {
    // 检查队列是否有任务
    if (taskQueue.length > 0) {
        const ticker = taskQueue.shift();
        Logger.info(`\n⚙️ Processing: ${ticker} (Queue: ${taskQueue.length})`);

        try {
            // A. Map ID
            const issuerId = await ApiService.getIssuerId(ticker);
            
            if (issuerId) {
                // B. Fetch Data
                const records = await ApiService.getTransactions(issuerId);
                Logger.info(`   📥 Fetched ${records.length} records.`);
                
                if (records.length > 0) {
                    // C. Store
                    const savedCount = StorageService.save(records);
                    Logger.info(`   💾 Saved ${savedCount} new records.`);

                    // D. Analyze
                    const signals = Analyzer.analyze(records, watchlist);
                    
                    // E. Report
                    if (signals.length > 0) {
                        Logger.info(`🔔 ANALYSIS RESULT for ${ticker}:`);
                        signals.forEach(sig => {
                            const icon = sig.score > 50 ? "🔥🔥" : (sig.isRiskAlert ? "🚨" : "ℹ️");
                            Logger.info(`${icon} ${sig.insider} (${sig.relation})`);
                            Logger.info(`   Score: ${sig.score} | Net Cash: $${Math.round(sig.netCashInvested).toLocaleString()}`);
                            Logger.info(`   Reasons: ${sig.reasons.join(', ')}`);
                            if(sig.tags.length) Logger.info(`   Tags: ${sig.tags.join(' ')}`);
                        });
                    } else {
                        Logger.info(`   💤 No significant signals found.`);
                    }
                }
            } else {
                Logger.info(`   ⚠️ ID not found for ${ticker}, skipping.`);
            }

        } catch (error) {
            Logger.error(`Error processing ${ticker}`, error);
        }
    } else {
        // 队列为空时的心跳日志 (可选，防止日志文件太大，可以注释掉)
        // Logger.info("💤 Queue empty, waiting...");
    }

    // [核心安全策略] 随机延迟
    // 无论有没有任务，都要随机等一会再检查，模拟真人
    const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1) + MIN_DELAY);
    Logger.info(`⏳ Waiting ${(delay/1000).toFixed(1)}s before next check...`);
    
    // 递归调用，实现无限循环
    setTimeout(runWorkerLoop, delay);
}

// --- 3. Main Entry Point ---
async function main() {
    Logger.info("========================================");
    Logger.info("   SEDI INSIDER TRACKER - SYSTEM ONLINE");
    Logger.info("========================================");

    // 加载配置
    loadWatchlist();

    // 启动 Monitor (Producer)
    startMonitor((ticker) => {
        // 简单去重
        if (!taskQueue.includes(ticker)) {
            taskQueue.push(ticker);
            Logger.info(`➕ Added to queue: ${ticker}`);
        }
    });

    // 启动 Worker Loop (Consumer)
    // 注意：这里不再用 setInterval，而是直接调用函数启动递归
    runWorkerLoop();
}

// Start
main();