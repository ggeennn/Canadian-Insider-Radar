/**
 * src/services/storage.js (v2.1 - Raw Data Compatible)
 * * Logic: Same dedup logic, but now handling objects that contain a 'raw' field.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const HISTORY_FILE = path.join(DATA_DIR, 'transactions_history.jsonl');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const knownSediIds = new Set();

// 初始化加载去重缓存
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const content = fs.readFileSync(HISTORY_FILE, 'utf8');
        content.split('\n').forEach(line => {
            if (!line.trim()) return;
            const record = JSON.parse(line);
            if (record.sediId) knownSediIds.add(record.sediId);
        });
        console.log(`📚 Storage loaded. Known transactions: ${knownSediIds.size}`);
    } catch (e) { console.warn("⚠️ Error reading history file."); }
}

export const StorageService = {
    save(transactions) {
        let savedCount = 0;
        const stream = fs.createWriteStream(HISTORY_FILE, { flags: 'a' });

        transactions.forEach(record => {
            // 查重 (基于索引层字段)
            if (knownSediIds.has(record.sediId)) return;

            // 添加抓取时间戳 (Metadata)
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