/**
 * src/services/api_client.js (v4.1 - Stealth Mode)
 * * Feature: Mask navigator.webdriver to fool Cloudflare.
 * * Feature: Wait for Cloudflare challenge to complete.
 */

import { chromium } from 'playwright'; 
import fs from 'fs';
import { Parser } from '../utils/parser.js'; // 保持引用

const BASE_URL = 'https://new-api.ceo.ca/api/sedi';
const COOKIE_FILE = 'cookies.json';

function loadCookies() {
    try {
        if (fs.existsSync(COOKIE_FILE)) {
            return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
        }
    } catch (e) {
        console.warn("⚠️ No cookie file found.");
    }
    return [];
}

export const ApiService = {
    async _browserFetch(url) {
        // [隐身术 Step 1] 启动参数屏蔽自动化特征
        const browser = await chromium.launch({ 
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled', // 核心：禁用自动化控制特征
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        }); 
        
        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 }
            });
            
            // [隐身术 Step 2] 注入脚本，彻底删除 navigator.webdriver 属性
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });
            });

            // 注入 Cookie
            const cookies = loadCookies();
            if (cookies.length > 0) {
                await context.addCookies(cookies);
            }

            const page = await context.newPage();

            console.log(`🚀 Navigating to: ${url}`);
            
            // 访问页面
            const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

            // [核心修正] 处理 Cloudflare 挑战
            // 如果 Cloudflare 正在检查浏览器，它会返回 403 或 503，并显示 "Just a moment..."
            // 我们不能立即报错，而是要等一等
            
            console.log(`⏳ Waiting for content (Status: ${response.status()})...`);
            
            // 强制等待 5 秒，给 Cloudflare 自动跳转的时间
            await page.waitForTimeout(5000);

            // 二次检查：获取当前页面文本
            const bodyText = await page.innerText('body');
            
            // 检查是否还在 Cloudflare 等待页
            if (bodyText.includes("Just a moment") || bodyText.includes("Verify you are human")) {
                 console.warn("⚠️ Still stuck in Cloudflare challenge...");
                 // 此时可以截图调试: await page.screenshot({ path: 'cf_block.png' });
                 throw new Error("Cloudflare Challenge Blocked");
            }

            // 尝试解析 JSON
            try {
                return JSON.parse(bodyText);
            } catch (e) {
                // 如果解析失败，说明返回的不是 JSON（可能是 HTML 错误页）
                console.error("❌ Response is not JSON. Preview:", bodyText.substring(0, 100));
                throw new Error("Invalid JSON Response");
            }

        } catch (err) {
            throw err;
        } finally {
            await browser.close();
        }
    },
    
    // ... getIssuerId 和 getTransactions 保持不变 ...
    // (请确保把它们也复制回来，或者只替换上面的 _browserFetch 函数)
    async getIssuerId(ticker) {
        // ... (保持原样)
        const cleanTicker = ticker.replace('$', '').toUpperCase();
        const url = `${BASE_URL}/search_companies?query=${cleanTicker}`;
        const data = await this._browserFetch(url);
        // ...
        if(!data || !data.results) return null; // 简单防崩
        const results = data.results;
        // ...
        const exactMatch = results.find(item => {
             const symbol = item.symbol.toUpperCase();
             return symbol === cleanTicker || symbol.startsWith(`${cleanTicker}.`);
        });
        if (exactMatch) return exactMatch.issuer_no;
        return results[0].issuer_no;
    },

    async getTransactions(issuerId) {
        // ... (保持原样)
        if (!issuerId) return [];
        const url = `${BASE_URL}/transactions?issuer_number=${issuerId}&page=1&limit=20&date_sort_field=transaction_date`;
        const data = await this._browserFetch(url);
        // ...
        const rawTxs = data.transactions;
        if(!rawTxs) return []; // 简单防崩

        return rawTxs.map(tx => ({
            id: tx.id,
            date: tx.transaction_date,
            typeCode: Parser.extractTxCode(tx.type),
            typeDesc: tx.type,
            amount: Parser.cleanNumber(tx.number_moved),
            price: Parser.cleanNumber(tx.price),
            insider: tx.insider_name,
            relation: tx.relationship_type,
            security: tx.security
        }));
    }
};