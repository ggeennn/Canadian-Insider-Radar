/**
 * src/index.js
 * [Updated] Now injects full history into Analyzer for context-aware analysis.
 * 
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
        const line = `[${timestamp}] ${message} - ${errorMsg}\n`;
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

function formatAIReport(report) {
    if (!report || !report.verdict) return ["   🧠 Analysis Unavailable/Error"];

    const lines = [];
    
    // 1. Verdict Header
    const v = report.verdict;
    const icon = v.direction === 'BULLISH' ? '🟢' : (v.direction === 'BEARISH' ? '🔴' : '⚪');
    lines.push(`   🧠 [AI VERDICT]: ${icon} ${v.direction} (Confidence: ${v.confidence_score}%)`);
    lines.push(`      "${v.one_sentence_summary}"`);
    
    // 2. Metadata
    const m = report.meta;
    lines.push(`      [Source Quality: ${m.data_quality} | Catalyst: ${m.catalyst_identified ? '✅ Yes' : '❌ No'}]`);

    // 3. Thesis Points
    if (report.bull_thesis && report.bull_thesis.length > 0) {
        lines.push(`      🐂 BULL THESIS:`);
        report.bull_thesis.forEach(p => lines.push(`         • ${p}`));
    }

    if (report.bear_risks && report.bear_risks.length > 0) {
        lines.push(`      🐻 BEAR RISKS:`);
        report.bear_risks.forEach(p => lines.push(`         • ${p}`));
    }
    
    // (Optional) Debug Reasoning
    // lines.push(`      💭 [Logic]: ${report.hidden_reasoning.substring(0, 100)}...`);

    lines.push(`   --------------------------------------------------`);
    return lines;
}




async function runWorkerLoop() {
    if (taskQueue.length > 0) {
        const ticker = taskQueue.shift();
        Logger.info(`\n⚙️ Processing: ${ticker} (Queue: ${taskQueue.length})`);

        try {
            const issuerId = await ApiService.getIssuerId(ticker);
            
            if (issuerId) {
                // 1. Fetch latest 20 records (regardless of date)
                const records = await ApiService.getTransactions(issuerId);
                Logger.info(`   📥 Fetched ${records.length} records.`); 
                
                if (records.length > 0) {
                    // 2. Save Logic: returns how many are actually NEW
                    const savedCount = StorageService.save(records);
                    Logger.info(`   💾 Saved ${savedCount} new records.`);

                    // 3. Analysis Trigger:
                    // Only analyze if there is NEW data OR if the ticker is in watchlist (force check)
                    // Note: Fixed logic to ensure we don't skip if savedCount is 0 but it IS in watchlist
                    const shouldAnalyze = records.length > 0 || watchlist.has(ticker);

                    if (shouldAnalyze) {
                        // 4.1 Context Injection
                        // Instead of analyzing only the snapshot, we pull the ENTIRE history 
                        // for this ticker from our memory cache (which includes what we just saved).
                        const fullHistory = StorageService.getHistory(ticker);
                        
                        Logger.info(`   🧮 Analyzing ${fullHistory.length} total records (History + New)...`);

                        // 4.2 Pass FULL history to Analyzer
                        // Analyzer will handle the "Time Window Filtering" (e.g. drop > 30 days old)
                        // This allows detection of "Cluster Buys" spanning multiple days.
                        const signals = await Analyzer.analyze(fullHistory, watchlist);
                        
                        if (signals.length > 0) {
                            
                            // 5. Header Information (Visual Enhancement for Watchlist)
                            const isHit = signals.some(s => s.isWatchlisted);
                            
                            if (isHit) {
                                Logger.info(`\n👀 ======================================================== 👀`);
                                Logger.info(`👀            WATCHLIST ALERT:  $${ticker}                 👀`);
                                Logger.info(`👀 ======================================================== 👀`);
                            } else {
                                Logger.info(`\n🔔 ANALYSIS RESULT for ${ticker}:`);
                            }

                            // 6. Market Context
                            const firstSig = signals[0];
                            const mContext = firstSig.marketContext;
                            if (mContext) {
                                Logger.info(`   📊 Market: Price $${mContext.price} | Cap $${(mContext.marketCap/1000000).toFixed(1)}M | AvgVol ${mContext.avgVolume}`);
                            }

                            // 7. AI Report & news
                            const signalWithAI = signals.find(s => s.aiAnalysis);
                            
                            if (signalWithAI) {
                                Logger.info(`   🧠 [AI] Triggered for ${ticker} (Score: ${signalWithAI.score}).`);
                                
                                // Link Log
                                if (signalWithAI.sediLink) {
                                    Logger.info(`   🔗 SEDI Audit: ${signalWithAI.sediLink}`);
                                }

                                // News Log
                                if (signalWithAI.aiNews && signalWithAI.aiNews.length > 0) {
                                    Logger.info(`   📰 News Context (${signalWithAI.aiNews.length} articles):`);
                                    signalWithAI.aiNews.forEach(n => {
                                        const status = n.isDeep ? "✅ Deep Read" : "⚠️ Summary Only";
                                        Logger.info(`      - [${n.time}] ${n.title} (${status})`);
                                        Logger.info(`        🔗 ${n.link}`);
                                    });
                                } else {
                                    Logger.info(`   📭 News Context: No relevant articles found.`);
                                }

                                // [NEW] Structured Report Rendering
                                if (signalWithAI.aiAnalysis) {
                                    const formattedLines = formatAIReport(signalWithAI.aiAnalysis);
                                    formattedLines.forEach(line => Logger.info(line));
                                }
                            }

                            // 8. Insider Transaction List
                            signals.forEach(sig => {
                                const prefix = sig.isWatchlisted ? "🎯 " : "";
                                const icon = sig.score > 50 ? "🔥🔥" : (sig.isRiskAlert ? "🚨" : "ℹ️");
                                
                                Logger.info(`   ${prefix}${icon} ${sig.insider} (${sig.relation})`);
                                
                                // [NEW] 卖出跟抛警报 (优先显示)
                                if (sig.sellDetailStr) {
                                    Logger.info(`      🏃‍♂️💨 [FOLLOW SELL ALERT]: ${sig.sellDetailStr}`);
                                }

                                Logger.info(`      Score: ${sig.score} | Net: $${Math.round(sig.netCashInvested).toLocaleString()}`);
                                
                                if (sig.txDetailStr) {
                                    Logger.info(`      Details: ${sig.txDetailStr}`);
                                }
                                
                                Logger.info(`      Reasons: ${sig.reasons.join(', ')}`);
                                
                                if (sig.sediUrl) {
                                    Logger.info(`      🔗 Link: ${sig.sediUrl}`);
                                }
                            });

                            // 视觉闭环
                            if (isHit) {
                                Logger.info(`👀 ======================================================== 👀`);
                                Logger.info(`   (End of Watchlist Alert)`);
                            } else {
                                Logger.info(`   --------------------------------------------------`);
                            }
                            
                        } else {
                            Logger.info(`   💤 No significant signals found (after filtering).`);
                        }
                    } else {
                         // savedCount == 0, so skip to save resources
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