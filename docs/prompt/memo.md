# 项目备忘录 (Project Memorandum)

## 1. 项目概览 (Project Overview)
- **项目名称:** SEDI Insider Tracker (MVP)
- **核心目标:** 自动化捕捉加拿大微型市值 (Micro-cap) 公司的内部人高置信度买入信号 (High-Conviction Insider Buying)。
- **当前阶段:** **Architecture Locked & Prototyping.** 已完成技术路径验证 (Proof of Concept)，确定了 "Frontend Monitor + Backend API" 的混合架构，即将开始代码实现。

## 2. 技术栈 (Tech Stack)
- **Runtime:** Node.js (ES Modules).
- **Scout (Monitor):** **Playwright** (Headless Browser) - 用于监控实时 HTML 流。
- **Fetcher (Data):** **Axios** - 用于调用逆向工程发现的 JSON API。
- **Data Logic:** JavaScript (Native) - 实现 T+0 净行为分析与评分。
- **Scheduling:** `setInterval` (MVP阶段轮询)。
- **Target Source:** CEO.ca (作为 SEDI 数据的 Proxy).

### 2.1 关键技术决策 (Key Decisions)
- **Hybrid Ingestion Architecture (混合摄取架构):**
    - 放弃纯 Playwright 爬取详情页（速度慢、DOM 易变）。
    - 放弃纯 API 轮询（`recent_trades` 接口有付费墙 `pro-only`）。
    - **决策:** 采用 **"UI 触发 + API 获取"** 模式。利用 Playwright 监控公开的 `@sedi` 频道作为“触发器”，获取 Ticker 后，调用隐藏的 `new-api.ceo.ca` 获取结构化数据。
- **Logic Refinement (业务逻辑修正):**
    - 放弃“单笔交易判定”逻辑。
    - **决策:** 引入 **"T+0 Net Daily Analysis" (T+0 净行为分析)**。聚合同一内部人当天的所有交易，剔除 "Option Flipping" (行权后立即卖出) 和 "Zero Cost Exercise" 的干扰，只计算净现金投入。
- **ID Resolution Strategy:**
    - 不尝试从 URL 逆向推导 Issuer ID。
    - **决策:** 使用 `search_companies` API 将 Ticker 映射为 `issuer_number`，再请求交易详情。

### 2.2 执行流程
- 1. 监测到新form提交=>拿到ticker
- 2. GET https://new-api.ceo.ca/api/sedi/search_companies?query=[具体ticker] =>拿到issue_number
- 3. GET https://new-api.ceo.ca/api/sedi/transactions?issuer_number=[拿到的issue_number]&page=1&limit=10&date_sort_field=transaction_date =>拿到目标数据(page1?数据量prams还要再测试)
- 4. 后续数据分析以及其他api调用（公司财务数据/新闻/股价量化指标）

## 3. 待解决的核心问题 (Critical Issues - HIGH PRIORITY)
1.  **Rate Limiting:** 需要测试 CEO.ca 对 API 调用的速率限制，可能需要引入随机延迟 (Jitter) 或简单的队列机制。
2.  **Data Consistency:** 需验证 `new-api` 返回的 `number_moved` 字段格式（如带逗号的字符串 "+81,506"）的解析稳定性。

## 4. 项目结构快照 (Project Structure)
root/
├── package.json
├── .env                # (Future) Discord Webhook URL, Database Config
├── src/
│   ├── index.js        # Entry point (Main Loop)
│   ├── monitors/
│   │   └── sedi_monitor.js  # Playwright script looking at https://ceo.ca/@sedi
│   ├── services/
│   │   └── api_client.js    # Axios wrapper for search_companies & transactions
│   ├── core/
│   │   └── analyzer.js      # The "Brain": Scoring logic & Van Doorn Trap filter
│   └── utils/
│       └── parser.js        # Helper to clean currency/number strings
└── logs/               # Local execution logs

## 5. 待办事项 (TODOs)
- [ ] **Step 1 (Scout):** 编写 Playwright 脚本，成功从 `@sedi` 页面抓取最新的 `$TICKER`。
- [ ] **Step 2 (Mapper):** 封装 `search_companies` API，实现 Ticker -> Issuer ID 的转换。
- [ ] **Step 3 (Fetcher):** 封装 `transactions` API，获取原始 JSON 数据。
- [ ] **Step 4 (Brain):** 实现 `analyzer.js`，跑通 "Andrew van Doorn" 案例的测试（应识别为持有或卖出，而非买入）。