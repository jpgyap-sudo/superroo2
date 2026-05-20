# SuperRoo Debug Team — Usage Guide

> **Module**: [`src/super-roo/debug-team/SuperDebugLoop.ts`](src/super-roo/debug-team/SuperDebugLoop.ts) (1,499 lines)  
> **Cloud Port**: Delegates to [`AutonomousLoop`](cloud/orchestrator/modules/AutonomousLoop.js)  
> **Dashboard**: [`debug-team.tsx`](webview-ui/src/components/super-roo/tabs/debug-team.tsx)  
> **Skill**: [`debug-team`](.roo/skills/debug-team/SKILL.md)

The Super Debug Team is an autonomous multi-agent debugging system that solves complex feature problems through phase-by-phase breakdown, hypothesis-driven iteration, safe container execution, automatic rollback, and skill generation.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [State Machine](#state-machine)
4. [Workflow](#workflow)
5. [Auto-Approval Mode](#auto-approval-mode)
6. [API Reference](#api-reference)
7. [Dashboard](#dashboard)
8. [Integration with Other Modules](#integration-with-other-modules)
9. [Configuration](#configuration)
10. [Example: Complete Debug Job Lifecycle](#example-complete-debug-job-lifecycle)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SuperDebugLoop                                     │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                        State Machine                                   │    │
│  │                                                                        │    │
│  │  idle → analyzing → planning → snapshot → patching → testing →        │    │
│  │  critic_review → [pass: committing/deploying | fail: rollback_retry]   │    │
│  │                                                                        │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                         Engines                                        │    │
│  │  ┌─────────────────┐  ┌────────────────┐  ┌──────────────────────┐   │    │
│  │  │ PhaseBreakdown   │  │ Hypothesis      │  │ FeatureSync          │   │    │
│  │  │ Engine           │  │ Engine          │  │ Orchestrator         │   │    │
│  │  └─────────────────┘  └────────────────┘  └──────────────────────┘   │    │
│  │  ┌─────────────────┐  ┌────────────────┐  ┌──────────────────────┐   │    │
│  │  │ SkillsGenerator  │  │ OpenClaw        │  │ HermesClaw           │   │    │
│  │  │                  │  │ Adapter         │  │ Adapter              │   │    │
│  │  └─────────────────┘  └────────────────┘  └──────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                      Sandbox & Rollback                                │    │
│  │  ┌─────────────────┐  ┌────────────────┐  ┌──────────────────────┐   │    │
│  │  │ ContainerSandbox │  │ RollbackManager │  │ AceTeamReport        │   │    │
│  │  │ (Docker)         │  │ (git revert)    │  │ Generator            │   │    │
│  │  └─────────────────┘  └────────────────┘  └──────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                     Integrations                                       │    │
│  │  SelfHealingLoop ──► HealingBus ──► BugRegistry ──► FeatureRegistry   │    │
│  │  InfiniteImprovementLoop ──► ParallelExecutor                          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### PhaseBreakdownEngine

Breaks complex debugging tasks into sequential phases. Each phase has a clear goal, verification criteria, and rollback strategy.

```typescript
import { PhaseBreakdownEngine } from "./engines/PhaseBreakdownEngine"

const engine = new PhaseBreakdownEngine()
const breakdown = await engine.breakdown({
  goal: "Fix login endpoint returning 500",
  repo: "superroo2",
  context: { files: ["api/routes/auth.js"] },
})
// Returns ordered phases with descriptions and verification steps
```

### HypothesisEngine

Generates and tests hypotheses about root causes. Maintains a hypothesis tree with confidence scores.

```typescript
import { HypothesisEngine } from "./engines/HypothesisEngine"

const engine = new HypothesisEngine(orchestrator, {
  confidenceThreshold: 0.7,
})

const hypothesis = await engine.generateHypothesis({
  symptom: "GET /login returns 500",
  evidence: { statusCode: 500, stackTrace: "..." },
})
// { id, description, confidence, assumptions, verificationSteps }
```

### ContainerSandbox

Executes code changes in an isolated Docker container before applying them to the main workspace.

```typescript
import { ContainerSandbox } from "./sandbox/ContainerSandbox"

const sandbox = new ContainerSandbox({
  image: "node:20-bookworm",
  networkMode: "none", // No network access for safety
  workspaceRoot: "/srv/superroo/workspaces",
})

const result = await sandbox.runTests({
  repo: "superroo2",
  commitSha: "abc123",
  testCommand: "npm test",
})
// { passed: true, output: "...", coverage: 0.87 }
```

### RollbackManager

Automatically rolls back changes if tests fail in the sandbox. Uses git revert to restore the previous state.

```typescript
import { RollbackManager } from "./sandbox/RollbackManager"

const rollback = new RollbackManager({
  workspaceRoot: "/srv/superroo/workspaces",
})

await rollback.snapshot("pre-fix-snapshot")
// ... apply changes ...
await rollback.rollback("pre-fix-snapshot") // If tests fail
```

### FeatureSyncOrchestrator

Syncs feature registry entries after successful debug sessions, ensuring the Working Tree stays up to date.

### SkillsGenerator

Generates reusable `.roo/skills/` files from repeated failures and successful fixes.

```typescript
import { SkillsGenerator } from "./engines/SkillsGenerator"

const generator = new SkillsGenerator({
  skillsDir: ".roo/skills",
})

const artifact = await generator.generateFromLesson({
  failureType: "BROKEN_ROUTE",
  rootCause: "Missing route handler",
  solution: "Added route handler for /api/users",
  filesInvolved: ["api/routes/users.js"],
})
// Creates .roo/skills/broken-route-fix/SKILL.md
```

### OpenClawAdapter

Analysis-only adapter for repo investigation. OpenClaw is **read-only** — it never writes code.

### HermesClawAdapter

Memory and context adapter that recalls past debugging sessions and their outcomes.

---

## State Machine

The [`SuperDebugLoop`](src/super-roo/debug-team/SuperDebugLoop.ts) uses a 12-state state machine:

```
                    ┌──────────────────────────────────────┐
                    │              idle                     │
                    │         (waiting for jobs)            │
                    └──────────┬───────────────────────────┘
                               │ new job arrives
                               ▼
                    ┌──────────────────────────────────────┐
                    │            queued                     │
                    │      (waiting for slot)               │
                    └──────────┬───────────────────────────┘
                               │ slot available
                               ▼
                    ┌──────────────────────────────────────┐
                    │           analyzing                   │
                    │   (OpenClaw repo investigation)       │
                    └──────────┬───────────────────────────┘
                               │ analysis complete
                               ▼
                    ┌──────────────────────────────────────┐
                    │           planning                    │
                    │   (PhaseBreakdown + Hypothesis)       │
                    └──────────┬───────────────────────────┘
                               │ plan ready
                               ▼
                    ┌──────────────────────────────────────┐
                    │         snapshotting                  │
                    │   (git snapshot + rollback point)     │
                    └──────────┬───────────────────────────┘
                               │ snapshot taken
                               ▼
                    ┌──────────────────────────────────────┐
                    │           patching                    │
                    │   (apply fix in sandbox)              │
                    └──────────┬───────────────────────────┘
                               │ patch applied
                               ▼
                    ┌──────────────────────────────────────┐
                    │           testing                     │
                    │   (run tests in sandbox)              │
                    └──────────┬───────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │  critic_review│  │  critic_review│  │  critic_review│
     │   (pass)     │  │   (fail)     │  │   (danger)   │
     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
            │                 │                  │
            ▼                 ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │  committing  │  │rollback_retry│  │    stop      │
     │  (git commit)│  │ (git revert) │  │ (manual stop)│
     └──────┬───────┘  └──────┬───────┘  └──────────────┘
            │                 │
            ▼                 │
     ┌──────────────┐         │
     │  deploying   │         │
     │  (auto-deploy)│         │
     └──────┬───────┘         │
            │                 │
            ▼                 ▼
     ┌──────────────┐  ┌──────────────┐
     │   success    │  │   failed     │
     └──────────────┘  └──────────────┘
```

### Status Transitions

| Status | Description | Next States |
|---|---|---|
| `idle` | Waiting for jobs | `queued` |
| `queued` | Job waiting for slot | `analyzing` |
| `analyzing` | OpenClaw repo investigation | `planning` |
| `planning` | Phase breakdown + hypothesis | `snapshotting` |
| `snapshotting` | Git snapshot taken | `patching` |
| `patching` | Fix applied in sandbox | `testing` |
| `testing` | Tests running in sandbox | `critic_review` |
| `critic_review` | Review results | `committing` / `rolled_back` / `stopped` |
| `committing` | Git commit | `deploying` / `success` |
| `deploying` | Auto-deploy | `success` |
| `success` | Job completed | `idle` |
| `failed` | Job failed permanently | `idle` |
| `rolled_back` | Changes reverted | `analyzing` (retry) |
| `stopped` | Manually stopped | `idle` |
| `blocked` | Blocked by dependency | `idle` |

---

## Workflow

A debug job flows through these stages:

1. **Job Creation**: A debug job is created via API, Telegram, or dashboard with a goal, repo, and priority
2. **Queuing**: The job enters a priority queue, waiting for an available slot (max 2 concurrent)
3. **Analysis**: OpenClaw investigates the repo structure, dependencies, and relevant files
4. **Planning**: PhaseBreakdownEngine breaks the problem into phases; HypothesisEngine generates root cause hypotheses
5. **Snapshot**: A git snapshot is taken for rollback safety
6. **Patching**: The fix is applied inside a Docker sandbox container
7. **Testing**: Tests run inside the sandbox; results are collected
8. **Critic Review**: Results are evaluated:
   - **Pass**: Changes are committed and optionally deployed
   - **Fail**: Changes are rolled back, a new hypothesis is generated, and the cycle retries (up to 12 attempts)
   - **Danger**: The job is stopped immediately
9. **Skill Generation**: If the job failed, a skill is generated from the failure pattern
10. **Lesson Extraction**: Lessons are extracted and fed to the LearningGateway

---

## Auto-Approval Mode

When the debug team is **ACTIVE**, all approvals are auto-approved and all deployments are auto-run. This means:

- ✅ No human approval gates for code changes
- ✅ No human approval gates for deployments
- ✅ Automatic rollback on any test failure
- ✅ Automatic retry with improved hypothesis
- ✅ Automatic skill generation from failures

```typescript
const config: SuperDebugConfig = {
  autoApprovalMode: true,  // Auto-approve everything
  autoDeploy: false,       // Auto-deploy after commit (optional)
  deployTarget: "staging", // "staging" | "production"
}
```

**When to use**: Use auto-approval mode when you trust the sandbox testing to catch all issues. Disable it for production deployments or when manual review is required.

---

## API Reference

All debug team endpoints are served from the cloud API.

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| `GET` | `/api/debug-team/status` | Get current status | — | `{ success, status, running, currentStep, progress }` |
| `POST` | `/api/debug-team/start` | Start debug loop | `{ target, branch, durationMs, stepTimeoutMs }` | `{ success, jobId, status }` |
| `POST` | `/api/debug-team/stop` | Stop debug loop | — | `{ success, status, completedSteps }` |
| `GET` | `/api/debug-team/jobs` | List recent jobs | `?limit=20` | `{ success, jobs: [{ id, goal, status, createdAt }] }` |
| `POST` | `/api/debug-team/test-telegram` | Test Telegram config | `{ chatId, message }` | `{ success }` |

### POST `/api/debug-team/start`

```bash
curl -X POST http://localhost:8787/api/debug-team/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target": "superroo2",
    "branch": "main",
    "durationMs": 18000000,
    "stepTimeoutMs": 600000
  }'
```

Response:
```json
{
  "success": true,
  "jobId": "debug-1712345678901",
  "status": "running",
  "target": "superroo2",
  "durationMs": 18000000
}
```

### GET `/api/debug-team/status`

```bash
curl http://localhost:8787/api/debug-team/status \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "success": true,
  "status": "running",
  "running": true,
  "jobId": "debug-1712345678901",
  "currentStep": 3,
  "currentStepName": "Test",
  "totalSteps": 10,
  "progress": 30,
  "elapsedFormatted": "5m 23s",
  "remainingFormatted": "4h 54m 37s",
  "stepResults": [
    { "step": 1, "name": "Audit", "status": "completed" },
    { "step": 2, "name": "Fix", "status": "completed" },
    { "step": 3, "name": "Test", "status": "running" }
  ]
}
```

---

## Dashboard

The Debug Team dashboard view (`debug-team.tsx`) provides:

- **Start/Stop Controls**: Buttons to start and stop the debug loop
- **Live Progress**: Current step, progress percentage, elapsed/remaining time
- **Step Timeline**: Visual timeline showing completed, running, and failed steps
- **Recent Jobs**: List of recent debug jobs with status indicators
- **Auto-Approval Status**: Badge showing whether auto-approval mode is active

The dashboard does **not** yet show:
- Phase breakdown details per job
- Hypothesis tree visualization
- Snapshot diffs
- Extracted lessons per job

---

## Integration with Other Modules

### SelfHealingLoop → HealingBus

Debug failures are reported as incidents to the [`HealingBus`](src/super-roo/healing/HealingBus.ts). The TypeScript `SuperDebugLoop` integrates directly; the cloud port delegates to `AutonomousLoop` which reports failures via `orchestrator.healingBus.reportIncident()`.

### InfiniteImprovementLoop

The debug team feeds debug-specific learning data to the [`InfiniteImprovementLoop`](src/super-roo/ml/loop/InfiniteImprovementLoop.ts). The `DebugLearner` trains on debug session features to improve root cause prediction.

### BugRegistry

Failed debug jobs create bug entries in the Bug Registry for tracking and prioritization.

### FeatureRegistry

Successful debug jobs update the Feature Registry to mark features as verified.

### ParallelExecutor

The debug team can use the [`ParallelExecutor`](src/super-roo/parallel/ParallelExecutor.ts) for concurrent agent execution during analysis and patching phases.

---

## Configuration

```typescript
interface SuperDebugConfig {
  maxAttemptsPerJob: number      // Max attempts before permanent failure (default: 12)
  cycleIntervalMs: number        // Loop cycle interval (default: 5000)
  maxConcurrentJobs: number      // Max concurrent jobs (default: 2)
  autoGenerateSkills: boolean    // Auto-generate skills from failures (default: true)
  useSandbox: boolean            // Use Docker sandbox (default: true)
  autoRollback: boolean          // Auto-rollback on failure (default: true)
  featureSyncEnabled: boolean    // Sync features on success (default: true)
  confidenceThreshold: number    // Hypothesis confidence threshold (default: 0.7)
  sandboxImage: string           // Docker image (default: "node:20-bookworm")
  sandboxNetwork: string         // Docker network mode (default: "none")
  workspaceRoot: string          // Workspace root (default: "/srv/superroo/workspaces")
  autoApprovalMode: boolean      // Auto-approve all (default: true)
  autoDeploy: boolean            // Auto-deploy after commit (default: false)
  deployTarget: string           // "staging" | "production" (default: "staging")
  enableOpenClaw: boolean        // Use OpenClaw analysis (default: true)
  enableHermesClaw: boolean      // Use HermesClaw memory (default: true)
  enableML: boolean              // Enable ML integration (default: true)
  aceTeamMode: boolean           // Ace Team comprehensive logging (default: false)
}
```

---

## Example: Complete Debug Job Lifecycle

```typescript
import { SuperDebugLoop } from "./SuperDebugLoop"
import { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"

// 1. Create the debug loop
const debugLoop = new SuperDebugLoop(orchestrator, {
  maxAttemptsPerJob: 5,
  cycleIntervalMs: 3000,
  maxConcurrentJobs: 2,
  autoApprovalMode: true,
  useSandbox: true,
  sandboxImage: "node:20-bookworm",
})

// 2. Start the loop
await debugLoop.start()

// 3. Submit a debug job (via API)
// POST /api/debug-team/start
// { "target": "superroo2", "branch": "main" }

// 4. Monitor progress
const stats = debugLoop.getStats()
console.log(`Jobs created: ${stats.totalJobsCreated}`)
console.log(`Jobs completed: ${stats.totalJobsCompleted}`)
console.log(`Jobs failed: ${stats.totalJobsFailed}`)
console.log(`Skills generated: ${stats.totalSkillsGenerated}`)

// 5. The loop processes the job:
//    - analyzing: OpenClaw investigates the repo
//    - planning: PhaseBreakdownEngine creates phases
//    - snapshotting: Git snapshot taken
//    - patching: Fix applied in Docker sandbox
//    - testing: Tests run in sandbox
//    - critic_review: Results evaluated
//    - committing: If pass, changes committed
//    - success: Job completed

// 6. Check job status via API
// GET /api/debug-team/jobs?limit=10

// 7. Stop the loop
await debugLoop.stop()
```

### Expected Console Output

```
[SuperDebugLoop] Started | maxConcurrentJobs=2 | autoApproval=true
[SuperDebugLoop] Job debug-1712345678901 queued
[SuperDebugLoop] Job debug-1712345678901 → analyzing
[SuperDebugLoop] OpenClaw analysis complete: 3 files affected
[SuperDebugLoop] Job debug-1712345678901 → planning
[SuperDebugLoop] Hypothesis: Missing route handler (confidence: 0.85)
[SuperDebugLoop] Job debug-1712345678901 → snapshotting
[SuperDebugLoop] Snapshot taken: pre-fix-1712345678901
[SuperDebugLoop] Job debug-1712345678901 → patching
[SuperDebugLoop] Patch applied in sandbox
[SuperDebugLoop] Job debug-1712345678901 → testing
[SuperDebugLoop] Tests: 12 passed, 0 failed
[SuperDebugLoop] Job debug-1712345678901 → critic_review → PASS
[SuperDebugLoop] Job debug-1712345678901 → committing
[SuperDebugLoop] Commit: abc123def456
[SuperDebugLoop] Job debug-1712345678901 → success
[SuperDebugLoop] Skills generated: 0
[SuperDebugLoop] Lessons extracted: 1
```

---

## See Also

- [`AUTONOMOUS_LOOP_GUIDE.md`](AUTONOMOUS_LOOP_GUIDE.md) — The cloud port that the debug team delegates to
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — How debug failures trigger healing incidents
- [`ML_ENGINE_GUIDE.md`](ML_ENGINE_GUIDE.md) — How the debug team feeds ML learning
- [`src/super-roo/debug-team/`](src/super-roo/debug-team/) — Source code
- [`.roo/skills/debug-team/SKILL.md`](.roo/skills/debug-team/SKILL.md) — Debug team skill
