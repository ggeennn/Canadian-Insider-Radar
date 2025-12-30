# 项目备忘录 (Project Memorandum)

## 1. 项目概览 (Project Overview)
- **项目名称:** SEDI Insider Tracker (MVP)
- **核心目标:** 自动化捕捉加拿大微型市值 (Micro-cap) 公司的内部人高置信度买入信号 (High-Conviction Insider Buying)。
- **当前阶段:** **Phase 3: Logic Construction & Persistence.** - 已完成: 全链路数据摄取 (Ingestion Pipeline) —— 包含自动登录、反爬绕过、数据清洗与存储。
    - 进行中: 评分算法实现 (`analyzer.js`)。

## 2. 技术栈 (Tech Stack)
- **Runtime:** Node.js (ES Modules).
- **Scout (Monitor):** **Playwright** (Headless/Headed) - 负责实时监控与**自动会话维护 (Auto-Login)**。
- **Fetcher (Data):** **Playwright (Stealth Mode)** - *取代 Axios*。利用全浏览器导航 (`page.goto`) 与 `navigator.webdriver` 屏蔽技术，绕过 Cloudflare 403 拦截。
- **Storage:** **JSONL** (Append-only) - 本地文件存储，通过 ID 去重。
- **Auth Strategy:** **Cookie Bridging** (Monitor 生成 Cookie -> JSON 文件 -> Fetcher 注入 Cookie)。

### 2.1 关键技术决策 (Key Decisions)
- **Stealth Navigation over HTTP Client:**
    - 尝试使用 Axios 失败 (403 Forbidden)，因 Cloudflare 识别 Node.js TLS 指纹。
    - **决策:** 升级为 "Nuclear Option"。让 Fetcher 模拟真实用户打开 API URL，并注入 `--disable-blink-features=AutomationControlled` 参数彻底隐身。
- **Decoupled Session Management:**
    - **决策:** 将“身份维持”职责完全交给 Monitor。Monitor 负责通过 UI 登录并刷新 `cookies.json`。Fetcher 仅负责读取凭证，实现职责分离。
- **Storage Format:**
    - **决策:** 选用 `.jsonl` (JSON Lines)。避免 JSON 数组读写时的全量解析开销，支持高频追加写入，且容错性强。

## 3. 待解决的核心问题 (Critical Issues - HIGH PRIORITY)
1.  **Signal Logic:** 实现 `analyzer.js`，特别是处理 `Price: 0` 的边缘情况（Fallback 机制）。
2.  **Session Expiry:** 需观察 `cookies.json` 的有效期。如果 Session 过期，Monitor 需要有能力检测并重新登录 (目前实现了启动时检查)。
3.  **Long-running Stability:** 在无人值守情况下，确保 Monitor 不会因内存泄漏或意外弹窗崩溃。

## 4. 项目结构快照 (Project Structure)
root/
├── package.json
├── .env                # Config: CEO_EMAIL, CEO_PASSWORD
├── cookies.json        # [Auto-Gen] Stores valid session cookies
├── monitor_state.json  # [Auto-Gen] Watermark for deduplication
├── data/
│   └── transactions_history.jsonl # [Auto-Gen] Persistent database
├── src/
│   ├── monitors/
│   │   └── sedi_monitor.js  # v3.2: Auto-Login, React-Aware, Non-blocking wait
│   ├── services/
│   │   ├── api_client.js    # v4.1: Stealth Mode Browser Fetcher
│   │   └── storage.js       # JSONL Append Service with ID Dedup
│   ├── utils/
│   │   └── parser.js        # Helper: Clean currency/number strings
│   └── core/
│       └── analyzer.js      # (Pending) The "Brain": Scoring logic
└── test_fetcher.js     # Integration Test Script

## 5. 待办事项 (TODOs)
- [x] **Step 1 (Scout):** Playwright Monitor 实时抓取 Ticker + 水位线去重。
- [x] **Step 2 (Auth):** 实现 React 页面自动登录，获取会员级 Cookie。
- [x] **Step 3 (Fetcher):** 攻克 Cloudflare 反爬，实现 API 数据获取。
- [x] **Step 4 (Storage):** 实现 JSONL 存储与 ID 去重。
- [ ] **Step 5 (Brain):** 实现 `analyzer.js` 评分逻辑 (Net Buy Calculation)。
- [ ] **Step 6 (Reporter):** 格式化输出/通知模块。