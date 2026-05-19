# Latest Agent Context

Generated: 2026-05-19T14:52:29.135Z
Task: enforce deployment VPS allowlist so QAS cannot deploy to SuperRoo VPS and SuperRoo cannot deploy to QAS VPS

## Relevant Lessons

1. **VPS project isolation ? QAS must not run on SuperRoo VPS**
    - Rule: Before service deploy/removal, verify hostname, Tailscale IP, public IP, DNS A record, project path, and port ownership; enforce per-project VPS allowlists.
    - Why: A duplicate QAS stack on the SuperRoo VPS bound port 3001 and caused dev.abcx124.xyz to serve the wrong app. QAS belongs on 165.22.110.111 / 100.86.182.7; SuperRoo belongs on 104.248.225.250 / 100.64.175.88.
2. **Tailscale SSH Deployment Standard**
    - Rule: ALL deployments MUST use Tailscale SSH (100.64.175.88). Never use public IP (104.248.225.250) for SSH.
    - Why: Security practices must be enforced at the tooling level, not just documented. Automated systems will fall back to insecure defaults without explicit constraints.
3. **Cross-Project Learning Layer — Sync Script, Retry Queue, and Systemd Timer**
    - Rule: When deploying systemd timers for cron-like tasks: use `OnCalendar=hourly`, `Persistent=true` to catch missed runs, `RandomizedDelaySec=5min` to spread load, and always run an initial sync after enabling to verify the service works end-to-end.
    - Why: When building infrastructure for cross-project learning, always verify the fallback paths work on all target OSes (Windows paths differ from Unix paths). The 3-layer fallback architecture (local JSONL → Central Brain MCP → markdown) provides graceful degradation — no single point of failure. Systemd timers with RandomizedDelaySec prevent thundering herd on Central Brain.
4. **PM2 env_block overrides env_file - hardcode vault keys directly in ecosystem.config.js**
    - Rule: When configuring PM2 ecosystem.config.js, NEVER use `process.env.X || ""` in the `env` block for critical secrets that are defined in `env_file`. The `env` block takes precedence over `env_file`. Either hardcode the value directly, or ensure the variable is set in the shell environment before `pm2 start`. Always verify with `cat /proc/<pid>/environ | tr '\0' '\n' | grep KEY_NAME` after restart.
    - Why: PM2 env_file directive is unreliable. The env block process.env.X patterns override .env values with empty strings. Fixed by hardcoding SUPERROO_VAULT_KEY directly. Also fixed: shutdown handler, classifier prompt, markdown stripping, button URL validation, missing pg module.
5. **VPS deployment with Caddy reverse proxy and PM2 process management**
    - Rule: Node.js production deployment MUST include: Caddy reverse proxy with automatic HTTPS, PM2 process manager with memory limits and auto-restart, environment variables in PM2 env files, and a deployment script. Never expose Node.js directly to the internet.
    - Why: Deployed the Product Image Studio app to a VPS using Caddy as a reverse proxy (automatic HTTPS via Let's Encrypt) and PM2 for Node.js process management. Required proper environment variable handling and Caddyfile configuration.

## Active Codex Tasks

- Release learning layer workflow (codex_task_learning_layer_release_20260517)

## Architecture Reminder

- **Features**: Incident detection, Root cause classification, Repair plan generation, Auto-fix deployment, Verification cycle
    > **IMPORTANT**: This is THE single source of truth for all commits and deployments across all coding agents. Every agent MUST use `CommitDeployLog.recordCommit()` and `CommitDeployLog.recordDeploy()` to record their work. The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change).
- **Features**: Autonomous multi-agent debugging, Complex feature problem solving, Phase-by-phase breakdown, Hypothesis-driven iteration, Safe container execution (Docker), Automatic git snapshot/rollback, Multi-feature integration sync, Auto-generated skills from failures, Auto-approval mode (all approvals auto-granted, all deployments auto-run), 24/7 unlimited iteration
- **Features**: GitHub Actions dispatch, VPS SSH deployment, Rollback management, Health check verification
- **Features**: Provider API key management, Encrypted secret storage (AES-256-GCM), Real provider connection testing, Agent routing sync, VPS control center (auto-approve, MCP, guardrails), Deployment safety validation

### DeepSeek Architecture Summary

The deployment VPS allowlist enforcement affects the **Deployment & CI/CD** module (GitHub Actions dispatch, VPS SSH deployment, rollback, health checks) and the **VPS Control Center** (auto-approve, MCP, guardrails, deployment safety validation). These modules connect via agent routing sync and encrypted secret storage, with the architecture constraint that deployment safety validation must reject any cross-VPS deployment (QAS to SuperRoo or vice versa) based on the allowlist.

## Task Signals

Inferred tags: deployment

## Feature Knowledge

# feature-knowledge.md

Initialized by SuperRoo workflow check.

## Recent Bug Memory

# bugs-fixed.md

Initialized by SuperRoo workflow check.

---

## Legacy Bug Fixes Migrated — 2026-05-17

### Legacy Lesson: Safe JSON Parsing in Database Registries

Date: 2026-04-30
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/bugs/BugRegistry.ts, src/super-roo/queue/TaskQueue.ts, src/super-roo/features/FeatureRegistry.ts, src/super-roo/memory/MemoryStore.ts, src/super-roo/healing/HealingBus.ts

#### Task Summary

Fixed critical bug where multiple registry modules use `JSON.parse()` without safe fallback, causing crashes on corrupted database rows.

#### Files Changed

- `src/super-roo/bugs/BugRegistry.ts` — Added safeJsonParse helper (line 42-46, 103)
- `src/super-roo/queue/TaskQueue.ts` — Added safeJsonParse helper (line 58-59)
- `src/super-roo/features/FeatureRegistry.ts` — Added safeJsonParse helper (line 48-50)
- `src/super-roo/memory/MemoryStore.ts` — Added safeJsonParse helper (line 310-311, 387)
- `src/super-roo/healing/HealingBus.ts` — Already had safeJsonParse, enhanced usage

#### Bug Cause

If database rows contain malformed JSON (due to corruption, manual edits, or migration bugs), `JSON.parse()` will throw uncaught `SyntaxError`, crashing the registry method and potentially the calling agent.

#### Fix Applied

Implemented `safeJsonParse<T>(json, fallback)` helper function that:

- Wraps JSON.parse in try/catch
- Returns fallback value on parse failure
- Applied consistently across all registry modules
- HealingBus already used this pattern; extended to other registries

### DeepSeek Bug Memory Summary

Recurring pattern: multiple registry modules (BugRegistry, TaskQueue, FeatureRegistry, MemoryStore) lacked safe JSON parsing, causing crashes on corrupted database rows. Root cause: direct `JSON.parse()` usage without fallback for malformed data. Fix: added `safeJsonParse` helper across all affected files, with enhanced usage in HealingBus.

## Model Decisions

# model-decisions.md

Initialized by SuperRoo workflow check.

---

## Legacy Model/API Decisions Migrated — 2026-05-17

### Legacy Lesson: Model Router Task-Based Routing

Date: 2026-05-08
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/settings/services/modelRouterService.ts

#### Task Summary

Implemented model routing service that maps task types to optimal provider/model pairs based on cost, quality, and speed tradeoffs.

#### Files Changed

- `src/super-roo/settings/services/modelRouterService.ts`

#### Decision Made

Created routing table with primary and fallback providers:

| Task Type    | Primary Provider | Primary Model            | Fallback 1 | Fallback 2               |
| ------------ | ---------------- | ------------------------ | ---------- | ------------------------ |
| coding       | anthropic        | claude-sonnet-4-20250514 | deepseek   | deepseek-chat            |
| debugging    | deepseek         | deepseek-chat            | anthropic  | claude-sonnet-4-20250514 |
| crawling     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |
| planning     | anthropic        | claude-sonnet-4-20250514 | openai     | gpt-4o                   |
| architecture | openai           | gpt-4o                   | anthropic  | claude-sonnet-4-20250514 |
| fast_fix     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |

#### Rationale

- Claude excels at coding and planning tasks

### DeepSeek Model Decision Summary

The developer chose the **kimi-k2.5** model for implementing a model routing service that maps task types to optimal provider/model pairs based on cost, quality, and speed tradeoffs. This decision was made to support the deployment VPS allowlist enforcement by ensuring that QAS and SuperRoo deployments are routed to their respective VPS environments. The model router service (in `modelRouterService.ts`) provides the necessary logic to enforce these deployment restrictions.
