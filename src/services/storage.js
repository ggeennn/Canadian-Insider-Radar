/**
 * src/services/storage.js
 * Returns count of NEW records to trigger analysis pipeline.
 */

import fs from 'fs';
import path from 'path';
import { Parser } from '../utils/parser.js';

const DATA_DIR = 'data';
const HISTORY_FILE = path.join(DATA_DIR, 'transactions_history.jsonl');
const NOISE_CODES = ['90', '97', '99', '35', '37', '00'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const knownSediIds = new Set();

// Load existing IDs
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const content = fs.readFileSync(HISTORY_FILE, 'utf8');
        content.split('\n').forEach(line => {
            if (!line.trim()) return;
            try {
                const record = JSON.parse(line);
                if (record.sediId) knownSediIds.add(record.sediId);
            } catch (err) {}
        });
        console.log(`📚 Storage loaded. Known transactions: ${knownSediIds.size}`);
    } catch (e) { console.warn("⚠️ Error reading history file."); }
}

export const StorageService = {
    /**
     * Saves unique records to history.
     * @returns {number} The count of NEW records actually saved.
     */
    save(transactions) {
        let savedCount = 0;
        const stream = fs.createWriteStream(HISTORY_FILE, { flags: 'a' });

        transactions.forEach(record => {
            // 1. Dedup Check
            if (knownSediIds.has(record.sediId)) return;

            const tx = record.raw;
            const code = Parser.extractTxCode(tx.type);

            // 2. Noise Filter
            if (NOISE_CODES.includes(code)) return;

            // 3. Value Filter (Plans < $500)
            if (code === '30') {
                const price = Parser.cleanNumber(tx.unit_price) || Parser.cleanNumber(tx.price);
                const amt = Math.abs(Parser.cleanNumber(tx.number_moved));
                if ((price * amt) < 500) return; 
            }

            // 4. Grant Filter ($0 price)
            if (code === '50') {
                const price = Parser.cleanNumber(tx.price) || Parser.cleanNumber(tx.unit_price);
                if (price === 0) return;
            }

            // 5. Save Valid Record
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
    },
    
    isKnown(sediId) {
        return knownSediIds.has(sediId);
    }
};