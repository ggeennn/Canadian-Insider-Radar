/**
 * src/services/storage.js
 * * Goal: Save cleaned transactions to a local JSONL file for audit/analysis.
 * * Feature: ID-based Deduplication to prevent saving the same trade twice.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const HISTORY_FILE = path.join(DATA_DIR, 'transactions_history.jsonl');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// [State] 内存中的 ID 缓存，用于快速去重
// 在生产环境中，启动时应该读取文件尾部或建立索引，MVP 阶段简单处理：
// 每次启动时，我们只保证"本次运行"不去重写入。
// 更好的做法是：启动时快速扫描一遍文件加载已有 ID。
const knownIds = new Set();

// 初始化：读取现有文件中的 ID 加载到内存
if (fs.existsSync(HISTORY_FILE)) {
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        try {
            const record = JSON.parse(line);
            if (record.id) knownIds.add(record.id);
        } catch (e) { /* ignore broken lines */ }
    });
    console.log(`📚 Storage Service loaded. Known Transactions: ${knownIds.size}`);
}

export const StorageService = {
    /**
     * 保存交易记录 (带去重)
     * @param {Array} transactions - List of cleaned transaction objects
     * @returns {number} - Count of newly saved records
     */
    save(transactions) {
        let savedCount = 0;
        const stream = fs.createWriteStream(HISTORY_FILE, { flags: 'a' }); // 'a' = Append mode

        transactions.forEach(tx => {
            // [核心去重] 如果 ID 已存在，跳过
            // 注意：SEDI 的 transaction_id 是唯一的
            if (knownIds.has(tx.id)) return;

            // 添加元数据：记录抓取时间
            const record = {
                ...tx,
                _scraped_at: new Date().toISOString()
            };

            // 写入一行 JSON
            stream.write(JSON.stringify(record) + '\n');
            
            // 更新内存缓存
            knownIds.add(tx.id);
            savedCount++;
        });

        stream.end();
        return savedCount;
    },

    /**
     * 导出所有数据 (用于分析)
     */
    getAll() {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        return fs.readFileSync(HISTORY_FILE, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .map(JSON.parse);
    }
};