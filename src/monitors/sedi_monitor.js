/**
 * src/monitors/sedi_monitor.js (v4.0 - Integrated Module)
 * * Change: Export startMonitor() and accept a callback.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_URL = 'https://ceo.ca/@sedi';
const STATE_DIR = 'state';
const STATE_FILE = path.join(STATE_DIR, 'monitor_state.json');
const COOKIE_FILE = path.join(STATE_DIR, 'cookies.json');

const EMAIL = process.env.CEO_EMAIL;
const PASSWORD = process.env.CEO_PASSWORD;

if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR);

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data).lastTimestamp;
        }
    } catch (e) {}
    return 0;
}

function saveState(timestamp) {
    try {
        const state = { lastTimestamp: timestamp, updatedAt: new Date().toISOString() };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) { console.error("❌ Save State Error:", e); }
}

async function performLogin(page) {
    // ... (保持原有的 performLogin 逻辑不变，代码太长省略，请保留你 v3.2 的代码) ...
    // 务必保留 v3.2 中修复的 "Strict Mode Violation" 逻辑
    console.log("🔐 Starting Auth Sequence (Fast Mode)...");
    try {
        const loginBtn = page.getByRole('button', { name: 'Log In', exact: true }).first();
        await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
        console.log("⚡ 'Log In' button visible. Clicking...");
        await loginBtn.click();
    } catch (e) {
        console.log("⚠️ 'Log In' button not found. Assuming already logged in.");
        return; 
    }
    try {
        console.log("⏳ Waiting for login form...");
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
    } catch (e) {
        await page.screenshot({ path: 'debug_no_form.png' }); throw e;
    }
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    console.log("🚀 Submitting...");
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    console.log("⏳ Waiting for session cookie...");
    await page.waitForTimeout(5000); 
}

async function saveCookies(page) {
    const cookies = await page.context().cookies();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

let latestProcessedTimestamp = loadState();

// [INTERFACE CHANGE] 增加 onSignal 回调
export async function startMonitor(onSignal) {
    console.log("Starting SEDI Monitor v4.0 (Integrated)...");
    
    const browser = await chromium.launch({ 
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'] 
    }); 
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    try {
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
        await performLogin(page);
        await saveCookies(page);

        console.log("👀 Monitor loop starting...");
        
        // 传递回调函数给 scan
        await scanForNewFilings(page, onSignal); 
        
        setInterval(async () => {
            await scanForNewFilings(page, onSignal);
        }, 5000);

    } catch (error) {
        console.error("❌ Critical Monitor Error:", error);
    }
}

// [INTERFACE CHANGE] 接收 onSignal
async function scanForNewFilings(page, onSignal) {
    try {
        // ... (保持原有的 evaluate 抓取逻辑不变) ...
        const rawData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('div[class*="Spiel_row"]'));
            return rows.map(row => {
                const tsString = row.getAttribute('data-timestamp');
                const timestamp = tsString ? parseInt(tsString, 10) : 0;
                const tickerEl = row.querySelector('[class*="Tag_cash"]');
                const ticker = tickerEl ? tickerEl.innerText : null;
                return { timestamp, ticker };
            }).filter(item => item.ticker && item.timestamp > 0);
        });
    
        rawData.sort((a, b) => a.timestamp - b.timestamp);
        let hasNewData = false;
    
        for (const data of rawData) {
            if (data.timestamp > latestProcessedTimestamp) {
                const dateStr = new Date(data.timestamp).toLocaleString();
                console.log(`[${dateStr}] 🚨 NEW SIGNAL: ${data.ticker}`);
                
                // [INTEGRATION] 将发现的 Ticker 传给主程序
                if (onSignal && typeof onSignal === 'function') {
                    onSignal(data.ticker);
                }

                latestProcessedTimestamp = data.timestamp;
                hasNewData = true;
            }
        }
    
        if (hasNewData) saveState(latestProcessedTimestamp);
    } catch (e) {
        console.error("Scrape Error:", e.message);
    }
}
