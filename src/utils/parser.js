/**
 * src/utils/parser.js
 * * Goal: Convert dirty API strings into clean Numbers.
 * * Input: "+239,491", "", "2.5000"
 * * Output: 239491, 0, 2.5
 */

export const Parser = {
    /**
     * Cleans number strings with symbols and commas
     * @param {string} str - e.g. "+239,491" or "-5,000" or ""
     * @returns {number}
     */
    cleanNumber(str) {
        if (!str || typeof str !== 'string') return 0;
        
        // 1. Remove commas "," and "$"
        // 2. Remove all spaces
        const cleanStr = str.replace(/[,$\s]/g, '');
        
        // 3. Convert to float
        const num = parseFloat(cleanStr);
        
        // 4. If not a number (NaN), return 0
        return isNaN(num) ? 0 : num;
    },

    /**
     * Extracts transaction code from "Type" field
     * Input: "54 - Exercise of warrants"
     * Output: "54"
     */
    extractTxCode(typeStr) {
        if (!typeStr) return "00";
        return typeStr.split(' - ')[0].trim();
    }
};
