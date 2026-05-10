---
name: debug-team
description: 🤖 Super Debug Team — Autonomous multi-agent debugging system that solves complex feature problems through phase-by-phase breakdown, hypothesis-driven iteration, safe container execution, automatic rollback, and skill generation. When active, ALL approvals are auto-approved and ALL deployments are auto-run.
---

# Super Debug Team Skill

## Overview

The Super Debug Team is an autonomous multi-agent system designed to solve complex feature problems that go beyond simple debugging. It operates as a self-contained loop with full discretion to iterate, test, rollback, and deploy — all without human intervention, as long as changes are tested in the container sandbox first.

## Architecture

```
SuperDebugLoop (orchestrator)
  ├── PhaseBreakdownEngine      — Decomposes complex goals into sequential phases
  ├── HypothesisEngine          — Manages assumptions, critical thinking, evidence tracking
  ├── ContainerSandbox          — Docker-based safe execution for 24/7 iteration
  ├── RollbackManager           — Git snapshots + automatic rollback on failure
  ├── FeatureSyncOrchestrator   — Coordinates multi-feature integration
  └── SkillsGenerator           — Auto-creates .roo/skills/ from failures & lessons
```

## When to Use

Use the Super Debug Team when:

1. **Complex feature work** — Making a complex feature work end-to-end
2. **Multi-phase problems** — Problems that require phase-by-phase breakdown
3. **High-iteration needs** — Problems needing many trial-and-error attempts
4. **Cross-feature coordination** — Changes that affect multiple features
5. **Unknown unknowns** — Problems where the root cause isn't clear
6. **24/7 autonomous operation** — When you want the system to keep trying without supervision

## ⚠️ Auto-Approval Mode

When the Super Debug Team is **ACTIVE**:

- **ALL approvals are auto-approved** — No human gates for code changes
- **ALL deployments are auto-run** — No human gates for deployments
- **Full discretion** — The team can do everything in a loop
- **Container-first** — All changes must be tested in the sandbox FIRST
- **Automatic rollback** — Any test failure triggers immediate rollback
- **Automatic retry** — Failed attempts generate improved hypotheses
- **Automatic skill generation** — Failures create reusable skills

## Workflow

### 1. Create a Debug Job

```typescript
const job = debugLoop.createJob({
	goal: "Implement user profile editing feature",
	repo: "superroo2",
	source: "internal",
	priority: "high",
	severity: "medium",
	featureIds: ["user-management", "profile"],
})
```

### 2. Monitor Progress

```typescript
const stats = debugLoop.getStats()
// {
//   totalJobsCreated: 5,
//   totalJobsCompleted: 3,
//   totalJobsFailed: 1,
//   totalAttempts: 12,
//   totalRollbacks: 2,
//   totalSkillsGenerated: 3,
//   autoApprovalMode: true,
//   ...
// }

const jobs = debugLoop.listJobs("running")
```

### 3. Stop a Job (if needed)

```typescript
debugLoop.stopJob(jobId)
debugLoop.cancelAllQueued()
```

### 4. Toggle Auto-Approval

```typescript
debugLoop.setAutoApprovalMode(false) // Require human approval
debugLoop.setAutoApprovalMode(true) // Full autonomous mode
```

## Pipeline Phases

Each debug job goes through these phases:

| Phase       | Status          | Description                                           |
| ----------- | --------------- | ----------------------------------------------------- |
| 1. Analyze  | `analyzing`     | Understand goal, inspect repo, create phase breakdown |
| 2. Plan     | `planning`      | Create hypotheses, identify assumptions               |
| 3. Snapshot | `snapshotting`  | Git snapshot before changes                           |
| 4. Patch    | `patching`      | Implement smallest viable change                      |
| 5. Test     | `testing`       | Run in Docker sandbox                                 |
| 6. Critic   | `critic_review` | Verify assumptions, check confidence                  |
| 7. Sync     | (implicit)      | Feature integration verification                      |
| 8. Commit   | `committing`    | Commit successful changes                             |
| 9. Deploy   | `deploying`     | Auto-deploy (if enabled)                              |
| 10. Learn   | (implicit)      | Generate skills from lessons                          |

On failure at any phase:

1. Rollback to last snapshot
2. Record lesson
3. Refine hypothesis
4. Generate skill from failure
5. Retry with improved hypothesis

## Configuration

```typescript
const config: Partial<SuperDebugConfig> = {
	maxAttemptsPerJob: 12, // Max retries before permanent failure
	cycleIntervalMs: 5000, // Loop cycle interval
	maxConcurrentJobs: 2, // Parallel job limit
	autoGenerateSkills: true, // Auto-create skills from failures
	useSandbox: true, // Use Docker sandbox for testing
	autoRollback: true, // Auto-rollback on failure
	featureSyncEnabled: true, // Verify multi-feature integration
	confidenceThreshold: 0.7, // Min confidence to accept hypothesis
	sandboxImage: "node:20-bookworm",
	sandboxNetwork: "none", // Network-isolated sandbox
	autoApprovalMode: true, // Full autonomous mode
	autoDeploy: false, // Auto-deploy after success
	deployTarget: "staging", // Target environment
}
```

## Integration Points

The Super Debug Team integrates with:

- **SelfHealingLoop** — Reports incidents for reactive healing
- **InfiniteImprovementLoop** — Feeds ML learning from debug patterns
- **ParallelExecutor** — Uses concurrent agent execution for patches
- **HealingBus** — Incident reporting and management
- **BugRegistry** — Bug tracking and pattern recognition
- **FeatureRegistry** — Feature dependency tracking
- **RemoteShell** — VPS operations for deployment
- **AgentBus** — Inter-agent communication

## Safety Rules

1. **Container-first**: All code changes MUST be tested in the sandbox before acceptance
2. **Snapshot before change**: A git snapshot is ALWAYS created before modifications
3. **Rollback on failure**: Any test failure triggers immediate rollback
4. **Max attempts**: Jobs have a hard limit (default 12) to prevent infinite loops
5. **Confidence threshold**: Changes below the confidence threshold are rejected
6. **Network isolation**: Sandbox runs with `--network none` by default
7. **Resource limits**: Sandbox has memory (2g) and CPU (2) limits

## Files

- [`src/super-roo/debug-team/SuperDebugLoop.ts`](src/super-roo/debug-team/SuperDebugLoop.ts) — Main orchestrating loop
- [`src/super-roo/debug-team/index.ts`](src/super-roo/debug-team/index.ts) — Module entry point
- [`src/super-roo/debug-team/engines/PhaseBreakdownEngine.ts`](src/super-roo/debug-team/engines/PhaseBreakdownEngine.ts) — Phase decomposition
- [`src/super-roo/debug-team/engines/HypothesisEngine.ts`](src/super-roo/debug-team/engines/HypothesisEngine.ts) — Critical thinking
- [`src/super-roo/debug-team/sandbox/ContainerSandbox.ts`](src/super-roo/debug-team/sandbox/ContainerSandbox.ts) — Docker sandbox
- [`src/super-roo/debug-team/sandbox/RollbackManager.ts`](src/super-roo/debug-team/sandbox/RollbackManager.ts) — Git snapshots
- [`src/super-roo/debug-team/engines/FeatureSyncOrchestrator.ts`](src/super-roo/debug-team/engines/FeatureSyncOrchestrator.ts) — Feature sync
- [`src/super-roo/debug-team/engines/SkillsGenerator.ts`](src/super-roo/debug-team/engines/SkillsGenerator.ts) — Skill generation
