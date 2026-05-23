# Gap Analysis: Predictive Risk Dashboard Tab

> **Date:** 2026-05-23
> **Scope:** `predictive-risk.tsx` + `/api/brain/risk/*` + `/api/brain/swarm/*` > **Status:** 🔴 Critical — runtime crashes and 503 dead-ends

---

## Executive Summary

The Predictive Risk tab has **13 gaps** ranging from runtime data-shape crashes to missing schema migrations and complete unavailability when PostgreSQL is offline. Unlike the Parallel Execution tab (which was recently fixed with lazy-init, Ghost Mode UI, and real-time WebSocket updates), Predictive Risk is effectively non-functional in most environments.

---

## 🔴 Critical Gaps (Runtime Crashes / Complete Failure)

### 1. Response-Shape Mismatch — Assessments, Patterns, Swarm Runs (Runtime Crash)

**Impact:** Frontend crashes with `TypeError: assessments.map is not a function` as soon as any data exists.

| Endpoint                      | API Returns                 | Frontend Expects |
| ----------------------------- | --------------------------- | ---------------- |
| `GET /brain/risk/assessments` | `{ rows: [...], total: N }` | `Array`          |
| `GET /brain/risk/patterns`    | `{ rows: [...], total: N }` | `Array`          |
| `GET /brain/swarm/runs`       | `{ rows: [...], total: N }` | `Array`          |

**Frontend code (`fetchData`):**

```ts
setAssessments(data.data || []) // data.data is {rows, total}, not []
setPatterns(data.data || []) // same
setSwarmRuns(data.data || []) // same
```

**Then rendered:**

```ts
assessments.map(a => ...)         // 💥 crashes — object has no .map()
swarmRuns.length === 0            // undefined === 0 → false, then .map() crashes
```

**Fix:** Either

- **API**: unwrap `rows` before sending (`sendJson(res, 200, { success: true, data: assessments.rows })`)
- **Frontend**: read `data.data.rows || []`

**Recommended:** API should stay consistent and frontend should adapt, since pagination (`total`) may be needed later.

---

### 2. Stats Response-Shape Mismatch (Silent UI Failure)

**Impact:** Stats cards always show `0` or `undefined` even when data exists.

| Frontend expects           | API returns                           |
| -------------------------- | ------------------------------------- |
| `stats.totalAssessments`   | `stats.assessments.total_assessments` |
| `stats.byLevel.high`       | **missing entirely**                  |
| `stats.byLevel.critical`   | **missing entirely**                  |
| `stats.byActionType`       | **missing entirely**                  |
| `stats.totalPatterns`      | `stats.patterns.total_patterns`       |
| `stats.patternsBySeverity` | **missing entirely**                  |
| `stats.patternsByType`     | **missing entirely**                  |

**Frontend:**

```ts
<StatCard label="High/Critical" value={(stats.byLevel?.high || 0) + (stats.byLevel?.critical || 0)} />
```

This always renders `0` because `byLevel` is never returned.

**Fix:** Update `PredictiveFailureEngine.getStats()` to return the shape the frontend expects, **or** update the frontend to read `stats.assessments.total_assessments` etc.

**Recommended:** Update `getStats()` to return:

```js
{
  totalAssessments: assessments.total_assessments,
  byLevel: { critical: assessments.critical_count, high: assessments.high_count, medium: assessments.medium_count, low: assessments.low_count },
  byActionType: {}, // TODO: add GROUP BY action_type query
  totalPatterns: patterns.total_patterns,
  patternsBySeverity: {}, // TODO: add GROUP BY severity query
  patternsByType: {}, // TODO: add GROUP BY pattern_type query
  avgRiskScore: assessments.avg_risk_score,
  maxRiskScore: assessments.max_risk_score,
  totalOccurrences: patterns.total_occurrences,
}
```

---

### 3. Schema Migration Not Applied — Predictive Swarm Tables Missing

**Impact:** Even if PostgreSQL is connected and `applySchema()` succeeds, the risk/swarm tables do **not exist**.

**Root cause:** `applySchema()` in `brain/index.js` only runs `schema.sql` (which is v3/v4). The v5 predictive swarm tables live in `cloud/orchestrator/stores/brain/migrations/004_predictive_swarm.sql`, which is **never executed**.

**Tables missing after `applySchema()`:**

- `brain_failure_patterns`
- `brain_risk_assessments`
- `brain_swarm_runs`

**Fix options:**

1. **Inline into schema.sql** (simplest): Append the three `CREATE TABLE` blocks to `schema.sql`
2. **Run migrations in `applySchema()`**: Make `applySchema()` scan and run all `.sql` files in `migrations/` in order
3. **Lazy table creation**: Wrap `PredictiveFailureEngine` and `SwarmDebugger` queries with `CREATE TABLE IF NOT EXISTS` guards

**Recommended:** Option 1 (append to `schema.sql`) + Option 3 (defensive `CREATE TABLE IF NOT EXISTS` in constructors) for resilience.

---

### 4. Hard PostgreSQL Dependency — Complete Tab Dead-End Without Brain

**Impact:** If PostgreSQL is not running, **every** Predictive Risk endpoint returns 503. The tab shows empty lists with no explanation.

**Root cause:** `requireBrain()` checks `global.__brainServices`, which is only set after a successful PostgreSQL connection. There is no fallback, no graceful degradation, and no lazy-init attempt.

**Contrast with Parallel Execution:**

- Parallel Execution stats endpoint **lazy-inits** the module (`orchestrator.ensureParallelExecutor()`)
- Predictive Risk endpoints **reject** with 503

**Fix:**

1. **Lazy-init attempt on GET endpoints**: Try to `getBrainServices()` on first request instead of failing immediately
2. **Frontend "Brain Offline" state**: Show a clear message with a "Retry Connection" button when all endpoints 503
3. **Local fallback mode** (stretch): Run risk scoring in-memory when pg is unavailable, with a warning banner

**Recommended:** Implement (1) and (2). The Parallel Execution tab's Ghost Mode standby UI is a good pattern to copy.

---

## 🟡 High Gaps (Broken UX / Missing Features)

### 5. No Real-Time Updates (Polling Only)

**Impact:** Users must manually click Refresh to see new assessments or swarm runs.

**Root cause:** No WebSocket integration. The Parallel Execution tab subscribes to `parallel.*` events via `/api/brain/ws` and gets instant updates.

**Fix:**

1. Add `broadcastBrainEvent("risk.assessmentCreated", result)` in `POST /brain/risk/assess`
2. Add `broadcastBrainEvent("swarm.runStarted", {runId})` and `broadcastBrainEvent("swarm.runCompleted", {runId})` in `POST /brain/swarm/debug`
3. Frontend: subscribe to `risk.*` and `swarm.*` events on the existing WebSocket, trigger `fetchData()` on receipt

---

### 6. No Auto-Refresh / Polling

**Impact:** Data goes stale immediately after load.

**Root cause:** `fetchData()` is only called in `useEffect` on mount. No `setInterval`.

**Fix:** Add a `useEffect` with `setInterval(fetchData, 5000)` (mirroring Parallel Execution tab). Clear on unmount.

---

### 7. No Standby / "Brain Offline" Skeleton UI

**Impact:** When brain is 503, the user sees a generic spinner then empty lists. No indication of what's wrong.

**Root cause:** The `loading` state hides everything. Errors are shown but only for network exceptions, not HTTP 503s.

**Fix:** Detect when all initial fetches return 503 and render a dedicated offline state:

```tsx
{
	brainUnavailable && (
		<div className="text-center py-16 space-y-4">
			<ShieldAlert className="w-12 h-12 text-gray-500 mx-auto" />
			<h3 className="text-lg font-medium text-gray-300">Central Brain Offline</h3>
			<p className="text-sm text-gray-500">
				Predictive Risk requires PostgreSQL. Start the brain or check configuration.
			</p>
			<button onClick={fetchData} className="...">
				Retry Connection
			</button>
		</div>
	)
}
```

---

### 8. Swarm Result Shape Mismatch (`runId` vs `id`)

**Impact:** Swarm debug result card shows `ID: undefined`.

**API `debug()` returns:** `{ runId, findings, finalSummary, status }`

**Frontend uses:** `swarmResult.id` (line 514)

**Fix:** API should return `id` in addition to `runId`, or frontend should read `runId`.

---

### 9. `requireBrain` Swallows 503 on Frontend

**Impact:** Frontend never surfaces the 503 error to the user.

**Root cause:** `fetchData()` checks `if (res.ok)` and silently skips non-ok responses:

```ts
if (assessRes.ok) { setAssessments(...) }
// No else branch — 503 is ignored
```

**Fix:** Track per-endpoint errors and show a combined status banner:

```ts
const errors: string[] = []
if (!assessRes.ok) errors.push(`Assessments: ${assessRes.status}`)
// ...
setError(errors.length > 0 ? errors.join("; ") : null)
```

---

## 🟢 Medium Gaps (Polish / Enhancement)

### 10. No WebSocket Event Wiring in Backend

**Impact:** Even if frontend subscribed, no events are emitted.

**Fix:** In `api.js`, after `svc.riskEngine.assess()` and `svc.swarmDebugger.debug()` complete, broadcast events:

```js
broadcastBrainEvent("risk.assessmentCreated", result)
broadcastBrainEvent("swarm.runCompleted", { runId, status: "completed" })
```

---

### 11. Missing `byActionType` / `patternsBySeverity` / `patternsByType` Aggregations

**Impact:** Stats cards could be richer but backend doesn't compute these breakdowns.

**Fix:** Add `GROUP BY` queries to `PredictiveFailureEngine.getStats()`:

```sql
SELECT action_type, COUNT(*) as count FROM brain_risk_assessments GROUP BY action_type
SELECT severity, COUNT(*) as count FROM brain_failure_patterns GROUP BY severity
SELECT pattern_type, COUNT(*) as count FROM brain_failure_patterns GROUP BY pattern_type
```

---

### 12. No Risk Assessment → Swarm Auto-Trigger

**Impact:** The Assess Risk form computes a score but never triggers swarm debug for high/critical risk.

**Design intent:** High/critical assessments should auto-trigger `SwarmDebugger.debug()` and link via `riskAssessmentId`.

**Fix:** In `POST /brain/risk/assess`, after scoring:

```js
if (result.riskLevel === "high" || result.riskLevel === "critical") {
	const swarm = await svc.swarmDebugger.debug({
		riskAssessmentId: result.id,
		problem: `High risk ${body.actionType}: ${result.reasons.join("; ")}`,
		context: { filesChanged: body.filesChanged, logs: body.logs },
	})
	result.swarmRunId = swarm.runId
	// Update assessment with swarm_run_id
}
```

---

### 13. `SwarmDebugger` Missing EventEmitter Integration

**Impact:** Swarm debug runs are opaque — no progress events during the multi-agent execution.

**Fix:** Make `SwarmDebugger` extend `EventEmitter` and emit `agentStarted`, `agentCompleted`, `runCompleted` events, then wire to `broadcastBrainEvent` in `api.js`.

---

## Gap Comparison: Parallel Execution (Fixed) vs Predictive Risk (Broken)

| Feature             | Parallel Execution            | Predictive Risk          |
| ------------------- | ----------------------------- | ------------------------ |
| Lazy-init on GET    | ✅ `ensureParallelExecutor()` | ❌ Strict 503            |
| Standby/Ghost UI    | ✅ Skeleton + start button    | ❌ Generic spinner       |
| Real-time WebSocket | ✅ `parallel.*` events        | ❌ None                  |
| Polling fallback    | ✅ 5s interval                | ❌ Mount only            |
| Response shape      | ✅ Matches frontend           | ❌ **Runtime crash**     |
| Stats aggregation   | ✅ Working                    | ❌ **Always 0**          |
| Backend events      | ✅ EventEmitter               | ❌ Silent                |
| Schema applied      | ✅ In-memory                  | ❌ **Migration not run** |

---

## Recommended Fix Priority

### Phase 1 — Stop the Crashes (must-do)

1. **Fix response shapes** in frontend (`data.data.rows || []`) or API
2. **Fix stats shape** in `PredictiveFailureEngine.getStats()`
3. **Apply v5 schema** — append predictive swarm tables to `schema.sql`

### Phase 2 — Make It Work Without Brain (high value)

4. **Lazy-init brain on GET endpoints** — try `getBrainServices()` before 503
5. **Add "Brain Offline" UI** — detect 503s, show retry button

### Phase 3 — Real-Time & Polish

6. **Add 5s polling** to frontend
7. **Wire WebSocket events** for risk assessments and swarm runs
8. **Add auto-swarm trigger** for high/critical risk
9. **Add missing aggregations** to `getStats()`
10. **Swarm progress events** via EventEmitter

---

## Files to Modify

| File                                                                  | Changes                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `cloud/dashboard/src/components/views/predictive-risk.tsx`            | Fix data shapes, add polling, add WebSocket, add offline UI              |
| `cloud/api/api.js`                                                    | Lazy-init brain on risk/swarm GETs, broadcast events, auto-trigger swarm |
| `cloud/orchestrator/stores/brain/PredictiveFailureEngine.js`          | Fix `getStats()` shape, add aggregations                                 |
| `cloud/orchestrator/stores/brain/SwarmDebugger.js`                    | Add `id` to response, optionally extend EventEmitter                     |
| `cloud/orchestrator/stores/brain/schema.sql`                          | Append v5 predictive swarm tables                                        |
| `cloud/orchestrator/stores/brain/migrations/004_predictive_swarm.sql` | Optionally remove if inlined                                             |
