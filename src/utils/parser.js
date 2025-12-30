/**
 * src/utils/parser.js
 * * Goal: Convert dirty API strings into clean Numbers.
 * * Input: "+239,491", "", "2.5000"
 * * Output: 239491, 0, 2.5
 */

export const Parser = {
    /**
     * 清洗带符号和逗号的数字字符串
     * @param {string} str - e.g. "+239,491" or "-5,000" or ""
     * @returns {number}
     */
    cleanNumber(str) {
        if (!str || typeof str !== 'string') return 0;
        
        // 1. 移除逗号 "," 和 "$"
        // 2. 移除所有空格
        const cleanStr = str.replace(/[,$\s]/g, '');
        
        // 3. 转换为浮点数
        const num = parseFloat(cleanStr);
        
        // 4. 如果是非数字(NaN)，返回0
        return isNaN(num) ? 0 : num;
    },

    /**
     * 从 "Type" 字段提取交易代码
     * Input: "54 - Exercise of warrants"
     * Output: "54"
     */
    extractTxCode(typeStr) {
        if (!typeStr) return "00";
        return typeStr.split(' - ')[0].trim();
    }
};