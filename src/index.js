/**
 * src/index.js (v2.1 - Enhanced Logging & Watchlist Support)
 */

import fs from 'fs';
import path from 'path';
import { startMonitor } from './monitors/sedi_monitor.js';
import { ApiService } from './services/api_client.js';
import { StorageService } from './services/storage.js';
import { Analyzer } from './core/analyzer.js';

const WATCHLIST_FILE = 'config/watchlist.json';
const LOG_DIR = 'logs';

const MIN_DELAY = 5000;  
const MAX_DELAY = 15000; 

const taskQueue = [];
let watchlist = new Set();

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const Logger = {
    getLogFile() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(LOG_DIR, `${today}.log`);
    },
    getTime() {
        return new Date().toLocaleTimeString();
    },
    info(message, ...args) {
        console.log(message, ...args);
        try {
            const timestamp = this.getTime();
            let line = `[${timestamp}] ${message}`;
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

function loadWatchlist() {
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
            if (data.tickers && Array.isArray(data.tickers)) {
                watchlist = new Set(data.tickers);
                Logger.info(`📋 Watchlist loaded: ${watchlist.size} tickers.`);
            }
        } else {
            Logger.info("⚠️ No watchlist file found.");
        }
    } catch (e) {
        Logger.error("Failed to load watchlist", e);
    }
}

async function runWorkerLoop() {
    if (taskQueue.length > 0) {
        const ticker = taskQueue.shift();
        Logger.info(`\n⚙️ Processing: ${ticker} (Queue: ${taskQueue.length})`);

        try {
            const issuerId = await ApiService.getIssuerId(ticker);
            
            if (issuerId) {
                const records = await ApiService.getTransactions(issuerId);
                
                // 这里现在会明确显示获取了多少条记录，帮助判断 API 是否正常
                Logger.info(`   📥 Fetched ${records.length} records.`); 
                
                if (records.length > 0) {
                    const savedCount = StorageService.save(records);
                    Logger.info(`   💾 Saved ${savedCount} new records.`);

                    const signals = Analyzer.analyze(records, watchlist);
                    
                    if (signals.length > 0) {
                        const isHit = signals.some(s => s.isWatchlisted);
                        if (isHit) {
                            Logger.info(`\n👀 ============ [WATCHLIST ALERT: ${ticker}] ============ 👀`);
                        } else {
                            Logger.info(`🔔 ANALYSIS RESULT for ${ticker}:`);
                        }

                        signals.forEach(sig => {
                            const prefix = sig.isWatchlisted ? "🎯 " : "";
                            const icon = sig.score > 50 ? "🔥🔥" : (sig.isRiskAlert ? "🚨" : "ℹ️");
                            
                            Logger.info(`${prefix}${icon} ${sig.insider} (${sig.relation})`);
                            Logger.info(`   Score: ${sig.score} | Net: $${Math.round(sig.netCashInvested).toLocaleString()}`);
                            Logger.info(`   Reasons: ${sig.reasons.join(', ')}`);
                            
                            if (sig.sediUrl) {
                                Logger.info(`   🔗 Source: ${sig.sediUrl}`);
                            }
                            
                            if (isHit) Logger.info(`   --------------------------------------------------`);
                        });
                    } else {
                        Logger.info(`   💤 No significant signals found.`);
                    }
                }
            } else {
                Logger.info(`   ⚠️ ID not found for ${ticker}`);
            }

        } catch (error) {
            Logger.error(`Error processing ${ticker}`, error);
        }
    }
    
    const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1) + MIN_DELAY);
    setTimeout(runWorkerLoop, delay);
}

async function main() {
    Logger.info("========================================");
    Logger.info("   SEDI INSIDER TRACKER - SYSTEM ONLINE");
    Logger.info("========================================");

    loadWatchlist();

    startMonitor((ticker) => {
        if (!taskQueue.includes(ticker)) {
            taskQueue.push(ticker);
            Logger.info(`➕ Added to queue: ${ticker}`);
        }
    });

    runWorkerLoop();
}

main();