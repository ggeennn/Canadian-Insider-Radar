/**
 * src/services/api_client.js (v5.2 - Robust Error Handling & Filters)
 * * Fix: Added detailed error logging to debug empty returns.
 * * Feature: Filters out 'D' (Deleted) and 'O' (Old) records.
 */

import { chromium } from 'playwright'; 
import fs from 'fs';
import path from 'path'; 

const BASE_URL = 'https://new-api.ceo.ca/api/sedi';
const STATE_DIR = 'state'; 
const COOKIE_FILE = path.join(STATE_DIR, 'cookies.json');

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
        const browser = await chromium.launch({ 
            headless: false, 
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
        }); 
        
        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 }
            });
            
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            const cookies = loadCookies();
            if (cookies.length > 0) await context.addCookies(cookies);

            const page = await context.newPage();
            
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Cloudflare Check
            const bodyText = await page.innerText('body');
            if (bodyText.includes("Just a moment") || bodyText.includes("Verify you are human")) {
                 console.warn("⚠️ Cloudflare challenge detected... Waiting 5s...");
                 await page.waitForTimeout(5000); 
            }

            const finalContent = await page.innerText('body');
            try {
                return JSON.parse(finalContent);
            } catch (e) {
                console.error(`❌ JSON Parse Error. Content preview: ${finalContent.substring(0, 100)}...`);
                throw new Error("Invalid JSON Response");
            }

        } catch (err) {
            throw err;
        } finally {
            await browser.close();
        }
    },
    
    async getIssuerId(ticker) {
        try {
            const cleanTicker = ticker.replace('$', '').toUpperCase();
            const url = `${BASE_URL}/search_companies?query=${cleanTicker}`;
            const data = await this._browserFetch(url);

            if(!data || !data.results) return null;
            
            const exactMatch = data.results.find(item => {
                 const symbol = item.symbol.toUpperCase();
                 return symbol === cleanTicker || symbol.startsWith(`${cleanTicker}.`);
            });
            return exactMatch ? exactMatch.issuer_no : data.results[0].issuer_no;
        } catch (error) {
            console.error(`❌ Error getting Issuer ID for ${ticker}: ${error.message}`);
            return null;
        }
    },

    async getTransactions(issuerId) {
        if (!issuerId) return [];
        
        try {
            console.log(`📥 Fetching transactions for ID: ${issuerId}...`);
            const url = `${BASE_URL}/transactions?issuer_number=${issuerId}&page=1&limit=20&date_sort_field=transaction_date`;
            
            const data = await this._browserFetch(url);
            
            if (!data || !data.transactions) {
                console.warn(`⚠️ No transactions field in response for ID ${issuerId}`);
                return [];
            }

            const rawTxs = data.transactions;

            const validTxs = rawTxs.filter(tx => {
                const state = tx.state ? tx.state.toUpperCase() : '';
                return !['D', 'O'].includes(state);
            });

            if (validTxs.length < rawTxs.length) {
                console.log(`ℹ️ Filtered ${rawTxs.length - validTxs.length} duplicate/deleted records.`);
            }

            return validTxs.map(tx => ({
                sediId: tx.sedi_transaction_id,
                symbol: tx.symbol,
                date: tx.transaction_date,
                raw: tx 
            }));

        } catch (error) {
            console.error(`❌ API Error (getTransactions): ${error.message}`);
            return [];
        }
    }
};