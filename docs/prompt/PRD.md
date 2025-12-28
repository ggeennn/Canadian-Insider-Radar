**项目名称:** SEDI Insider Tracker
**核心商业/应用模式:** 实时监控加拿大股市信息流 -> 算法过滤清洗 -> 发现未被市场注意的内部人吸筹信号 -> 辅助个人投资决策 (Alpha Generation)。

**1. 用户画像**
  * **主要:** 个人开发者/投资者 (Me)。寻找加拿大微型市值股 (TSX-V/CSE) 的高赔率机会。
  * **痛点:** SEDI 官网难用、信息滞后；市场噪音大（期权行权、零花钱买入）；手动盯盘效率低。

**2. 核心功能 (MVP Status)**
  * **全市场扫描 (The Scout):** * 实时监控 `https://ceo.ca/@sedi` 信息流。
      * 自动去重，只处理 60 秒内新出现的 Ticker。
  * **数据清洗与增强 (The Processor):**
      * **ID 映射:** 自动将 Ticker 转换为系统内部 ID。
      * **结构化获取:** 获取该 ID 最近 20 条交易记录 (JSON)。
  * **智能信号评分 (The Analyzer):**
      * **过滤:** 剔除期权行权 (Option Exercise)、非公开市场交易 (Private Placement)。
      * **验证:** 计算 **"Skin in the Game" (真金白银投入)**。
      * **风控:** 识别并丢弃 "Option Flip" (行权即卖) 的伪买入信号。
  * **日志/警报 (Output):**
      * 控制台输出高亮的高价值信号 (Score > Threshold)。

**3. 技术架构 (Architecture)**
  * **Frontend Monitor:** Playwright (Headless Chrome) - 用于突破付费墙获取实时流。
  * **Backend Client:** Axios (Node.js) - 用于高效获取结构化数据。
  * **Data Source:** CEO.ca (Reverse Engineered APIs).
  * **Execution:** Local Node.js Process.

**4. 数据流 (Data Pipeline)**
1.  **Ingest:** Playwright sees "$SUNN just filed..." -> Extract `SUNN`.
2.  **Map:** API Call `search_companies?query=SUNN` -> Get ID `55841`.
3.  **Fetch:** API Call `transactions?issuer_number=55841`.
4.  **Compute:** `analyzer.evaluate(transactions)` -> Returns Score.
5.  **Action:** If Score > 50 -> Alert.

**5. 核心逻辑参数**
- **Window Period:** T+0 (只关注当天的净操作)。
- **Min Value Threshold:** $5,000 CAD (暂定 MVP 门槛)。
- **Insider Role Weight:** CEO/CFO > Director > 10% Holder.