/**
 * src/monitors/sedi_monitor.js (v3.2 - Non-Blocking Auth)
 * * Fix: Removed strict 'networkidle' wait to handle live video streams.
 * * Fix: Aggressive selector targeting for the Login button.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_URL = 'https://ceo.ca/@sedi';
const STATE_FILE = 'monitor_state.json';
const COOKIE_FILE = 'cookies.json';

const EMAIL = process.env.CEO_EMAIL;
const PASSWORD = process.env.CEO_PASSWORD;

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

/**
 * src/monitors/sedi_monitor.js (Fix: Strict Mode Violation)
 * 修正: 使用 getByRole 精确点击 "Log in" 按钮，避开 "Subscribe" 按钮。
 */
async function performLogin(page) {
    console.log("🔐 Starting Auth Sequence (Fast Mode)...");

    try {
        // [Step 1] 寻找首页的 "Log In" 按钮 (Sidebar)
        const loginBtn = page.getByRole('button', { name: 'Log In', exact: true }).first();
        await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
        
        console.log("⚡ 'Log In' button visible. Clicking...");
        await loginBtn.click();
    } catch (e) {
        console.log("⚠️ 'Log In' button not found. Assuming already logged in.");
        return; 
    }

    // [Step 2] 等待弹窗表单
    try {
        console.log("⏳ Waiting for login form...");
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
    } catch (e) {
        console.error("❌ Login form did not pop up! Saving debug screenshot.");
        await page.screenshot({ path: 'debug_no_form.png' });
        throw e;
    }

    // [Step 3] 填表
    console.log("📝 Filling credentials...");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);

    // [Step 4] 提交 (关键修正)
    console.log("🚀 Submitting...");
    
    // Fix: 之前使用了通用的 form button[type="submit"] 导致匹配到了侧边栏的 Subscribe 按钮
    // 现在使用最精确的 Role 定位，且要求文本完全匹配 "Log in"
    await page.getByRole('button', { name: 'Log in', exact: true }).click();

    // [Step 5] 等待登录完成
    console.log("⏳ Waiting for session cookie...");
    await page.waitForTimeout(5000); 
}

async function saveCookies(page) {
    const cookies = await page.context().cookies();
    
    if (cookies.length === 0) {
        console.warn("⚠️ Warning: 0 Cookies captured.");
    } else {
        console.log(`🍪 Cookies captured: ${cookies.length}`);
        // 检查是否有会员 session
        const sessionCookie = cookies.find(c => c.name.includes('session'));
        if (sessionCookie) {
            console.log(`✅ FOUND SESSION COOKIE: ${sessionCookie.name}`);
        } else {
            console.log("⚠️ No explicit 'session' cookie found (might still work).");
        }
    }

    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

let latestProcessedTimestamp = loadState();

async function startMonitor() {
    console.log("Starting SEDI Monitor v3.2 (Fast)...");
    
    // 使用 args 屏蔽自动化特征，防止弹窗不出来
    const browser = await chromium.launch({ 
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'] 
    }); 
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    try {
        // 只等待 DOM 加载完，不等图片和视频
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
        
        await performLogin(page);
        await saveCookies(page);

        console.log("👀 Monitor loop starting...");
        await scanForNewFilings(page); 
        setInterval(async () => {
            await scanForNewFilings(page);
        }, 5000);

    } catch (error) {
        console.error("❌ Critical Error:", error);
        await page.screenshot({ path: 'error_state_v3.2.png' });
    }
}

async function scanForNewFilings(page) {
    try {
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
                latestProcessedTimestamp = data.timestamp;
                hasNewData = true;
            }
        }
    
        if (hasNewData) saveState(latestProcessedTimestamp);
    } catch (e) {
        console.error("Scrape Error:", e.message);
    }
}

startMonitor();