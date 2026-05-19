# SuperRoo Healing Module — Usage Guide

> **Module**: [`src/super-roo/healing/`](src/super-roo/healing/)  
> **Types**: [`src/super-roo/types/index.ts`](src/super-roo/types/index.ts) (lines 244–330)  
> **Infrastructure**: [`src/super-roo/infrastructure/LogAggregator.ts`](src/super-roo/infrastructure/LogAggregator.ts)

The Healing Module is SuperRoo's autonomous self-healing system. It detects incidents, classifies root causes, generates repair plans, and executes fixes — all without human intervention (unless the policy requires approval).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How to Report an Incident](#how-to-report-an-incident)
3. [Root Cause Classification](#root-cause-classification)
4. [Repair Plans](#repair-plans)
5. [The Self-Healing Loop](#the-self-healing-loop)
6. [Healing Metrics](#healing-metrics)
7. [Escalation Policies & Circuit Breaker](#escalation-policies--circuit-breaker)
8. [Example: Healing a Broken API Route](#example-healing-a-broken-api-route)
9. [Example: Handling Deployment Drift](#example-handling-deployment-drift)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SelfHealingLoop                                    │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────┐           │
│  │ Monitor  │──▶│  Classify    │──▶│  Repair Plan  │──▶│ Execute│           │
│  │ (polling)│   │ (ML+keyword) │   │  Builder      │   │ (agent)│           │
│  └──────────┘   └──────────────┘   └───────────────┘   └────────┘           │
│       │                                                                    │
│       ▼                                                                    │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐   ┌─────────────┐  │
│  │HealingBus│──▶│RootCause     │──▶│HealingMetrics     │──▶│RepairTracker│  │
│  │(incidents)│  │Classifier    │   │(trends, confusion)│   │(attempts)   │  │
│  └──────────┘   └──────────────┘   └──────────────────┘   └─────────────┘  │
│       │                                                                    │
│       ▼                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Escalation Policy & Circuit Breaker                                 │   │
│  │  (per-category thresholds, notification routing, circuit breaker)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component                                                             | File                     | Role                                                        |
| --------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| [`HealingBus`](src/super-roo/healing/HealingBus.ts)                   | `HealingBus.ts`          | Central incident registry — report, query, update incidents |
| [`RootCauseClassifier`](src/super-roo/healing/RootCauseClassifier.ts) | `RootCauseClassifier.ts` | Keyword + ML-based classification (21 categories)           |
| [`RepairPlanBuilder`](src/super-roo/healing/RepairPlanBuilder.ts)     | `RepairPlanBuilder.ts`   | Generates structured repair plans with diagnostic steps     |
| [`SelfHealingLoop`](src/super-roo/healing/SelfHealingLoop.ts)         | `SelfHealingLoop.ts`     | Autonomous polling loop with escalation and circuit breaker |
| [`SelfHealingAgent`](src/super-roo/agents/SelfHealingAgent.ts)        | `SelfHealingAgent.ts`    | Agent-based healing interface (report, classify, repair)    |
| [`HealingMetrics`](src/super-roo/healing/HealingMetrics.ts)           | `HealingMetrics.ts`      | Tracks success/failure rates, trends, confusion matrix      |

### Incident State Machine

```
new ──→ investigating ──→ queued_for_fix ──→ fixing ──→ fix_ready
                                                              │
                                                              ▼
                                                         deployed ──→ verifying ──→ verified
                                                                        │
                                                                        ▼
                                                                   reopened (back to new)
```

Failure branches:

- `fixing` → `blocked`
- `queued_for_fix` → `needs_human_approval`
- `verifying` → `reopened`

---

## How to Report an Incident

Any agent or service can report an incident through the [`HealingBus`](src/super-roo/healing/HealingBus.ts).

### Basic Usage

```typescript
import { HealingBus } from "../healing"
import { MemoryStore } from "../memory/MemoryStore"
import { EventLog } from "../logging/EventLog"

const bus = new HealingBus(memory, events, {
	autoFixEnabled: true,
	autoFixPolicies: {
		low: true,
		medium: false,
		high: false,
		critical: false,
	},
})

const incident = await bus.reportIncident({
	title: "API /users endpoint returning 500",
	symptom: "GET /users returns HTTP 500 with 'Cannot read property of undefined'",
	severity: "high",
	sourceAgent: "tester",
	featureKey: "user-management",
	affectedFiles: ["src/routes/users.ts", "src/services/userService.ts"],
	evidence: {
		stackTrace: "TypeError: Cannot read properties of undefined...",
		statusCode: 500,
		requestMethod: "GET",
		requestPath: "/users",
	},
})
```

### Incident Input Fields

| Field           | Type          | Required | Description                                                             |
| --------------- | ------------- | -------- | ----------------------------------------------------------------------- |
| `title`         | `string`      | Yes      | Short description (max 500 chars)                                       |
| `symptom`       | `string`      | Yes      | Detailed symptom description (max 2000 chars)                           |
| `severity`      | `BugSeverity` | No       | `"low"` \| `"medium"` \| `"high"` \| `"critical"` (default: `"medium"`) |
| `sourceAgent`   | `string`      | No       | Which agent detected the issue                                          |
| `featureKey`    | `string`      | No       | Related feature identifier                                              |
| `affectedFiles` | `string[]`    | No       | Files involved (max 100)                                                |
| `evidence`      | `object`      | No       | Arbitrary JSON-serializable evidence                                    |
| `fingerprint`   | `string`      | No       | Deduplication key (auto-generated if omitted)                           |

### Querying Incidents

```typescript
// Get all open incidents
const open = await bus.getIncidents({ status: "new" })

// Filter by severity and feature
const critical = await bus.getIncidents({
	severity: "critical",
	featureKey: "user-management",
})

// Get incident by ID
const incident = await bus.getIncident("inc_abc123")

// Update incident status
await bus.updateIncidentStatus("inc_abc123", "investigating")
```

### Deduplication

Incidents are deduplicated using a SHA-256 fingerprint. The fingerprint is computed from `featureKey`, `sourceAgent`, `title`, and `symptom`. If the same incident is reported twice, the existing record is updated instead of creating a duplicate.

```typescript
// Manual fingerprint generation
import { makeIncidentFingerprint } from "../healing"

const fp = makeIncidentFingerprint({
	featureKey: "user-management",
	sourceAgent: "tester",
	title: "API /users endpoint returning 500",
	symptom: "GET /users returns HTTP 500...",
})
```

---

## Root Cause Classification

The [`RootCauseClassifier`](src/super-roo/healing/RootCauseClassifier.ts) uses keyword matching against incident title, symptom, and evidence to determine the root cause category. It also supports ML-based classification via the [`SelfHealingAgent`](src/super-roo/agents/SelfHealingAgent.ts) which can leverage the ML engine for higher-confidence predictions.

### 21 Root Cause Categories

| Category                 | Keywords                                                 | Auto-Fix?            |
| ------------------------ | -------------------------------------------------------- | -------------------- |
| `ENV_MISSING`            | `env`, `process.env`, `missing env`, `config not found`  | ✅                   |
| `DB_SCHEMA_MISMATCH`     | `schema`, `column`, `relation`, `migration`, `sql error` | ✅                   |
| `API_AUTH_FAILURE`       | `401`, `unauthorized`, `token expired`                   | ✅                   |
| `API_RATE_LIMIT`         | `429`, `rate limit`, `too many requests`                 | ✅                   |
| `BROKEN_ROUTE`           | `404`, `route`, `endpoint`, `not found`                  | ✅                   |
| `FRONTEND_CORS`          | `cors`, `cross-origin`, `access-control`                 | ✅                   |
| `WORKER_CRASH`           | `pm2`, `crash`, `uncaught exception`                     | ✅                   |
| `STALE_DATA`             | `stale`, `cache`, `outdated`, `sync`                     | ✅                   |
| `TRADING_GATE_BLOCKED`   | `trading gate`, `risk limit`                             | ❌ Requires approval |
| `DEPLOY_DRIFT`           | `deploy`, `version mismatch`, `vps`                      | ❌ Requires approval |
| `TEST_FAILURE`           | `test`, `assert`, `vitest`, `jest`                       | ✅                   |
| `SECURITY_RISK`          | `secret`, `leak`, `credential`, `exposed`                | ❌ Requires approval |
| `MEMORY_LEAK`            | `memory leak`, `out of memory`, `heap`                   | ✅                   |
| `RACE_CONDITION`         | `race condition`, `deadlock`, `mutex`                    | ✅                   |
| `CONFIGURATION_ERROR`    | `config error`, `misconfiguration`                       | ✅                   |
| `DEPENDENCY_CONFLICT`    | `dependency conflict`, `module not found`                | ✅                   |
| `AUTHENTICATION_FAILURE` | `auth failed`, `forbidden`, `403`                        | ✅                   |
| `NETWORK_TIMEOUT`        | `timeout`, `ETIMEDOUT`, `ECONNRESET`                     | ✅                   |
| `FILE_SYSTEM_ERROR`      | `ENOENT`, `EACCES`, `disk full`                          | ✅                   |
| `DNS_RESOLUTION`         | `dns`, `ENOTFOUND`, `getaddrinfo`                        | ✅                   |
| `SSL_TLS_ERROR`          | `ssl`, `certificate`, `handshake failed`                 | ❌ Requires approval |
| `UNKNOWN`                | (fallback)                                               | ✅                   |

### How Classification Works

```typescript
import { classifyRootCause, classifyFromText } from "../healing"

// Classify an existing incident
const result = classifyRootCause(incident)
// { category: "BROKEN_ROUTE", confidence: 0.85, reasoning: "Matched keywords: 404, route" }

// Classify from raw text
const result2 = classifyFromText("API returns 404 for /api/users", "UNKNOWN")
// { category: "BROKEN_ROUTE", confidence: 0.85, ... }

// Check if a category requires human approval
import { requiresHumanApproval, isSecurityRisk } from "../healing"
requiresHumanApproval("SECURITY_RISK") // true
isSecurityRisk("SECURITY_RISK") // true
```

---

## Repair Plans

The [`RepairPlanBuilder`](src/super-roo/healing/RepairPlanBuilder.ts) generates structured repair plans from classified incidents.

### Building a Plan

```typescript
import { buildRepairPlan, markPlanExecuted, markPlanInProgress } from "../healing"

const plan = buildRepairPlan(incident, {
	// Optional overrides
	rootCauseCategory: "BROKEN_ROUTE",
	context: { additionalInfo: "..." },
	forceApproval: false,
})

// Plan structure:
// {
//   incidentId: "inc_abc123",
//   featureKey: "user-management",
//   severity: "high",
//   rootCauseCategory: "BROKEN_ROUTE",
//   affectedFiles: ["src/routes/users.ts", "src/services/userService.ts"],
//   diagnosticSteps: ["Check server route discovery logic", ...],
//   safePatchPlan: ["Inspect files...", "Reproduce...", "Apply smallest safe patch", ...],
//   testsToRun: ["Test the route with curl", ...],
//   approvalRequired: false,
//   executionStatus: "pending",
// }

// Mark as in progress
markPlanInProgress(plan)

// Execute... then mark result
markPlanExecuted(plan, {
	success: true,
	message: "Fixed missing route handler",
	details: { patchFile: "src/routes/users.ts" },
})
```

### Plan Structure

| Field               | Type                | Description                                                                    |
| ------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `incidentId`        | `string`            | Linked incident                                                                |
| `featureKey`        | `string`            | Affected feature                                                               |
| `severity`          | `BugSeverity`       | Severity level                                                                 |
| `rootCauseCategory` | `RootCauseCategory` | Classified category                                                            |
| `affectedFiles`     | `string[]`          | Files to inspect/modify                                                        |
| `diagnosticSteps`   | `string[]`          | Steps to confirm root cause                                                    |
| `safePatchPlan`     | `string[]`          | Safe patch recommendations                                                     |
| `testsToRun`        | `string[]`          | Tests to verify the fix                                                        |
| `approvalRequired`  | `boolean`           | Whether human approval is needed                                               |
| `approvalReason`    | `string`            | Why approval is required                                                       |
| `executionStatus`   | `string`            | `"pending"` \| `"in_progress"` \| `"completed"` \| `"failed"` \| `"cancelled"` |

---

### ML-Based Classification

The [`SelfHealingAgent`](src/super-roo/agents/SelfHealingAgent.ts) provides an ML-enhanced classification path:

```typescript
import { SelfHealingAgent } from "../agents/SelfHealingAgent"

// The agent's "classify" operation uses ML to classify root causes
// with confidence scoring, falling back to keyword matching
const result = await agent.run({
	type: "classify",
	payload: {
		title: "API /users endpoint returning 500",
		symptom: "GET /users returns HTTP 500 with 'Cannot read property of undefined'",
		evidence: { stackTrace: "TypeError: Cannot read properties of undefined..." },
	},
})
// { category: "BROKEN_ROUTE", confidence: 0.92, ... }
```

### Repair Tracking

The [`RepairPlanBuilder`](src/super-roo/healing/RepairPlanBuilder.ts) now tracks repair execution state through the full lifecycle:

```typescript
import { buildRepairPlan, markPlanInProgress, markPlanExecuted, markPlanCancelled } from "../healing"

const plan = buildRepairPlan(incident)

// Track lifecycle
markPlanInProgress(plan) // Status → "in_progress"
markPlanExecuted(plan, {
	// Status → "completed" or "failed"
	success: true,
	message: "Fix applied",
	details: { patchFile: "src/routes/users.ts" },
})
markPlanCancelled(plan) // Status → "cancelled"
```

---

## The Self-Healing Loop

The [`SelfHealingLoop`](src/super-roo/healing/SelfHealingLoop.ts) is the autonomous engine that continuously monitors for new incidents and processes them.

### Starting the Loop

```typescript
import { SelfHealingLoop } from "../healing"
import { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"

const loop = new SelfHealingLoop(orchestrator, {
	cycleIntervalMs: 30000, // Poll every 30 seconds
	maxPerCycle: 10, // Max incidents per cycle
	autoFixPolicies: {
		low: true, // Auto-fix low severity
		medium: false, // Suggest only for medium
		high: false, // Suggest only for high
		critical: false, // Suggest only for critical
	},
	suggestionOnly: false, // false = auto-fix enabled
	maxRetries: 3, // Max retries for reopened incidents
	circuitBreakerThreshold: 5, // Open circuit after 5 consecutive failures
	circuitBreakerTimeoutMs: 300000, // Wait 5 minutes before retrying
	maxBackoffMs: 300000, // Max backoff on errors
	cleanupIntervalCycles: 10, // Cleanup old actions every 10 cycles
	escalationPolicy: {
		maxRetries: 3,
		escalationAction: "warn", // "warn" | "notify" | "block" | "circuit_breaker"
		skipAutoRepair: true,
	},
})

// Start the loop
loop.start()

// Check stats
const stats = loop.getStats()
// {
//   cyclesCompleted: 42,
//   incidentsProcessed: 156,
//   incidentsAutoFixed: 89,
//   incidentsVerified: 72,
//   circuitBreakerOpen: false,
//   consecutiveFailures: 0,
//   ...
// }

// Stop the loop
await loop.stop()
```

### Manual Trigger

```typescript
// Manually process all pending incidents
await loop.processPendingIncidents()
```

### SelfHealingAgent (Agent-Based Healing)

The [`SelfHealingAgent`](src/super-roo/agents/SelfHealingAgent.ts) provides an alternative agent-based interface to the healing module. It wraps the [`HealingBus`](src/super-roo/healing/HealingBus.ts) and [`RootCauseClassifier`](src/super-roo/healing/RootCauseClassifier.ts) into a standard agent interface compatible with the orchestrator's agent routing system.

```typescript
import { SelfHealingAgent } from "../agents/SelfHealingAgent"

const agent = new SelfHealingAgent({
	healingBus: bus,
	classifier: classifier,
	metrics: metrics,
})

// Report an incident via the agent
const result = await agent.run(ctx, {
	type: "reportIncident",
	payload: {
		title: "API /users returning 500",
		symptom: "GET /users returns HTTP 500",
		severity: "high",
		featureKey: "user-management",
		affectedFiles: ["src/routes/users.ts"],
	},
})

// Run a full healing cycle
const cycleResult = await agent.run(ctx, {
	type: "runCycle",
	payload: {},
})

// Classify an incident using ML + keyword hybrid
const classifyResult = await agent.run(ctx, {
	type: "classify",
	payload: {
		title: "Database connection timeout",
		symptom: "ETIMEDOUT on postgres connection",
		evidence: { errorCode: "ETIMEDOUT" },
	},
})

// List all open incidents
const listResult = await agent.run(ctx, {
	type: "listIncidents",
	payload: { status: "new" },
})

// Get healing system status
const statusResult = await agent.run(ctx, {
	type: "getStatus",
	payload: {},
})
```

Supported operations:

| Operation         | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `reportIncident`  | Report a new incident to the healing bus                    |
| `runCycle`        | Execute one full healing cycle (process all open incidents) |
| `approveFix`      | Approve a pending fix for an incident                       |
| `rejectFix`       | Reject a pending fix for an incident                        |
| `listIncidents`   | List incidents with optional status filter                  |
| `getStatus`       | Get healing system status and metrics                       |
| `classify`        | Classify an incident's root cause using ML + keywords       |
| `buildRepairPlan` | Generate a structured repair plan for an incident           |

---

## Healing Metrics

The [`HealingMetrics`](src/super-roo/healing/HealingMetrics.ts) class tracks success/failure rates per category and persists to JSON. Phase 2 adds trend analysis, precision/recall per category, and confusion matrix tracking.

### Recording Outcomes

```typescript
import { HealingMetrics } from "../healing"

const metrics = new HealingMetrics({
	persistPath: "./memory/healing-metrics.json",
	autoPersist: true,
	trendWindowSize: 50, // Rolling window for trend analysis (default: 50)
})

// Record outcome after a healing attempt
metrics.recordOutcome(
	"inc_abc123",
	"BROKEN_ROUTE",
	true, // success
	plan, // the RepairPlan
)
```

### Querying Metrics

```typescript
// Success rate for a specific category
const rate = metrics.getSuccessRate("BROKEN_ROUTE") // 0.85

// Overall success rate
const overall = metrics.getOverallSuccessRate() // 0.78

// Category-specific metrics
const catMetrics = metrics.getCategoryMetrics("BROKEN_ROUTE")
// { successCount: 17, failureCount: 3, totalAttempts: 20 }

// All categories
const allCats = metrics.getAllCategoryMetrics()

// Plan type metrics
const planMetrics = metrics.getAllPlanTypeMetrics()

// Totals
metrics.getTotalAttempts() // 156
metrics.getTotalSuccesses() // 122
metrics.getTotalFailures() // 34
```

### Trend Analysis (Phase 2)

Rolling window trend tracking for recent outcomes, enabling detection of improving or degrading healing performance.

```typescript
// Trend success rate for a specific category (last N outcomes)
const trendRate = metrics.getTrendSuccessRate("BROKEN_ROUTE", 20)
// Returns 0-1 based on the last 20 outcomes for BROKEN_ROUTE

// Overall trend rate across all categories
const overallTrend = metrics.getOverallTrendRate(50)
// Returns 0-1 based on the last 50 outcomes

// Check if a category's trend is improving
const improving = metrics.isTrendImproving("BROKEN_ROUTE")
// Returns true if trend rate > overall rate for that category
// Returns null if insufficient data
```

### Precision, Recall & Confusion Matrix (Phase 2)

ML classifier evaluation metrics for tracking classification accuracy.

```typescript
// Record a classification result (predicted vs actual)
metrics.recordClassification("BROKEN_ROUTE", "BROKEN_ROUTE") // Correct
metrics.recordClassification("BROKEN_ROUTE", "CONFIGURATION_ERROR") // Wrong

// Get precision and recall for a specific category
const pr = metrics.getPrecisionRecall("BROKEN_ROUTE")
// {
//   truePositives: 15,      // Correctly predicted as BROKEN_ROUTE
//   falsePositives: 3,      // Predicted BROKEN_ROUTE but was something else
//   falseNegatives: 2,      // Was BROKEN_ROUTE but predicted something else
//   precision: 0.833,       // TP / (TP + FP)
//   recall: 0.882,          // TP / (TP + FN)
//   f1Score: 0.857,         // 2 * (P * R) / (P + R)
// }

// Get the full confusion matrix
const matrix = metrics.getConfusionMatrix()
// {
//   "BROKEN_ROUTE": { "BROKEN_ROUTE": 15, "CONFIGURATION_ERROR": 3 },
//   "ENV_MISSING":  { "ENV_MISSING": 10, "BROKEN_ROUTE": 2 },
// }

// Get recent outcome history for custom analysis
const history = metrics.getOutcomeHistory()
// [{ incidentId, category, success, timestamp }, ...]
```

### Detailed Healing Metrics

The [`HealingBus`](src/super-roo/healing/HealingBus.ts) provides a detailed metrics endpoint that includes per-category breakdowns, plan type metrics, and overall statistics:

```typescript
const detailed = bus.getDetailedHealingMetrics()
// {
//   byCategory: {
//     "BROKEN_ROUTE": { successCount: 17, failureCount: 3, totalAttempts: 20 },
//     "ENV_MISSING": { successCount: 12, failureCount: 1, totalAttempts: 13 },
//   },
//   byPlanType: {
//     "patch": { successCount: 25, failureCount: 5, totalAttempts: 30 },
//     "config_change": { successCount: 8, failureCount: 2, totalAttempts: 10 },
//   },
//   overall: { successCount: 122, failureCount: 34, totalAttempts: 156 },
//   lastUpdated: 1712345678901,
// }
```

### Persisted Format

Metrics are persisted to `memory/healing-metrics.json`:

```json
{
  "byCategory": {
    "BROKEN_ROUTE": { "successCount": 17, "failureCount": 3, "totalAttempts": 20 },
    "ENV_MISSING": { "successCount": 12, "failureCount": 1, "totalAttempts": 13 }
  },
  "byPlanType": { ... },
  "overall": { "successCount": 122, "failureCount": 34, "totalAttempts": 156 },
  "lastUpdated": 1712345678901
}
```

---

## Escalation Policies & Circuit Breaker

### Escalation Policy

When an incident is reopened repeatedly (same signature), the escalation policy kicks in:

```typescript
interface EscalationPolicy {
	maxRetries: number // Default: 3
	escalationAction: EscalationAction // "warn" | "notify" | "block" | "circuit_breaker"
	skipAutoRepair: boolean // Default: true
	/**
	 * Per-category escalation threshold overrides.
	 * Key is the RootCauseCategory string, value is the max retries for that category.
	 * Falls back to `maxRetries` if not specified for a category.
	 */
	categoryThresholds?: Record<string, number>
	/**
	 * Per-category escalation action overrides.
	 * Key is the RootCauseCategory string, value is the escalation action for that category.
	 * Falls back to `escalationAction` if not specified for a category.
	 */
	categoryActions?: Record<string, EscalationAction>
}
```

Actions:

- `"warn"` — Log a warning, continue auto-repair
- `"notify"` — Flag for human attention
- `"block"` — Stop processing this incident
- `"circuit_breaker"` — Open the circuit breaker

### Per-Category Escalation Thresholds (Phase 2)

Different root cause categories can have different escalation thresholds and actions, allowing fine-grained control over how the system responds to different types of failures.

```typescript
const loop = new SelfHealingLoop(orchestrator, {
	escalationPolicy: {
		maxRetries: 3, // Default for all categories
		escalationAction: "warn",
		skipAutoRepair: true,
		// Per-category overrides
		categoryThresholds: {
			MEMORY_LEAK: 1, // Escalate after just 1 retry
			SECURITY_RISK: 0, // Escalate immediately (no retries)
			BROKEN_ROUTE: 5, // More lenient for routes
		},
		categoryActions: {
			MEMORY_LEAK: "notify", // Notify human for memory leaks
			SECURITY_RISK: "block", // Block security risks immediately
			DEPLOY_DRIFT: "circuit_breaker", // Open circuit for deploy drift
		},
	},
})
```

### Repair Attempt Tracking (Phase 2)

Each repair attempt is tracked with timestamps, duration, and outcome, enabling detailed analysis of healing performance.

```typescript
// RepairAttempt structure (tracked internally by SelfHealingLoop)
interface RepairAttempt {
	incidentId: string
	timestamp: number // When the repair was attempted
	durationMs: number // How long the repair took
	success: boolean // Whether it succeeded
	category: RootCauseCategory
	error?: string // Error message if failed
}

// Access repair history from loop stats
const stats = loop.getStats()
// stats.repairAttempts contains the full history
```

### Notification Routing (Phase 2)

Escalated incidents can be routed to specific notification channels with configurable targets.

```typescript
interface NotificationRoute {
	channel: string // "telegram" | "slack" | "email" | "dashboard"
	target: string // Chat ID, channel name, email address
}

// Notification routes are configured in the SelfHealingLoop options
const loop = new SelfHealingLoop(orchestrator, {
	notificationRoutes: [
		{ channel: "telegram", target: "-1001234567890" }, // Telegram group
		{ channel: "dashboard", target: "admin" }, // Dashboard alert
	],
	// Only notify for these severity levels
	notifyOnSeverity: ["high", "critical"],
})
```

### Circuit Breaker

The circuit breaker prevents the healing loop from burning resources on repeated failures:

```typescript
// Configuration
circuitBreakerThreshold: 5,      // 5 consecutive failures → open
circuitBreakerTimeoutMs: 300000, // Wait 5 minutes before half-open

// Check state
const stats = loop.getStats()
if (stats.circuitBreakerOpen) {
  console.log("Circuit breaker is open — healing paused")
}

// Manual reset
loop.resetCircuitBreaker()
```

### Failure Tracking

```typescript
// The loop tracks failure records per incident signature
// Signature = { category: RootCauseCategory, affectedFile: string }
// After maxRetries (default: 3), the escalation policy is applied
```

---

## Example: Healing a Broken API Route

This example shows the complete flow from incident reporting to verification.

```typescript
import { HealingBus, buildRepairPlan, markPlanExecuted } from "../healing"
import { MemoryStore } from "../memory/MemoryStore"
import { EventLog } from "../logging/EventLog"

// 1. Set up the healing bus
const bus = new HealingBus(memory, events, { autoFixEnabled: true })

// 2. Report incident (e.g., from a smoke test)
const incident = await bus.reportIncident({
	title: "GET /api/users returns 404",
	symptom: "Smoke test failed: GET http://localhost:8787/api/users returned 404",
	severity: "high",
	sourceAgent: "tester",
	featureKey: "user-management",
	affectedFiles: ["api/routes/users.js"],
	evidence: {
		statusCode: 404,
		responseBody: '{"error":"Not found"}',
		testName: "smoke-users-endpoint",
	},
})

// 3. Build repair plan
const plan = buildRepairPlan(incident)
console.log(`Category: ${plan.rootCauseCategory}`) // "BROKEN_ROUTE"
console.log(`Diagnostic steps:`, plan.diagnosticSteps)
console.log(`Approval needed: ${plan.approvalRequired}`)

// 4. Execute the fix (in a real scenario, this would be done by an agent)
// For this example, we simulate a successful fix
const result = {
	success: true,
	message: "Added missing route handler for /api/users",
	details: {
		patchFile: "api/routes/users.js",
		linesChanged: "12-18",
	},
}

// 5. Record the outcome
const executedPlan = markPlanExecuted(plan, result)
await bus.updateIncidentStatus(incident.id, "verified")

// 6. Log metrics
metrics.recordOutcome(incident.id, plan.rootCauseCategory, true, plan)
```

---

## Example: Handling Deployment Drift

This example shows how the healing module detects and handles deployment drift (when the running code doesn't match the latest commit).

```typescript
import { SelfHealingLoop, HealingBus } from "../healing"

// 1. Deploy checker detects drift
const incident = await bus.reportIncident({
	title: "VPS running outdated commit",
	symptom:
		"Deploy check: HEAD is abc123 but running code is def456. " + "Missing 3 commits including critical bugfix.",
	severity: "critical",
	sourceAgent: "deploy-checker",
	featureKey: "deployment",
	affectedFiles: [".github/workflows/deploy.yml", "scripts/deploy.sh"],
	evidence: {
		expectedCommit: "abc123",
		runningCommit: "def456",
		missingCommits: ["fix-auth-bypass", "add-rate-limiting", "update-deps"],
	},
})

// 2. Classification identifies DEPLOY_DRIFT
// (requires human approval per policy)

// 3. Build plan
const plan = buildRepairPlan(incident)
console.log(`Category: ${plan.rootCauseCategory}`) // "DEPLOY_DRIFT"
console.log(`Approval needed: ${plan.approvalRequired}`) // true
console.log(`Reason: ${plan.approvalReason}`)

// 4. Since approval is required, the incident enters "needs_human_approval" status
await bus.updateIncidentStatus(incident.id, "needs_human_approval")

// 5. Human reviews and approves, then triggers redeploy
// (manual intervention or dashboard approval)

// 6. After successful redeploy, mark as verified
await bus.updateIncidentStatus(incident.id, "verified")
```

---

## See Also

- [`ML_ENGINE_API.md`](ML_ENGINE_API.md) — ML models used in the healing pipeline
- [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) — Healing module flow diagram
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Common healing issues
- [`src/super-roo/healing/`](src/super-roo/healing/) — Source code
- [`src/super-roo/types/index.ts`](src/super-roo/types/index.ts) — Type definitions (lines 244–330)
