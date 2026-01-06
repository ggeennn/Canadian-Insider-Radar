/**
 * src/index.js
 * [Fix] Resolved ReferenceError: tickerSignals is not defined.
 * [Feature] Integrated AI Report display & Ticker Grouping.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { startMonitor } from './monitors/sedi_monitor.js';
import { ApiService } from './services/api_client.js'; 
import { StorageService } from './services/storage.js';
import { Analyzer } from './core/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WATCHLIST_FILE = path.join(__dirname, './config/watchlist.json'); 
const LOG_DIR = path.join(__dirname, '../logs');

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
                Logger.info(`   📥 Fetched ${records.length} records.`); 
                
                if (records.length > 0) {
                    const savedCount = StorageService.save(records);
                    Logger.info(`   💾 Saved ${savedCount} new records.`);

                    // 分析 (支持 AI)
                    const signals = await Analyzer.analyze(records, watchlist);
                    
                    if (signals.length > 0) {
                        
                        // 1. 头部信息
                        const isHit = signals.some(s => s.isWatchlisted);
                        if (isHit) {
                            Logger.info(`\n👀 ============ [WATCHLIST ALERT: ${ticker}] ============ 👀`);
                        } else {
                            Logger.info(`\n🔔 ANALYSIS RESULT for ${ticker}:`);
                        }

                        // 2. 市场背景 (取第一个信号的即可)
                        const firstSig = signals[0];
                        const mContext = firstSig.marketContext;
                        if (mContext) {
                            Logger.info(`   📊 Market: Price $${mContext.price} | Cap $${(mContext.marketCap/1000000).toFixed(1)}M | AvgVol ${mContext.avgVolume}`);
                        }

                        // 3. AI 报告 (检查是否有 AI 分析结果)
                        // [FIXED] 将 tickerSignals 改为 signals
                        const signalWithAI = signals.find(s => s.aiAnalysis);
                        
                        if (signalWithAI) {
                            // 优先打印新闻源
                            if (signalWithAI.aiNews && signalWithAI.aiNews.length > 0) {
                                Logger.info(`   📰 News Context (${signalWithAI.aiNews.length} articles):`);
                                signalWithAI.aiNews.forEach(n => {
                                    Logger.info(`      - [${n.time}] ${n.title}`);
                                });
                            } else if (signalWithAI.score >= 100) {
                                Logger.info(`   📭 News Context: No relevant articles found.`);
                            }

                            // 打印 AI 分析
                            if (signalWithAI.aiAnalysis) {
                                Logger.info(`   🧠 [AI REPORT]:`);
                                signalWithAI.aiAnalysis.split('\n').forEach(line => {
                                    if(line.trim()) Logger.info(`      ${line}`);
                                });
                                Logger.info(`   --------------------------------------------------`);
                            }
                        }

                        // 4. 内部人交易列表
                        signals.forEach(sig => {
                            const prefix = sig.isWatchlisted ? "🎯 " : "";
                            const icon = sig.score > 50 ? "🔥🔥" : (sig.isRiskAlert ? "🚨" : "ℹ️");
                            
                            Logger.info(`   ${prefix}${icon} ${sig.insider} (${sig.relation})`);
                            Logger.info(`      Score: ${sig.score} | Net: $${Math.round(sig.netCashInvested).toLocaleString()}`);
                            Logger.info(`      Reasons: ${sig.reasons.join(', ')}`);
                            
                            if (sig.sediUrl) {
                                Logger.info(`      🔗 Link: ${sig.sediUrl}`);
                            }
                        });

                        if (isHit) Logger.info(`   --------------------------------------------------`);
                        
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