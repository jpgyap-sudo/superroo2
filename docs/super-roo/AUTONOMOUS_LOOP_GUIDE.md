# Autonomous Loop Guide

> **Purpose**: Reference for the 10-step autonomous improvement cycle — how it works, how to configure it, and how to interpret results.
> **Source**: [`cloud/orchestrator/modules/AutonomousLoop.js`](../../cloud/orchestrator/modules/AutonomousLoop.js)
> **API Routes**: [`cloud/api/api.js`](../../cloud/api/api.js) (lines ~10750–10950)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AutonomousLoop                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Step 1   │→ │ Step 2   │→ │ Step 3   │→ │ Step 4     │  │
│  │ Audit    │  │ Fix      │  │ Test     │  │ Simulate   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│       ↓              ↓             ↓              ↓         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Step 5   │→ │ Step 6   │→ │ Step 7   │→ │ Step 8     │  │
│  │ Improve  │  │ Pattern  │  │ Dashboard│  │ Commit     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│       ↓              ↓             ↓              ↓         │
│  ┌──────────┐  ┌──────────┐                                  │
│  │ Step 9   │→ │ Step 10  │  ←── Loop back to Step 1        │
│  │ Deploy   │  │ Health   │      (if maxIterations not hit)  │
│  └──────────┘  └──────────┘                                  │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐    ┌──────────────────────┐
│   HealingBus        │    │  InfiniteImprovement  │
│   (incident reports)│◄──►│  Loop (ML ingestion)  │
└─────────────────────┘    └──────────────────────┘
```

The [`AutonomousLoop`](../../cloud/orchestrator/modules/AutonomousLoop.js:68) runs a continuous 10-step improvement cycle. Each step has a configurable timeout, and the entire loop can be configured with a maximum duration. Steps that fail are reported to the [`HealingBus`](../../cloud/orchestrator/modules/HealingBus.js) for incident tracking.

---

## The 10-Step Cycle

| Step | Method | Purpose | Timeout |
|------|--------|---------|---------|
| 1 | [`_stepAudit()`](../../cloud/orchestrator/modules/AutonomousLoop.js:406) | Type-check, lint, find test files | `stepTimeoutMs` |
| 2 | [`_stepFix()`](../../cloud/orchestrator/modules/AutonomousLoop.js:462) | Auto-fix lint, format, type errors | `stepTimeoutMs` |
| 3 | [`_stepTest()`](../../cloud/orchestrator/modules/AutonomousLoop.js:525) | Run test suite, report results | `stepTimeoutMs` |
| 4 | [`_stepSimulateE2E()`](../../cloud/orchestrator/modules/AutonomousLoop.js:581) | Playwright + AI vision E2E tests | `stepTimeoutMs` |
| 5 | [`_stepImproveCodeQuality()`](../../cloud/orchestrator/modules/AutonomousLoop.js:721) | Format, lint, dependency audit | `stepTimeoutMs` |
| 6 | [`_stepPatternLearning()`](../../cloud/orchestrator/modules/AutonomousLoop.js:798) | Extract lessons, feed ML engine | `stepTimeoutMs` |
| 7 | [`_stepDashboard()`](../../cloud/orchestrator/modules/AutonomousLoop.js:879) | Generate improvement report | `stepTimeoutMs` |
| 8 | [`_stepCommit()`](../../cloud/orchestrator/modules/AutonomousLoop.js:943) | Commit with Ollama-summarized message | `stepTimeoutMs` |
| 9 | [`_stepDeploy()`](../../cloud/orchestrator/modules/AutonomousLoop.js:1061) | Deploy via Tailscale SSH | `stepTimeoutMs` |
| 10 | [`_stepHealthCheck()`](../../cloud/orchestrator/modules/AutonomousLoop.js:1136) | Verify deployment health | `stepTimeoutMs` |

### Step Details

**Step 1 — Audit**: Runs `npx tsc --noEmit` for type checking, `find` for test file discovery, and compiles a list of findings including type errors, lint warnings, and missing tests.

**Step 2 — Fix**: Applies `prettier --write` and `eslint --fix` to auto-correctable issues. Logs all changes made.

**Step 3 — Test**: Runs the full test suite and reports pass/fail counts per test file. Failures are captured for the pattern learning step.

**Step 4 — Simulate E2E**: Runs Playwright tests and feeds screenshots to OpenAI Vision for visual regression analysis. Compares actual vs expected UI states.

**Step 5 — Improve Code Quality**: Runs `npm-check-updates` for dependency audit, applies formatting, and generates a quality improvement report.

**Step 6 — Pattern Learning**: Extracts debug lessons from test failures and ingests them into the [`InfiniteImprovementLoop`](../../src/super-roo/ml/loop/InfiniteImprovementLoop.ts) via `ingestDebugLesson()`.

**Step 7 — Dashboard**: Generates a structured improvement report with next-improvement suggestions.

**Step 8 — Commit**: Uses Ollama to summarize changes, then commits with a structured message. Records the commit in [`CommitDeployLog`](../../src/super-roo/product-memory/CommitDeployLog.ts).

**Step 9 — Deploy**: Deploys via Tailscale SSH using `remoteVerificationCommand`. Records the deploy in [`CommitDeployLog`](../../src/super-roo/product-memory/CommitDeployLog.ts).

**Step 10 — Health Check**: Verifies the deployment is healthy by running remote verification commands. Reports health status (healthy/unhealthy).

---

## Hard Safety Patterns

The [`AutonomousLoop`](../../cloud/orchestrator/modules/AutonomousLoop.js:30) enforces **18 hard safety patterns** that block dangerous commands before execution:

```javascript
const HARD_SAFETY_PATTERNS = [
  /rm\s+-rf\s+\//,      // Recursive root delete
  /mkfs/,                 // Filesystem creation
  /dd\s+if=/,            // Disk destroy
  /shutdown/,             // System shutdown
  /reboot/,              // System reboot
  /passwd/,              // Password changes
  /userdel/,             // User deletion
  /groupdel/,            // Group deletion
  /chmod\s+777/,         // Unsafe permissions
  /chown/,               // Ownership changes
  />\s*\/dev\//,         // Direct device writes
  /:\(\)\s*\{/,          // Fork bomb
  /wget\s+.*\||curl\s+.*\|/, // Remote pipe-to-shell
  /eval\s+\$\(/,         // Arbitrary eval
  /`.*rm.*`/,            // Inline rm
  /\/dev\/sda/,          // Direct disk access
  /\/dev\/nvme/,         // NVMe access
  /\/dev\/sd/,           // SCSI disk access
];
```

The [`checkHardSafety()`](../../cloud/orchestrator/modules/AutonomousLoop.js:61) function is called before every command execution. If a match is found, the command is rejected with a safety violation error.

---

## API Reference

All endpoints are served from [`cloud/api/api.js`](../../cloud/api/api.js).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/autonomous/start` | Start a new autonomous loop |
| `GET` | `/api/autonomous/status/:jobId` | Get loop status and step results |
| `POST` | `/api/autonomous/stop/:jobId` | Stop a running loop |

### POST /api/autonomous/start

**Request body**:
```json
{
  "target": "src/",
  "branch": "main",
  "durationMs": 3600000,
  "stepTimeoutMs": 300000,
  "workspaceRoot": "/root/superroo2",
  "containerFirst": true
}
```

**Response**:
```json
{
  "jobId": "auto-1712345678",
  "status": "started",
  "steps": [
    { "step": 1, "name": "audit", "status": "pending" },
    { "step": 2, "name": "fix", "status": "pending" }
  ]
}
```

### GET /api/autonomous/status/:jobId

**Response**:
```json
{
  "jobId": "auto-1712345678",
  "status": "running",
  "currentStep": 4,
  "stepResults": [
    { "step": 1, "name": "audit", "status": "passed", "duration": 1234 },
    { "step": 2, "name": "fix", "status": "passed", "duration": 567 },
    { "step": 3, "name": "test", "status": "failed", "duration": 890 }
  ],
  "startedAt": "2026-05-20T01:00:00.000Z"
}
```

### POST /api/autonomous/stop/:jobId

**Response**:
```json
{
  "jobId": "auto-1712345678",
  "status": "stopped",
  "completedSteps": 5
}
```

---

## Dashboard

The Autonomous Loop is visualized in the SuperRoo Cloud Dashboard under the **Autonomous** tab:

- **Active Jobs**: Currently running loops with step progress bars
- **Step History**: Per-step pass/fail timeline for the last 20 jobs
- **Health Metrics**: Deployment health trend across iterations
- **Pattern Insights**: Lessons extracted from failures, grouped by category

---

## Configuration

The [`AutonomousLoop`](../../cloud/orchestrator/modules/AutonomousLoop.js:111) constructor accepts:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target` | `"src/"` | Directory to audit/fix |
| `branch` | `"main"` | Git branch to commit to |
| `durationMs` | `3600000` | Max loop duration (1 hour) |
| `stepTimeoutMs` | `300000` | Per-step timeout (5 min) |
| `workspaceRoot` | `process.cwd()` | Workspace path |
| `containerFirst` | `true` | Run in Docker sandbox |

---

## Integration

The [`AutonomousLoop`](../../cloud/orchestrator/modules/AutonomousLoop.js) integrates with:

| Component | Integration Point |
|-----------|------------------|
| [`HealingBus`](../../cloud/orchestrator/modules/HealingBus.js) | Reports step failures via `reportIncident()` |
| [`InfiniteImprovementLoop`](../../src/super-roo/ml/loop/InfiniteImprovementLoop.ts) | Feeds debug lessons via `ingestDebugLesson()` |
| [`CommitDeployLog`](../../src/super-roo/product-memory/CommitDeployLog.ts) | Records commits and deploys |
| [`EventLog`](../../cloud/orchestrator/modules/EventLog.js) | Logs all loop lifecycle events |

---

## Complete Example

```javascript
// Start an autonomous loop
const response = await fetch("http://localhost:3419/api/autonomous/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    target: "src/",
    branch: "main",
    durationMs: 1800000,  // 30 minutes
    stepTimeoutMs: 300000, // 5 minutes per step
    containerFirst: true
  })
});

const { jobId } = await response.json();

// Poll for status
const poll = setInterval(async () => {
  const statusRes = await fetch(`http://localhost:3419/api/autonomous/status/${jobId}`);
  const status = await statusRes.json();
  
  console.log(`Step ${status.currentStep}/10: ${status.stepResults[status.currentStep - 1]?.name}`);
  
  if (status.status === "completed" || status.status === "failed") {
    clearInterval(poll);
    console.log("Final status:", status.status);
    console.log("Step results:", status.stepResults);
  }
}, 5000);
```

---

## See Also

- [`ML_ENGINE_GUIDE.md`](ML_ENGINE_GUIDE.md) — ML Engine that ingests debug lessons
- [`DEBUG_TEAM_GUIDE.md`](DEBUG_TEAM_GUIDE.md) — Debug Team for targeted fixes
- [`COMMISSIONING_LOOP_GUIDE.md`](COMMISSIONING_LOOP_GUIDE.md) — Full-stack commissioning
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Self-healing incident handling
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Tailscale SSH deployment
