# 项目备忘录 (Project Memorandum)

## 1. 项目概览 (Project Overview)
- **项目名称:** SEDI Insider Tracker (MVP)
- **核心目标:** 自动化捕捉加拿大微型市值 (Micro-cap) 公司的内部人高置信度买入信号 (High-Conviction Insider Buying)。
- **当前阶段:** **Phase 4: System Integration & Hardening.** - 已完成: 核心微服务（Monitor, Fetcher, Analyzer）的编排与集成。实现了**限流队列**与**原始数据存储**。
    - 下一步: 长期运行稳定性测试 (Long-running Test) 与 部署 (Deployment)。

## 2. 技术栈 (Tech Stack)
- **Runtime:** Node.js (ES Modules).
- **Orchestrator:** **Index.js (Producer-Consumer)** - 基于内存队列的任务调度器，负责流量控制。
- **Scout (Monitor):** **Playwright** - 负责实时信号发现 (Producer)。
- **Fetcher (Data):** **Playwright (Stealth)** - 负责隐身数据获取 (Consumer)。
- **Storage:** **JSONL (ELT)** - 存储全量原始数据 (Raw Data)，支持 Schema-on-Read。
- **Logging:** Dual Logging (Console + File Rotation).

### 2.1 关键技术决策 (Key Decisions)
- **Producer-Consumer Architecture:**
    - **决策:** Monitor (快) 与 Fetcher (慢/敏感) 解耦。Monitor 只负责推入 Queue，Index 负责按随机间隔 (Jitter) 消费。
    - **理由:** 防止突发流量导致 API 封禁，平滑请求曲线。
- **ELT over ETL (Raw Data Preservation):**
    - **决策:** 存储 API 返回的完整 `raw` JSON 对象，而非清洗后的字段。
    - **理由:** 金融分析逻辑 (Analyzer) 会频繁迭代。保留原始数据允许我们随时回溯历史数据进行新逻辑的验证 (Backtesting)，无需重新抓取。
- **Recursive Timeout vs SetInterval:**
    - **决策:** 使用递归的 `setTimeout` 配合随机抖动 (5-15s)。
    - **理由:** 确保上一次任务完全结束后才开始下一次倒计时，彻底消除并发冲突风险，模拟真人操作频率。

## 3. 待解决的核心问题 (Critical Issues)
1.  **Deployment:** 需要部署到服务器 (VPS/Raspberry Pi) 进行 24/7 运行测试。
2.  **Notification:** 目前仅有日志输出，需接入 Telegram/Email/Discord 推送模块。
3.  **Error Recovery:** 观察长时间运行后 Monitor 的内存占用及 Session 过期后的自动恢复能力。

## 4. 项目结构快照 (Project Structure)
root/
├── package.json
├── .env                  # Config: Credentials
├── config/
│   └── watchlist.json    # User Watchlist
├── logs/                 # [Auto-Gen] Daily execution logs
├── state/                # [Auto-Gen] Runtime state (Cookies, Watermarks)
│   ├── cookies.json
│   └── monitor_state.json
├── data/
│   └── transactions_history.jsonl # [Auto-Gen] Database (Raw ELT)
├── src/
│   ├── index.js          # The Commander (Entry Point)
│   ├── monitors/
│   │   └── sedi_monitor.js  # v4.0: Callback-based Producer
│   ├── services/
│   │   ├── api_client.js    # v5.0: Raw Data Fetcher
│   │   └── storage.js       # v2.1: Raw Data Persistence
│   ├── utils/
│   │   └── parser.js
│   └── core/
│       └── analyzer.js      # v3.0: Schema-on-Read, Watchlist Logic
└── test_*.js             # Unit Tests

## 5. 待办事项 (TODOs)
- [x] **Step 1-4:** Ingestion Pipeline (Scout, Auth, Fetch, Store).
- [x] **Step 5 (Brain):** Analyzer v3.0 (Professional Codes & Watchlist).
- [x] **Step 6 (Orchestrator):** `index.js` 集成，实现队列与限流。
- [x] **Step 7 (Logging):** 本地文件日志系统。
- [ ] **Step 8 (Reporter):** 实现 Telegram/Email 报警推送。