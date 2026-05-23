# Gap Analysis: Save Points & Deployments Dashboard Tab

> **Date:** 2026-05-23
> **Scope:** `savepoints.tsx` + `/api/telegram/savepoints` + `/api/telegram/deployments` > **Status:** ✅ Fixed — 10 gaps addressed

---

## Executive Summary

The Save Points tab had **10 gaps** ranging from completely broken features (missing API endpoint, crashing method calls) to stagnant mock data and missing real-time updates. The tab was essentially a facade — it looked functional but every create action failed silently, deployments were hardcoded fakes, and the backend had `await` bugs that would crash or return Promises instead of data.

---

## 🔴 Critical Gaps (Fixed)

### 1. Missing `POST /api/savepoints` Endpoint (404 on Create)

**Impact:** The "Create Savepoint" button called `POST /api/savepoints` but this endpoint **did not exist**. Users clicking "Create" got a silent 404 — the savepoint was never stored.

**Fix:** Added `POST /api/savepoints` that validates input, generates an ID, stores in a JSON file (`data/savepoints.json`), broadcasts `savepoint.created` via WebSocket, and returns the created savepoint.

---

### 2. `deployOrchestrator.getCurrent()` Runtime Crash

**Impact:** `GET /orchestrator/deploy-orchestrator/status` called `getCurrent()` which **does not exist** on `DeployOrchestrator`. This would throw `TypeError: orchestrator.deployOrchestrator.getCurrent is not a function`.

**Fix:** Replaced with `await orchestrator.deployOrchestrator.getStats()` and extracted `stats.latestDeployment`.

---

### 3. `await` Missing on Async `getHistory()` and `getStats()`

**Impact:** Two deploy-orchestrator routes returned raw Promises instead of actual data:

- `GET /orchestrator/deploy-orchestrator/history` → returned `Promise` (not array)
- `GET /orchestrator/deploy-orchestrator/stats` → returned `Promise` (not object)

**Fix:** Added `await` to both calls.

---

### 4. Hardcoded Mock Data for Deployments

**Impact:** `/telegram/deployments` returned 3 static objects with fake timestamps. No connection to actual deployment history.

**Fix:** Wired to `orchestrator.deployOrchestrator.getHistory({ limit: 50 })` with a `transformDeployment()` helper that maps real DB rows to frontend shape including `ago` calculation.

---

### 5. Hardcoded Mock Data for Savepoints

**Impact:** `/telegram/savepoints` returned 3 static objects. The create form was broken (no endpoint), so savepoints were never real.

**Fix:** Replaced with in-memory JSON file storage. `GET` reads from `savepointsData.savepoints`. `POST` appends and persists.

---

## 🟡 High Gaps (Fixed)

### 6. No Real-Time Updates

**Impact:** No WebSocket integration. Users had to wait 30s for polling to see new deployments.

**Fix:**

- Wrapped `deployOrchestrator.deploy()` and `rollback()` to broadcast `deploy.completed` / `deploy.rollback` events
- Frontend subscribes to `deploy.*` and `savepoint.*` WebSocket events
- Triggers instant `fetchData()` on any deployment/savepoint event

---

### 7. Slow Polling (30s)

**Impact:** Data refresh every 30 seconds — much slower than other tabs (5s).

**Fix:** Reduced to 5s interval for consistency with Events and Predictive Risk tabs.

---

### 8. No Deployment Action Buttons

**Impact:** Deployments were read-only. Users couldn't trigger rollback from the UI.

**Fix:** Added "Rollback" button on each deployment card that calls `POST /api/deploy/cancel` with the deployment ID.

---

### 9. No `ago` Calculation

**Impact:** Mock data had hardcoded strings like `"1h"`, `"3h"`. Real data has timestamps.

**Fix:** Added `formatAgo(ms)` helper in `api.js` that calculates relative time (`Xs`, `Xm`, `Xh`, `Xd`).

---

### 10. Missing Live/Offline Badge

**Impact:** No indication of WebSocket connectivity.

**Fix:** Added "Live"/"Offline" badge in the header, consistent with Events and Predictive Risk tabs.

---

## Files Modified

| File                                                  | Changes                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud/api/api.js`                                    | Fixed `getCurrent()` crash, added `await` to async deploy methods, added `POST /api/savepoints`, wired `/telegram/deployments` to real `getHistory()`, added `transformDeployment()` + `formatAgo()`, added deployment WebSocket broadcasting, added savepoints JSON persistence |
| `cloud/orchestrator/CloudOrchestrator.js`             | Wrapped `eventLog.record` to emit `eventRecorded` events                                                                                                                                                                                                                         |
| `cloud/dashboard/src/components/views/savepoints.tsx` | Full rewrite with WebSocket, 5s polling, rollback buttons, live badge, real data shapes                                                                                                                                                                                          |
