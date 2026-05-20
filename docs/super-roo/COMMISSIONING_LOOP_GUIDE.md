# Commissioning Loop Guide

> **Purpose**: Reference for the 14-phase full-stack commissioning engine — what each phase tests, how to run it, and how to interpret results.
> **Source**: [`cloud/orchestrator/modules/CommissioningLoop.js`](../../cloud/orchestrator/modules/CommissioningLoop.js)
> **API Routes**: [`cloud/api/api.js`](../../cloud/api/api.js) (lines ~11000–11119)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CommissioningLoop                             │
│                                                                  │
│  Phase 1   Phase 2   Phase 3   Phase 4   Phase 5   Phase 6     │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │Repo  │→ │Env   │→ │Boot  │→ │UI    │→ │API   │→ │DB    │   │
│  │Insp. │  │Valid.│  │Verif.│  │Test  │  │Verif.│  │Valid.│   │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘   │
│       ↓        ↓         ↓        ↓        ↓         ↓         │
│  Phase 7   Phase 8   Phase 9   Phase 10  Phase 11  Phase 12    │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │Integ.│→ │Queue │→ │File  │→ │Secur.│→ │Perf. │→ │Auto  │   │
│  │Verif.│  │Worker│  │Upload│  │Auth  │  │Stab. │  │Debug │   │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘   │
│       ↓        ↓         ↓        ↓        ↓         ↓         │
│  Phase 13  Phase 14                                             │
│  ┌──────┐  ┌──────┐                                             │
│  │Deploy│→ │Final │  ←── Report generated                       │
│  │Read. │  │Report│      on completion                          │
│  └──────┘  └──────┘                                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│    Bug Registry     │
│  (auto-creates bugs │
│   on phase failure) │
└─────────────────────┘
```

The [`CommissioningLoop`](../../cloud/orchestrator/modules/CommissioningLoop.js:72) runs 14 sequential phases to validate a full-stack application. Each phase produces structured results (pass/fail with details). Failed phases automatically create entries in the [`BugRegistry`](../../cloud/orchestrator/modules/BugRegistry.js).

---

## The 14 Phases

| # | Phase | Method | What It Tests |
|---|-------|--------|---------------|
| 1 | Repo Inspection | [`_phaseRepoInspection()`](../../cloud/orchestrator/modules/CommissioningLoop.js:422) | Package.json, config files, Dockerfile, CI config, README |
| 2 | Env Validation | [`_phaseEnvValidation()`](../../cloud/orchestrator/modules/CommissioningLoop.js:492) | Node version, npm, Docker, Git, disk space, memory |
| 3 | Boot Verification | [`_phaseBootVerification()`](../../cloud/orchestrator/modules/CommissioningLoop.js:578) | Server starts, health endpoint responds, WebSocket connects |
| 4 | UI Testing | [`_phaseUITesting()`](../../cloud/orchestrator/modules/CommissioningLoop.js:672) | Login page, dashboard, settings page, 404 page |
| 5 | API Verification | [`_phaseAPIVerification()`](../../cloud/orchestrator/modules/CommissioningLoop.js:736) | Public endpoints (health, stats), auth endpoints (login, verify) |
| 6 | Database Validation | [`_phaseDatabaseValidation()`](../../cloud/orchestrator/modules/CommissioningLoop.js:800) | SQLite/Postgres files, schema integrity, migration status |
| 7 | Integration Verification | [`_phaseIntegrationVerification()`](../../cloud/orchestrator/modules/CommissioningLoop.js:849) | Ollama, Qdrant, Redis, Telegram bot connectivity |
| 8 | Queue/Worker Testing | [`_phaseQueueWorkerTesting()`](../../cloud/orchestrator/modules/CommissioningLoop.js:932) | Queue connection, job submission, job processing, worker logs |
| 9 | File Upload Testing | [`_phaseFileUploadTesting()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1019) | Upload endpoint, file type validation, size limits, storage |
| 10 | Security/Auth | [`_phaseSecurityAuth()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1073) | HTTPS, CORS headers, auth bypass, rate limiting, secret exposure |
| 11 | Performance/Stability | [`_phasePerformanceStability()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1151) | Load test (100 concurrent), memory usage, CPU, response times |
| 12 | Autonomous Debugging | [`_phaseAutonomousDebugging()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1243) | Error log analysis, crash detection, memory leak check, recovery test |
| 13 | Deployment Readiness | [`_phaseDeploymentReadiness()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1313) | Build check, env vars, port availability, SSL cert, backup check |
| 14 | Final Report | [`_phaseFinalReport()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1392) | Generates comprehensive markdown report |

### Phase Details

**Phase 1 — Repo Inspection**: Checks for `package.json`, `tsconfig.json`, `Dockerfile`, `.github/workflows`, `README.md`, `.env.example`. Reports missing files as findings.

**Phase 2 — Env Validation**: Runs `node --version`, `npm --version`, `docker --version`, `git --version`, checks available disk space and memory.

**Phase 3 — Boot Verification**: Starts the application, hits the health endpoint (`/api/health`), verifies WebSocket connectivity, checks startup time.

**Phase 4 — UI Testing**: Uses Playwright to navigate to login page, dashboard, settings page, and a 404 page. Verifies each page loads correctly.

**Phase 5 — API Verification**: Tests public endpoints (`GET /api/health`, `GET /api/stats`) and auth endpoints (`POST /api/auth/login`, `GET /api/auth/verify`).

**Phase 6 — Database Validation**: Checks for SQLite database files, PostgreSQL connection, schema integrity, and migration status.

**Phase 7 — Integration Verification**: Tests connectivity to Ollama (`http://127.0.0.1:11434`), Qdrant (`http://127.0.0.1:6333`), Redis, and Telegram bot API.

**Phase 8 — Queue/Worker Testing**: Verifies queue connection, submits a test job, waits for processing, and checks worker logs.

**Phase 9 — File Upload Testing**: Tests file upload endpoint with valid/invalid files, checks file type validation, size limits, and storage location.

**Phase 10 — Security/Auth**: Checks HTTPS enforcement, CORS headers, auth bypass attempts, rate limiting, and secret exposure in logs.

**Phase 11 — Performance/Stability**: Runs a load test with 100 concurrent requests, monitors memory usage, CPU, and response times.

**Phase 12 — Autonomous Debugging**: Analyzes error logs, checks for crashes, memory leaks, and tests recovery from simulated failures.

**Phase 13 — Deployment Readiness**: Verifies build succeeds, required env vars are set, ports are available, SSL cert is valid, and backup exists.

**Phase 14 — Final Report**: Aggregates all phase results into a structured markdown report saved to `commissioning/final-commissioning-report.md`.

---

## Safety & Sandboxing

The [`CommissioningLoop`](../../cloud/orchestrator/modules/CommissioningLoop.js) shares the same **18 hard safety patterns** as the [`AutonomousLoop`](AUTONOMOUS_LOOP_GUIDE.md#hard-safety-patterns) (see [`HARD_SAFETY_PATTERNS`](../../cloud/orchestrator/modules/CommissioningLoop.js:34)).

Phases that require container isolation are determined by [`_phaseRequiresContainer()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1535). When enabled, commands run inside a Docker sandbox via [`_runInSandbox()`](../../cloud/orchestrator/modules/CommissioningLoop.js:1409):

```javascript
const dockerCmd = [
  "docker", "run", "--rm",
  "-v", `${workspaceRoot}:/workspace`,
  "-w", "/workspace",
  "node:18-alpine",
  "sh", "-c", cmd
];
```

---

## API Reference

All endpoints are served from [`cloud/api/api.js`](../../cloud/api/api.js).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/commissioning/start` | Start a new commissioning run |
| `GET` | `/api/commissioning/status/:jobId` | Get run status and phase results |
| `POST` | `/api/commissioning/stop/:jobId` | Stop a running commissioning |
| `GET` | `/api/commissioning/report` | Get the latest commissioning report |

### POST /api/commissioning/start

**Request body**:
```json
{
  "target": "/root/superroo2",
  "skipPhases": [9, 11],
  "containerFirst": true
}
```

**Response**:
```json
{
  "jobId": "comm-1712345678",
  "status": "started",
  "phases": [
    { "phase": 1, "name": "Repo Inspection", "status": "pending" },
    { "phase": 2, "name": "Env Validation", "status": "pending" }
  ]
}
```

### GET /api/commissioning/status/:jobId

**Response**:
```json
{
  "jobId": "comm-1712345678",
  "status": "running",
  "currentPhase": 5,
  "phaseResults": [
    { "phase": 1, "name": "Repo Inspection", "status": "passed", "findings": [...] },
    { "phase": 2, "name": "Env Validation", "status": "passed", "results": [...] },
    { "phase": 3, "name": "Boot Verification", "status": "failed", "error": "..." },
    { "phase": 4, "name": "UI Testing", "status": "skipped" }
  ]
}
```

### POST /api/commissioning/stop/:jobId

**Response**:
```json
{
  "jobId": "comm-1712345678",
  "status": "stopped",
  "completedPhases": 3
}
```

### GET /api/commissioning/report

**Response**:
```json
{
  "reportPath": "commissioning/final-commissioning-report.md",
  "summary": {
    "total": 14,
    "passed": 11,
    "failed": 2,
    "skipped": 1,
    "duration": 345678
  }
}
```

---

## Dashboard

The Commissioning Loop is visualized in the SuperRoo Cloud Dashboard under the **Commissioning** tab:

- **Run History**: List of all commissioning runs with pass/fail summary
- **Phase Breakdown**: Per-phase results with expandable details
- **Bug Registry Links**: Failed phases link to auto-created bug entries
- **Report Viewer**: Rendered final report with phase-by-phase results

---

## Configuration

The [`CommissioningLoop`](../../cloud/orchestrator/modules/CommissioningLoop.js:113) constructor accepts:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target` | `process.cwd()` | Workspace to commission |
| `skipPhases` | `[]` | Array of phase numbers to skip |
| `containerFirst` | `true` | Run phases in Docker sandbox |
| `timeout` | `600000` | Per-phase timeout (10 min) |

---

## Integration

The [`CommissioningLoop`](../../cloud/orchestrator/modules/CommissioningLoop.js) integrates with:

| Component | Integration Point |
|-----------|------------------|
| [`BugRegistry`](../../cloud/orchestrator/modules/BugRegistry.js) | Auto-creates bug entries on phase failure |
| [`EventLog`](../../cloud/orchestrator/modules/EventLog.js) | Logs all phase lifecycle events |
| [`AutonomousLoop`](AUTONOMOUS_LOOP_GUIDE.md) | Phase 12 triggers autonomous debugging |

---

## Complete Example

```javascript
// Start a commissioning run
const response = await fetch("http://localhost:3419/api/commissioning/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    target: "/root/superroo2",
    skipPhases: [9, 11],  // Skip file upload and performance tests
    containerFirst: true
  })
});

const { jobId } = await response.json();

// Poll for status
const poll = setInterval(async () => {
  const statusRes = await fetch(`http://localhost:3419/api/commissioning/status/${jobId}`);
  const status = await statusRes.json();
  
  console.log(`Phase ${status.currentPhase}/14: ${status.phaseResults[status.currentPhase - 1]?.name}`);
  
  if (status.status === "completed") {
    clearInterval(poll);
    
    // Get the final report
    const reportRes = await fetch("http://localhost:3419/api/commissioning/report");
    const report = await reportRes.json();
    
    console.log(`Passed: ${report.summary.passed}/${report.summary.total}`);
    console.log(`Report saved to: ${report.reportPath}`);
  }
}, 5000);
```

---

## See Also

- [`AUTONOMOUS_LOOP_GUIDE.md`](AUTONOMOUS_LOOP_GUIDE.md) — Autonomous improvement cycle
- [`DEBUG_TEAM_GUIDE.md`](DEBUG_TEAM_GUIDE.md) — Debug Team for targeted fixes
- [`ML_ENGINE_GUIDE.md`](ML_ENGINE_GUIDE.md) — ML Engine for pattern learning
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Self-healing incident handling
