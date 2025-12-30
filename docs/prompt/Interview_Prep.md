## Project: SEDI Insider Tracker
*An automated data pipeline for detecting high-conviction insider trading signals in Canadian micro-caps.*

### Talking Point: Hybrid Ingestion Architecture (混合摄取架构)

- **1. The Challenge (挑战/问题):**
    - `1.1.` The target data source (SEDI/CEO.ca) presented a dilemma: The real-time feed was accessible only via HTML (Unstructured), while the structured API endpoints were either hidden or behind a paywall (Rate-limited).
- **2. The Solution (技术方案 - What & Why):**
    - `2.1.` I designed a **Hybrid Ingestion Architecture**. It uses a Headless Browser (Playwright) as a lightweight "Scout" to trigger events, and a reverse-engineered internal API (Axios) as a "Fetcher" to retrieve data.
    - `2.2.` This approach bypassed the need for expensive "Pro" subscriptions legally (using public data) while maintaining real-time latency and data structure integrity.
- **3. My Contribution (我的贡献 - How):**
    - `3.1.` I analyzed the network traffic (DevTools) to uncover the hidden `search_companies` and `transactions` APIs.
    - `3.2.` **Interview Script:** "In my Insider Tracker project, I needed real-time structured data which was behind a paywall. I reverse-engineered the site's internal API and built a hybrid architecture: using Playwright to monitor the public feed for triggers, and Axios to fetch specific data points from the hidden API. This reduced data latency by 90% compared to traditional scraping."

### Talking Point: T+0 Net Daily Analysis (数据清洗逻辑)

- **1. The Challenge (挑战/问题):**
    - `1.1.` Raw insider filing data is noisy. A "Buy" record often isn't a real purchase—it could be an "Option Exercise" followed by an immediate sale (Option Flipping), which creates a false positive signal for investors.
- **2. The Solution (技术方案 - What & Why):**
    - `2.2.` I implemented a **T+0 Net Daily Analysis** algorithm. Instead of alerting on single transactions, the system aggregates all actions by an insider within a 24-hour window to calculate the "Net Cash Invested".
- **3. My Contribution (我的贡献 - How):**
    - `3.1.` I wrote the logic to detect "Cashless Exercises" (where Sell Value ≈ Buy Value) and filter them out, ensuring only genuine "Skin in the Game" capital flows triggered alerts.
    - `3.2.` **Interview Script:** "I realized that simple keyword filtering resulted in false positives due to option exercises. I developed a scoring algorithm that aggregates daily transaction pairs. For example, if a CEO exercises options and sells immediately, my system recognizes the net neutral cash flow and discards the signal, whereas a standard scraper would have flagged it as a 'Buy'."

### Talking Point: Bypassing TLS Fingerprinting (高级反爬突破)

- **1. The Challenge (挑战/问题):**
    - `1.1.` During the development of the data fetcher, I encountered persistent **403 Forbidden** errors, even when providing valid authentication headers.
    - `1.2.` I diagnosed this as **TLS Fingerprinting** by Cloudflare. The security layer was identifying the "robot accent" of my Node.js HTTP client (Axios), which differs from a standard browser's handshake.
- **2. The Solution (技术方案 - What & Why):**
    - `2.1.` I pivoted to a **"Stealth Browser Navigation"** strategy. Instead of patching the HTTP client, I used Playwright to launch a lightweight browser context to navigate directly to the API endpoints.
    - `2.2.` Crucially, I injected browser arguments (e.g., `--disable-blink-features=AutomationControlled`) and masked the `navigator.webdriver` property. This effectively "cloaked" the automation script, making it indistinguishable from a human user.
- **3. My Contribution (我的贡献 - How):**
    - `3.1.` I rewrote the `api_client` module to replace Axios with Playwright's network stack.
    - `3.2.` **Interview Script:** "When standard HTTP requests failed due to Cloudflare's TLS fingerprinting, I didn't give up. I re-architected the fetcher to use a stealth-mode browser context. By masking the `navigator.webdriver` property and matching the browser's TLS signature, I successfully accessed the protected API endpoints with a 100% success rate."

### Talking Point: Cookie Bridging Architecture (Cookie 桥接架构)

- **1. The Challenge (挑战/问题):**
    - `1.1.` The detailed transaction data was gated behind a "Member-Only" wall (Tier 2 access), requiring a valid login session.
    - `1.2.` Implementing complex login logic (handling React hydration, modal popups, CAPTCHAs) inside the data fetching microservice would violate the **Single Responsibility Principle** and make the fetcher bloated/fragile.
- **2. The Solution (技术方案 - What & Why):**
    - `2.1.` I implemented a **Cookie Bridging Architecture**. I decoupled "Authentication" from "Data Retrieval".
    - `2.2.` The **Monitor** (Scout) handles the UI-heavy login process and dumps the valid session to a shared `cookies.json` file. The **Fetcher** simply reads this file to inject credentials.
- **3. My Contribution (我的贡献 - How):**
    - `3.1.` I built a robust auto-login script that handles React's dynamic DOM (waiting for network idle states) and saves the session state locally.
    - `3.2.` **Interview Script:** "To handle authentication without coupling it to my data logic, I built a 'Cookie Bridge'. My monitoring service handles the complex login UI and maintains a valid session file. My data service then simply mounts this session to access protected APIs. This separation of concerns made the system incredibly resilient—if the login UI changes, I only fix the Monitor, while the data pipeline remains untouched."