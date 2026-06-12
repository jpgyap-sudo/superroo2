# Global Ecosystem Orchestrator

## Architecture Overview

The Global Ecosystem Orchestrator is the **FINAL integration layer** that coordinates all global sync agents into a unified autonomous system. It sits at the center of the SuperRoo global sync infrastructure.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Sync Daemon (Background)                    │
│                                                                 │
│  ┌──────────────┐    ┌─────────────────────────────────────┐   │
│  │ sync-all-brains │──►│ Global Ecosystem Orchestrator       │   │
│  └──────────────┘    └─────────────────────────────────────┘   │
│                                 │                               │
│                                 ▼                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Orchestrator Pipeline                   │  │
│  │                                                           │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
│  │  │  Audit  │→ │ Report  │→ │ Enforce │→ │ Verify  │   │  │
│  │  └───┬─────┘  └───┬─────┘  └───┬─────┘  └───┬─────┘   │  │
│  │      │            │            │            │          │  │
│  │      ▼            ▼            ▼            ▼          │  │
│  │  auditor     reporter      executor      re-audit      │  │
│  │                                                           │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │                   Status Update                    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Agent Responsibilities

| Agent | Role | Responsibility |
|-------|------|----------------|
| Auditor | Read-only scanner | Detects gaps across all extensions |
| Reporter | Status generator | Creates human/machine-readable reports |
| Executor | Fix engine | Applies safe fixes autonomously |
| Monitor | Watcher | Continuous file system monitoring |
| Orchestrator | Master coordinator | Manages pipeline execution order |

## Pipeline Flow

### Full Cycle (`--full`)

1. **Audit Phase**
   - Scans all 7 extensions × 7 domains
   - Generates sync matrix with gap classification
   - Safe vs approval-required determination

2. **Report Phase (Pre-Enforcement)**
   - Captures baseline state
   - Writes `ecosystem-YYYY-MM-DD-pre.json`
   - Shows what gaps exist

3. **Enforce Phase**
   - Applies fixes for `safe: true` gaps only
   - Uses atomic writes to prevent corruption
   - Logs all actions to `sync-actions.jsonl`

4. **Verify Phase**
   - Re-runs audit to confirm fixes
   - Compares gap counts before/after

5. **Report Phase (Post-Enforcement)**
   - Writes `ecosystem-YYYY-MM-DD-post.json`
   - Shows remaining gaps

6. **Status Update**
   - Updates `ecosystem-status.json`
   - Logs orchestration completion

### Monitor Mode (`--monitor`)

- File watcher on canonical memory paths
- Periodic scans (configurable interval)
- Auto-enforces safe fixes on change
- Optional `--once` for single scan

## Safety Mechanisms

### Dry-Run Default

All operations default to dry-run mode. To apply changes:

```bash
superroo-ecosystem --full --force
```

### Atomic Writes

All state files use tmp-file + rename:

```javascript
const tmpPath = `${filePath}.tmp-${Date.now()}-${random}`
fs.writeFileSync(tmpPath, content)
fs.renameSync(tmpPath, filePath)
```

### Graceful Degradation

If an agent fails, the pipeline continues:

```javascript
if (!agentResult.success) {
  warn("Agent failed — continuing with others")
  logOrchestration("agent_failed", { agent, error })
}
```

### Exit Code Semantics

| Code | Meaning |
|------|---------|
| `0` | Success - all phases passed, no gaps |
| `1` | Partial failure - some gaps remain |
| `2` | Critical failure - pipeline aborted |

### Maintenance Window Enforcement

The orchestrator runs in `--dry-run` mode by default. `--force` is only enabled during maintenance windows (02:00-04:00 local time) when triggered by sync-daemon.

## Integration Points

### 1. sync-daemon.mjs Integration

```javascript
// After sync-all-brains.mjs completes:
if (fs.existsSync(ORCHESTRATOR_SCRIPT)) {
  execSync(`node "${ORCHESTRATOR_SCRIPT}" --full ${orchestratorForce.join(" ")}`, {
    env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
  })
}
```

### 2. ACTIVE_WORK.md

Orchestrator updates task status in `ACTIVE_WORK.md`:

```markdown
## Global Ecosystem Orchestrator

Status: completed
Last run: 2026-06-02T11:15:00Z
Gaps before: 5
Gaps after: 0
Fixes applied: 5
```

### 3. Central Brain MCP

All orchestration actions are logged and lessons are stored:

- Orchestration logs → `~/.superroo/memory/orchestrator-log.jsonl`
- Ecosystem status → `~/.superroo/memory/ecosystem-status.json`
- Lessons → Central Brain via `brain_store_lesson`

## File Locations

| File | Purpose |
|------|---------|
| `scripts/global-ecosystem-orchestrator.mjs` | Main orchestrator script |
| `agents/global-ecosystem-orchestrator.md` | Agent definition |
| `skills/global-ecosystem-orchestrator/SKILL.md` | Skill documentation |
| `bin/superroo-ecosystem` | CLI wrapper |
| `.superroo/memory/ecosystem-status.json` | Master status file |
| `.superroo/memory/orchestrator-log.jsonl` | Orchestration log |

## Troubleshooting

### Orchestrator Won't Start

```bash
# Check script exists
ls scripts/global-ecosystem-orchestrator.mjs

# Run with verbose output
node scripts/global-ecosystem-orchestrator.mjs --full --status
```

### Gaps Detected But Not Fixed

```bash
# Verify dry-run mode
superroo-ecosystem --status

# Apply fixes
superroo-ecosystem --full --force
```

### Monitor Process Dies

```bash
# Check monitor script
ls scripts/global-sync-monitor.mjs

# Run in foreground for debugging
superroo-ecosystem --monitor --once
```

### Sync Conflicts

If multiple agents modify the same file:

1. Check `orchestrator-log.jsonl` for timestamps
2. Run verify phase to re-audit
3. Manual intervention may be needed for approval-required gaps