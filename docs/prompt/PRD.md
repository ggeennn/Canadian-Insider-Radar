**项目名称:** SEDI Insider Tracker
**核心商业/应用模式:** 实时监控加拿大股市信息流 -> 算法过滤清洗 -> 发现未被市场注意的内部人吸筹信号 -> 辅助个人投资决策 (Alpha Generation)。

**1. 用户画像**
  * **主要:** 个人开发者/投资者 (Me)。寻找加拿大微型市值股 (TSX-V/CSE) 的高赔率机会。
  * **痛点:** SEDI 官网难用、信息滞后；市场噪音大（期权行权、零花钱买入）；手动盯盘效率低。

**2. 核心功能 (MVP Status)**
  * **全市场扫描 (The Scout):** * 实时监控 `https://ceo.ca/@sedi` 信息流。
      * 自动去重 (Watermark Strategy)，自动维护登录会话 (Session Guard)。
  * **数据清洗与增强 (The Processor):**
      * **ID 映射:** 自动将 Ticker 转换为系统内部 ID。
      * **隐身获取:** 使用模拟浏览器指纹技术获取 API 数据，绕过防火墙。
      * **持久化:** 本地 JSONL 数据库存储历史记录。
  * **智能信号评分 (The Analyzer):**
      * **过滤:** 剔除期权行权 (Option Exercise)、非公开市场交易 (Private Placement)。
      * **验证:** 计算 **"Skin in the Game" (真金白银投入)**。
      * **风控:** 识别并丢弃 "Option Flip" (行权即卖) 的伪买入信号。
  * **日志/警报 (Output):**
      * 控制台输出高亮的高价值信号 (Score > Threshold)。

**3. 技术架构 (Architecture)**
  * **Frontend Monitor:** Playwright (Headed) - 负责 UI 触发与 Cookie 桥接。
  * **Backend Client:** **Playwright (Stealth Context)** - *取代 Axios*。使用 Network Context 模拟真实用户行为，解决 403 Forbidden 问题。
  * **Data Source:** CEO.ca (Tier-2 Authenticated API).
  * **Storage:** Local JSONL File System.

**4. 数据流 (Data Pipeline)**
1.  **Monitor:** Detects "$SUNN just filed..." -> Extract `SUNN`.
2.  **Auth Bridge:** Reads `cookies.json` (Maintained by Monitor).
3.  **Map:** Stealth Nav to `search_companies?query=SUNN` -> Get ID `55841`.
4.  **Fetch:** Stealth Nav to `transactions?issuer_number=55841`.
5.  **Store:** Dedup & Append to `transactions_history.jsonl`.
6.  **Compute:** `analyzer.evaluate(transactions)` -> Returns Score.
7.  **Action:** If Score > Threshold -> Alert.

**5. 核心逻辑参数**
- **Window Period:** T+0 (只关注当天的净操作)。
- **Min Value Threshold:** $5,000 CAD (暂定 MVP 门槛)。
- **Insider Role Weight:** CEO/CFO > Director > 10% Holder.