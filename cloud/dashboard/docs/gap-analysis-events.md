# Gap Analysis: Events Dashboard Tab

> **Date:** 2026-05-23
> **Scope:** `events.tsx` + `/api/orchestrator/events` > **Status:** ✅ Fixed — 6 gaps addressed

---

## Executive Summary

The Events tab had **6 gaps** ranging from silent data-shape mismatches (missing `message`, broken `timestamp`, incorrect severity mapping) to missing real-time updates and a broken severity filter. Unlike the Predictive Risk tab which crashed visibly, the Events tab failed silently — events loaded but showed empty messages, invalid dates, and incorrect filter behavior.

---

## 🔴 Critical Gaps (Fixed)

### 1. Missing `message` Field (Silent UI Failure)

**Impact:** Every event row showed an empty/undefined message.

**Root cause:** The `events` DB table stores `type`, `source`, `payload` but no `message` column. The frontend `EventEntry` interface expected `message: string` and rendered it as the primary event text. `EventLog._rowToEvent()` returned `type`, `source`, `payload`, `severity`, `createdAt` — but no `message`.

**Fix:** `_rowToEvent()` now derives `message` from `payload.message || row.type || row.source || "Event"`.

---

### 2. `timestamp` Field Missing / `createdAt` Mismatch (Invalid Dates)

**Impact:** All event timestamps showed "Invalid Date" because `new Date(undefined)` was called.

**Root cause:** Backend returned `createdAt` (number, ms since epoch). Frontend expected `timestamp` (ISO string) and called `new Date(event.timestamp).toLocaleTimeString()`.

**Fix:** `_rowToEvent()` now returns both:

- `timestamp: new Date(row.created_at).toISOString()` — for frontend compatibility
- `createdAt: row.created_at` — for backend consumers like `buildQueueActivity`

---

### 3. Severity Filter Completely Broken ("warn" / "debug" Never Matched)

**Impact:** Clicking "warn" or "debug" severity filters always returned 0 results.

**Root cause:**

- Frontend severity options: `["all", "info", "debug", "warn", "error"]`
- DB severity values: `["info", "warning", "error", "critical"]`
- The API passed frontend values directly to SQL `WHERE severity = ?`
- `"warn"` ≠ `"warning"`, `"debug"` doesn't exist in DB

**Fix:**

- API route maps frontend severity → DB severity before querying (`"warn"` → `"warning"`, `"debug"` → `"info"`)
- `_rowToEvent()` maps DB severity → frontend severity (`"warning"` → `"warn"`, `"critical"` → `"error"`)

---

## 🟡 High Gaps (Fixed)

### 4. No Real-Time Updates

**Impact:** Users had to manually click Refresh or wait for auto-refresh to see new events.

**Root cause:** No WebSocket integration. Other tabs (Parallel Execution, Predictive Risk) subscribe to WebSocket events and get instant updates.

**Fix:**

- `CloudOrchestrator` now wraps `eventLog.record()` to emit `"eventRecorded"` events
- `api.js` listens for `"eventRecorded"` and broadcasts `broadcastBrainEvent("orchestrator.event", event)`
- Frontend subscribes to `orchestrator.*` WebSocket events and triggers instant `fetchData()`

---

### 5. Auto-Refresh Off by Default

**Impact:** Data was stale unless users manually enabled auto-refresh.

**Root cause:** `autoRefresh` state initialized to `false`. Users had to discover and check the checkbox.

**Fix:** `autoRefresh` now defaults to `true`. Polling interval reduced from 10s to 5s for consistency with other tabs.

---

### 6. `buildQueueActivity` Used Nonexistent `event.timestamp`

**Impact:** The overview/dashboard activity feed showed orchestrator events with `time: 0` (epoch), causing incorrect sort ordering.

**Root cause:** `buildQueueActivity()` in `api.js` used `event.timestamp || 0`, but `_rowToEvent()` returned `createdAt` (not `timestamp`).

**Fix:** `buildQueueActivity()` now uses `event.createdAt || 0` and `event.message || event.type`.

---

## Gap Comparison: Before vs After

| Feature            | Before                        | After                               |
| ------------------ | ----------------------------- | ----------------------------------- |
| Event message      | ❌ Empty/undefined            | ✅ Derived from payload/type/source |
| Event timestamp    | ❌ "Invalid Date"             | ✅ ISO string + kept `createdAt`    |
| Severity filter    | ❌ "warn"/"debug" never match | ✅ Mapped both directions           |
| Real-time updates  | ❌ None                       | ✅ WebSocket `orchestrator.event`   |
| Auto-refresh       | ❌ Off by default (10s)       | ✅ On by default (5s)               |
| Activity feed time | ❌ Always `0`                 | ✅ Uses `createdAt`                 |
| Live indicator     | ❌ None                       | ✅ "Live"/"Offline" badge           |

---

## Files Modified

| File                                              | Changes                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `cloud/orchestrator/modules/EventLog.js`          | `_rowToEvent()` adds `message`, `timestamp`, maps severity                                              |
| `cloud/api/api.js`                                | Severity mapping in `/orchestrator/events`, fixed `buildQueueActivity`, broadcasts `orchestrator.event` |
| `cloud/orchestrator/CloudOrchestrator.js`         | Wraps `eventLog.record` to emit `eventRecorded` events                                                  |
| `cloud/dashboard/src/components/views/events.tsx` | WebSocket integration, auto-refresh on by default, live badge, 5s polling                               |
