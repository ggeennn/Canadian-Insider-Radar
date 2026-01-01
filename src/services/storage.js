/**
 * src/services/storage.js (v3.0 - Data Hygiene Enforced)
 * 
 *
 * 1. Discard "Noise" codes (Admin, Dividends, Splits) to save space.
 * 2. Filter low-value Plan purchases (Code 30 < $1000).
 * 3. Filter zero-cost Grants (Code 50 @ $0) as they are compensation, not signals.
 */

import fs from 'fs';
import path from 'path';
import { Parser } from '../utils/parser.js';

const DATA_DIR = 'data';
const HISTORY_FILE = path.join(DATA_DIR, 'transactions_history.jsonl');

// --- DISCARD PROTOCOL ---
// 90: Change in ownership nature (Admin)
// 97/99: Other/Correction (Noise)
// 35: Stock Dividend (Passive)
// 37: Split/Consolidation (Math)
// 00: Opening Balance (State, not Flow)
const NOISE_CODES = ['90', '97', '99', '35', '37', '00'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const knownSediIds = new Set();

// Load existing IDs for deduplication
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const content = fs.readFileSync(HISTORY_FILE, 'utf8');
        content.split('\n').forEach(line => {
            if (!line.trim()) return;
            try {
                const record = JSON.parse(line);
                if (record.sediId) knownSediIds.add(record.sediId);
            } catch (err) {
                // Skip malformed lines
            }
        });
        console.log(`📚 Storage loaded. Known transactions: ${knownSediIds.size}`);
    } catch (e) { console.warn("⚠️ Error reading history file."); }
}

export const StorageService = {
    save(transactions) {
        let savedCount = 0;
        const stream = fs.createWriteStream(HISTORY_FILE, { flags: 'a' });

        transactions.forEach(record => {
            // 1. Dedup Check
            if (knownSediIds.has(record.sediId)) return;

            // 2. Data Hygiene / Noise Filtering
            const tx = record.raw;
            const code = Parser.extractTxCode(tx.type);

            // A. Hard Noise Filter
            if (NOISE_CODES.includes(code)) return;

            // B. Value Filter for Plans (Code 30)
            // Eliminate tiny DRIPs (Dividend Reinvestment) under $500
            if (code === '30') {
                const price = Parser.cleanNumber(tx.unit_price) || Parser.cleanNumber(tx.price);
                const amt = Math.abs(Parser.cleanNumber(tx.number_moved));
                if ((price * amt) < 500) return; 
            }

            // C. Compensation Filter (Code 50 - Grants)
            // If price is 0, it's a free grant (Salary), not a market signal.
            if (code === '50') {
                const price = Parser.cleanNumber(tx.price) || Parser.cleanNumber(tx.unit_price);
                if (price === 0) return;
            }

            // 3. Save Valid Record
            // Add scraped timestamp for audit
            const entry = {
               ...record,
                _scraped_at: new Date().toISOString()
            };

            stream.write(JSON.stringify(entry) + '\n');
            knownSediIds.add(record.sediId);
            savedCount++;
        });

        stream.end();
        return savedCount;
    }
};