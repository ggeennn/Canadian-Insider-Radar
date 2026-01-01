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
  * **The Commander (Orchestrator):** `src/index.js` - 单线程事件循环，维护 Task Queue。
  * **Frontend Monitor (Producer):** Playwright - 实时监听 UI 变化，生产 Ticker 任务。
  * **Backend Worker (Consumer):** Playwright (Stealth) - 消费 Ticker 任务，执行 API 调用。
  * **Data Warehouse:** Local JSONL (Raw Data) - 采用 ELT 模式存储。

**4. 数据流 (Data Pipeline)**
1.  **Signal:** Monitor 发现 "$SUNN just filed..." -> **Push to Queue**.
2.  **Throttle:** Commander 等待随机时间 (Jitter 5-15s) -> **Pop from Queue**.
3.  **Fetch:** Worker 读取 `cookies.json` -> 隐身访问 API 获取 Raw Data.
4.  **Load:** 存入 `transactions_history.jsonl` (包含完整 JSON 及其元数据).
5.  **Transform & Analyze:** `analyzer.js` 动态读取 Raw Data -> 应用最新评分逻辑.
6.  **Action:** Score > Threshold 或 Watchlist 异动 -> 写入 `logs/` 并打印报警.

**5. 核心逻辑参数**
- **Safety Interval:** 5s - 15s (Randomized).
- **Analyzer Logic:**
    - **Strong Buy:** Public Market Buy (Code 10) + Positive Net Cash.
    - **Noise:** Grants (Code 50s), Option Flips.
    - **Watchlist:** Alert on ANY Sell (Code 10 Disposition).