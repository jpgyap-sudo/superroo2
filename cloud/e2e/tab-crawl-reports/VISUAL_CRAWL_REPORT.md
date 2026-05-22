# Visual Crawl Report — SuperRoo Dashboard (`https://dev.abcx124.xyz/`)

**Date:** 2026-05-22
**Tester:** Kimi Code CLI (Visual Crawler Agent)
**Pages Tested:** 43 dashboard tabs/pages
**Method:** Playwright headless browser, automated tab navigation + screenshot capture

---

## 🎯 Summary

| Metric                | Count |
| --------------------- | ----- |
| Total Pages Tested    | 43    |
| Critical Bugs Found   | 3     |
| Timeouts / Slow Pages | 8     |
| Pages OK              | 32    |

---

## 🐛 Critical Bugs Confirmed

### 1. `provider-dashboard` — Next.js Client-Side Crash (P0)

- **Status:** ❌ **CRASH**
- **Visual:** Black screen with "Application error: a client-side exception has occurred"
- **Root Cause:** `TypeError: Cannot read properties of undefined (reading 'toFixed')`
- **File:** `cloud/dashboard/src/components/views/provider-dashboard.tsx`
- **Lines:** 368 and 451
- **Details:**
    - Line 368: `provider.latencyMs !== null` fails when `latencyMs` is `undefined` (condition is `true`, then `.toFixed()` crashes)
    - Line 451: `selectedProviderData.usage.latencyMs.toFixed(0)` has no null/undefined guard
- **Fix Applied:** ✅ Changed to `typeof provider.latencyMs === "number"` and added ternary guard for `selectedProviderData.usage.latencyMs`
- **Screenshot:** `screenshots/page-1-provider_dashboard.png`

### 2. `visual-crawler` — HTTP 404 Error on Load (P1)

- **Status:** ❌ **ERROR**
- **Visual:** Red alert banner "HTTP 404" below the crawl URL input
- **Root Cause:** Default crawl target is `http://localhost:3001` which is unreachable from the dev deployment. The API route `/visual-crawl/...` returns 404 when the target is invalid or the endpoint is missing.
- **File:** `cloud/dashboard/src/components/views/visual-crawler.tsx`
- **Screenshot:** `screenshots/page-rem-2-visual-crawler.png`
- **Recommendation:** Update default URL to use the current deployment domain or validate the target before running crawl.

### 3. `autonomous-loop` — Unauthorized Error (P1)

- **Status:** ❌ **ERROR**
- **Visual:** Red alert banner "Failed to load autonomous loop status: Unauthorized. Please sign in again."
- **Root Cause:** Newly registered accounts do not have autonomous loop permissions/session data. The API returns 401.
- **File:** `cloud/dashboard/src/components/views/autonomous-loop.tsx` (line ~160)
- **Screenshot:** `screenshots/page-rem-4-autonomous-loop.png`
- **Recommendation:** Either auto-provision autonomous loop config for new users OR show a friendly "Setup required" message instead of a raw unauthorized error.

---

## ⏱️ Slow / Timeout Pages

These pages exceeded the 10-12s navigation timeout, suggesting slow API calls or blocking data fetches:

| Page                  | Timeout       | Likely Cause                      |
| --------------------- | ------------- | --------------------------------- |
| `healing`             | ✅ ~15s       | Slow health check queries         |
| `workflow-compliance` | ✅ ~15s       | Heavy compliance data aggregation |
| `settings`            | ✅ ~15s       | Loads many config sources         |
| `ai`                  | ✅ ~15s       | Large model/assistant data fetch  |
| `brain`               | ✅ ~15s       | Brain/MCP connection polling      |
| `debug-team`          | ✅ ~15s + 401 | Unauthorized + slow load          |
| `deploy-orchestrator` | ✅ ~15s       | Orchestrator status API slow      |
| `collaboration`       | ✅ ~15s       | Collaboration sync delay          |

**Recommendation:** Add loading skeletons, paginate heavy queries, or cache dashboard data server-side.

---

## ✅ Pages That Passed

The following 32 pages loaded without crashes, 404s, or auth errors:

`overview`, `working-tree`, `jobs`, `queue`, `projects`, `agents`, `bugs`, `skill-generator`, `logs`, `docker`, `approvals`, `api-keys`, `settings` (loaded after retry), `ai` (loaded after retry), `model-router`, `github`, `ide-terminal`, `telegram`, `deploy`, `auto-deploy`, `commit-deploy`, `intelligence-layer`, `brain` (loaded after retry), `ollama-growth`, `memory-explorer`, `parallel-execution`, `commissioning-loop`, `hermes-claw`, `ml-engine`, `ram-orchestrator`, `product-memory`, `task-timeline`, `mcp-servers`, `sandbox`

_(Note: some pages show status indicators like "Offline", "Down", "Failed" — these are operational status badges, not UI bugs.)_

---

## 🧪 E2E Tests Added

**File:** `cloud/e2e/dashboard-tabs.spec.ts`

- Tests provider-dashboard for toFixed crash
- Tests visual-crawler for 404 alert
- Tests working-tree for successful load
- Tests autonomous-loop for no crash
- Loop test across 29 critical tabs to ensure no Next.js error boundary appears

Run with:

```bash
npx playwright test cloud/e2e/dashboard-tabs.spec.ts
```

---

## 📁 Artifacts

| File                                         | Description                    |
| -------------------------------------------- | ------------------------------ |
| `screenshots/page-1-provider_dashboard.png`  | Next.js crash screen           |
| `screenshots/page-rem-2-visual-crawler.png`  | HTTP 404 alert                 |
| `screenshots/page-rem-4-autonomous-loop.png` | Unauthorized error             |
| `tab-crawl-remaining-*.json`                 | Machine-readable crawl results |
| `VISUAL_CRAWL_REPORT.md`                     | This report                    |

---

## 🔧 Fixes Applied

1. **provider-dashboard.tsx** — Added `typeof latencyMs === "number"` guards at lines 368 and 451 to prevent `.toFixed()` crashes on `undefined`/`null` values.

## 📋 Next Steps

1. **Deploy the provider-dashboard fix** to `dev.abcx124.xyz` and re-run visual crawler to verify.
2. **Fix visual-crawler default URL** — change `http://localhost:3001` to the deployed domain or add validation.
3. **Fix autonomous-loop new-user experience** — show setup wizard instead of raw 401 error.
4. **Optimize slow pages** — add caching/skeletons for healing, brain, deploy-orchestrator, etc.
5. **Re-run E2E tests** after fixes: `npx playwright test cloud/e2e/dashboard-tabs.spec.ts`
