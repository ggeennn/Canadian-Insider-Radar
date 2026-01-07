# SEDI Insider Tracker (MVP)

**Automated High-Conviction Insider Trading Detection for Canadian Markets**

SEDI Insider Tracker is a sophisticated financial intelligence tool designed to monitor, filter, and analyze insider trading activities on the TSX and TSX-V exchanges. Unlike basic scrapers, it employs a **Hybrid Ingestion Architecture** and an **AI-Driven RAG Pipeline** to distinguish "noise" (routine auto-plans) from "signal" (opportunistic whale buys).

## 🚀 Current Status: MVP Delivered (Phase 7)

The system is currently stable and running in **Level 2 Competency (Contextual Intelligence)**.

### Key Features
* **Hybrid Data Ingestion**: Combines real-time event monitoring (Playwright) with deep data fetching (Axios).
* **Smart Scoring Engine (v9.3)**:
    * **Cohen-Malloy-Pomorski Logic**: Separates "Opportunistic" trades from "Routine" auto-plans.
    * **Whale Impact**: Detects trades exceeding 0.1% of market cap.
    * **Robot Consensus Defense**: Penalizes artificial consensus driven by automated purchase plans.
    * **Dilution Guard**: Automatically penalizes private placements unless hedged by open market buying.
* **Deep RAG News Pipeline**:
    * **Dual-Search**: Queries both Ticker and Company Name to ensure coverage.
    * **Content Extraction**: Uses Cheerio to scrape full article bodies (not just headlines), feeding the "Ground Truth" to the AI.
    * **Hallucination Proof**: Explicitly flags "Headlines Only" vs. "Deep Read" in logs.
* **AI Auditor**: Generates dialectic "Bull vs. Bear" memos for every high-conviction signal using openAI compatible resource.

---

## 🛠️ Installation & Deployment

### Prerequisites
* Node.js (v18+)
* Local LLM Proxy (e.g., standard OpenAI compatible endpoint for Gemini)

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd SEDI_Insider_Tracker
npm install
```

### 2. Configuration

Create a `.env` file in the root directory and add the following credentials.
*(Note: These are your specific local configuration settings)*

```ini
# --- SEDI / CEO.CA Credentials ---
# Used by the Playwright monitor to access real-time feeds
CEO_EMAIL=...
CEO_PASSWORD=...
# --- AI Service Configuration ---
# Pointing to Local Proxy (Gemini 1.5 Flash)
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...

```

### 3. Run

Start the tracker. It will initialize the monitor, load your watchlist, and begin scanning.

```bash
# Production mode (Recommended)
npm run dev
# or
node --max-http-header-size=81920 src/index.js

```

*Note: The system is optimized with `--max-http-header-size=81920` to handle large cookies from financial news sites.*

---

## 🔮 Roadmap & Future Extensions

* **Notification System**: Integration with **Telegram Bot API** to push Markdown-formatted AI reports directly to mobile devices.
* **News Source Optimization**: Integrating specialized micro-cap news aggregators (e.g., CEO.ca Pro feed) to cover CSE stocks that Yahoo Finance misses.
* **Visual Dashboard**: A lightweight frontend to visualize the "Whale Impact" timeline.

---

## 📂 Project Structure

```text
src/
├── config/         # Scoring Logic & watchlist
├── core/           # Analyzer
├── monitors/       # Playwright Real-time Monitor
├── services/
│   ├── news/       # Deep Scraper (Axios + Cheerio)
│   ├── llm/        # AI Service
│   └── market_data/     # Yahoo Finance Adapter
├── utils/
└── index.js        # Main Entry Point

```
