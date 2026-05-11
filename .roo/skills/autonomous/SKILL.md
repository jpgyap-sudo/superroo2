---
name: autonomous
description: 🤖 Autonomous Mode — Self-directed scanning, reporting, auto-approval, auto-deployment, and 10-step autonomous improvement loop using Tailscale SSH
---

# Autonomous Skill (v3 — Full Autonomous Command)

## Purpose

Enable the assistant to run as a **fully autonomous agent** that:

1. Self-directs scans and generates comprehensive status reports
2. **Auto-approves ALL code changes** — no human gates needed
3. **Auto-deploys ALL changes** — using Tailscale SSH (`100.64.175.88`)
4. Runs the **10-step autonomous improvement loop** for up to 5 hours
5. Uses **container-first testing** — all changes tested in Docker sandbox first
6. Runs continuously in the background while the user sleeps

## Trigger Commands

- `autonomous`
- `/autonomous`
- `go autonomous`
- `run autonomous report`
- `what's the autonomous status`
- `auto pilot`
- `/autopilot`
- `sleep mode`
- `auto everything`

## ⚠️ Auto-Approval Behavior

When Autonomous Mode is **ACTIVE** (FULL_AUTONOMOUS):

- **ALL approvals are auto-approved** — No human gates for code changes
- **ALL deployments are auto-run** — No human gates for deployments
- **Full discretion** — The agent can do everything in a loop
- **Container-first** — All changes must be tested in the Docker sandbox FIRST
- **Automatic rollback** — Any test failure triggers immediate rollback
- **Automatic retry** — Failed attempts generate improved hypotheses
- **Automatic skill generation** — Failures create reusable skills
- **CommitDeployLog** — Every commit and deploy is recorded automatically

## Container-First Testing Requirement

**ALL code changes MUST be tested in a Docker container before being committed or deployed.**

1. Before each step, verify a Docker sandbox container exists
2. If no container exists, create one: `docker build -t superroo-sandbox . && docker run -d --name superroo-test superroo-sandbox`
3. Run tests inside the container: `docker exec superroo-test npx vitest run`
4. Only proceed if container tests pass
5. If container creation fails, log the error and skip to the next step

## Allowed Commands (auto-approved in FULL_AUTONOMOUS)

- Code edits, file creation, file modification
- Running tests (vitest, jest, mocha)
- Bug fixes and refactoring
- Git commits (`git add`, `git commit`, `git push`)
- Local builds and test runs
- Lint fixes
- SSH status checks (read-only)
- Staging deploy via approved scripts
- PM2 status checks (`pm2 status`, `pm2 list`)
- Docker compose operations (`docker-compose up -d`, `docker-compose ps`)
- Health checks (`curl` endpoints)
- Mock trading and backtesting
- Non-destructive database reads (SELECT queries)
- Report generation and file writing

## Denied Commands (blocked even in FULL_AUTONOMOUS)

- `rm -rf`, `sudo rm`, `mkfs`, `dd`
- `shutdown`, `reboot`, `passwd`, `userdel`, `usermod`
- `chmod 777 /`, `chown -R /`
- `cat .env`, `nano/vi/vim .env`, `> .env`
- Editing files in `/etc/*`
- Editing files in `~/.ssh`, `/root/.ssh`
- `docker rm`, `docker system prune`, `docker volume rm`
- `pm2 delete` (without approval)
- `withdraw`, `transfer`, `sendTransaction`
- Any command containing `privateKey`, `secretKey`

## SSH Rules

- SSH is ONLY allowed for controlled deployment and status checks via safe scripts
- Safe deploy script: `/root/xsjprd55/roo-safe-deploy.sh`
- Safe status script: `/root/xsjprd55/roo-safe-status.sh`
- Never run raw SSH commands that modify system state

## Node/PM2 Rules

- Always use `ecosystem.config.js` for PM2 operations
- Never delete PM2 apps without explicit approval

## The 10-Step Autonomous Loop

When the `autonomous` command is triggered, the system runs this loop:

### Step 1: Audit

- Check for broken imports, missing dependencies, failed API endpoints
- Scan for missing tests, lint errors, TypeScript errors
- Review recent git history for regressions
- Check BugRegistry for unresolved bugs
- Check FeatureRegistry for incomplete features

### Step 2: Fix

- Prioritize issues found in Step 1
- Fix highest-priority issues first (critical bugs > test failures > lint)
- Apply fixes with container-first testing

### Step 3: Test

- Run full test suite: `npx vitest run`
- Run lint: `npx eslint .`
- Run TypeScript check: `npx tsc --noEmit`
- Record results in `TEST_RESULTS.md`

### Step 4: Simulate

- Run mock trading simulations (if trading agents are configured)
- Record results in `MOCK_TRADER_RESULTS.md`
- Analyze simulation output for regressions

### Step 5: Improve Agents

- Update trading signal agent parameters based on simulation results
- Improve research agent prompts and data sources
- Enhance mock trader agent strategies

### Step 6: ML Loop

- Save mock trade data to the ML training pipeline
- Improve scoring models based on recent results
- Update agent performance metrics

### Step 7: Dashboard

- Maintain and update dashboard tabs with latest data
- Update `AUTONOMOUS_IMPROVEMENT_REPORT.md`
- Update `AGENT_PERFORMANCE.md`

### Step 8: Commit

- `git add -A`
- `git commit -m "auto: <summary of changes>"`
- Record commit in CommitDeployLog

### Step 9: Deploy

- Use safe deploy script via SSH: `/root/xsjprd55/roo-safe-deploy.sh`
- Record deploy in CommitDeployLog

### Step 10: Health Check

- Check PM2 status: `pm2 status`
- Check application logs for errors
- Curl health endpoint
- Record health status in `DEPLOYMENT_LOG.md`

## Required Report Files

The autonomous loop generates and maintains these files:

| File                               | Purpose                               |
| ---------------------------------- | ------------------------------------- |
| `AUTONOMOUS_IMPROVEMENT_REPORT.md` | Summary of all improvements made      |
| `BUG_FIX_LOG.md`                   | Log of bugs found and fixed           |
| `TEST_RESULTS.md`                  | Test run results                      |
| `DEPLOYMENT_LOG.md`                | Deployment history and health status  |
| `NEXT_IMPROVEMENTS.md`             | Prioritized list of next improvements |
| `NEEDS_USER_APPROVAL.md`           | Items requiring human intervention    |
| `MOCK_TRADER_RESULTS.md`           | Mock trading simulation results       |
| `AGENT_PERFORMANCE.md`             | Agent performance metrics             |

## Tailscale Deployment (Mandatory)

**ALL deployments MUST use Tailscale SSH.**

| Detail                 | Value                                |
| ---------------------- | ------------------------------------ |
| Tailscale IP           | `100.64.175.88`                      |
| Hostname               | `ubuntu-s-2vcpu-4gb-amd-nyc1`        |
| SSH Target             | `root@100.64.175.88`                 |
| Identity File          | `C:\Users\User\.ssh\id_superroo_vps` |
| Public IP (DO NOT USE) | ~~`104.248.225.250`~~                |

### SSH Hang Prevention

Every SSH command MUST include these safeguards:

```bash
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"
```

| Operation           | Timeout |
| ------------------- | ------- |
| SSH connection test | 15s     |
| git pull            | 60s     |
| pnpm install        | 180s    |
| pnpm build          | 300s    |
| nginx test+reload   | 30s     |
| pm2 restart         | 60s     |
| pm2 status          | 30s     |
| SCP file transfer   | 30s     |
| pm2 logs            | 15s     |

## What The Report Covers

1. **Project State** — git status, last commit, uncommitted changes
2. **System Health** — key API endpoints, Supabase connection, Telegram webhook
3. **Worker Status** — which workers are defined vs running (if VPS info available)
4. **Recent Signals** — signal generation activity from Supabase (if accessible)
5. **Open Issues** — bugs/errors detected in logs or `agent_ideas` table
6. **Action Items** — prioritized next steps based on findings

## Report Output

- File: `AUTONOMOUS-REPORT-{YYYY-MM-DD-HHMM}.md` in workspace root
- Console: summary printed immediately
- Memory: `C:/Users/User/.roo/MEMORY.md` updated with autonomous session record

## Safety Rules

- Never expose secrets, API keys, or tokens in reports
- If Supabase/VPS is unreachable, note it and continue with local-only data
- **Auto-fix is enabled** — do NOT wait for user confirmation on fixes
- Always log what was checked and what was skipped
- Always record commits and deploys in `CommitDeployLog`

## Instructions

When the user triggers autonomous mode:

### Phase 1: Scan & Report

1. **Scan Project State**

    - Check git status for uncommitted changes
    - Review recent commit history
    - Identify modified files and potential merge conflicts

2. **Check System Health**

    - Verify Supabase connection if configured
    - Check Telegram webhook status if configured
    - Test any configured API endpoints

3. **Review Worker Status**

    - Check `ops/` directory for service definitions
    - Verify systemd services if on Linux VPS
    - Report any stopped or failed services

4. **Analyze Recent Activity**

    - Check `AUTONOMOUS_IMPROVEMENT_REPORT.md` for previous findings
    - Review `BUG_FIX_LOG.md` for unresolved issues
    - Look at `NEEDS_USER_APPROVAL.md` for pending items

5. **Generate Report**
    - Create `AUTONOMOUS-REPORT-{timestamp}.md` with all findings
    - Update `C:/Users/User/.roo/MEMORY.md` with session summary
    - Provide prioritized action items

### Phase 2: Auto-Fix & Deploy Loop

After the report is generated, enter the **auto-fix loop**:

1. **Prioritize** — Pick the highest-priority action item from the report
2. **Fix** — Implement the fix (code changes, config updates, etc.)
3. **Test** — Run tests to verify the fix works
4. **Commit** — `git add -A && git commit -m "auto: ..."`
5. **Record Commit** — Call `CommitDeployLog.recordCommit()` with the commit SHA
6. **Deploy** — SCP files to VPS via Tailscale, PM2 reload, health check
7. **Record Deploy** — Call `CommitDeployLog.recordDeploy()` with version and status
8. **Verify** — Check health endpoint, verify the fix is live
9. **Loop** — Go back to step 1 for the next action item

### Phase 3: Continuous Loop

If the user said "sleep mode" or "auto everything":

- Keep looping through Phases 1-2 indefinitely
- Sleep 5 minutes between full cycles
- If no action items remain, generate new ones from log analysis
- Auto-deploy even during "off hours" — no maintenance window restrictions

## Auto-Deploy Workflow

```bash
# 1. SCP files to VPS
scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    cloud/api/api.js \
    root@100.64.175.88:/opt/superroo2/cloud/api/api.js

# 2. Kill old process and restart
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    root@100.64.175.88 \
    "kill -9 \$(lsof -ti:8787) 2>/dev/null; sleep 2; \
     cd /opt/superroo2/cloud/api && \
     nohup node api.js > /var/log/superroo-api.log 2>&1 &"

# 3. Health check
sleep 4
curl -s http://100.64.175.88:8787/health

# 4. Record in CommitDeployLog
# Use CommitDeployLog.recordCommit() and CommitDeployLog.recordDeploy()
```

## Integration with Cloud Orchestrator

When the Cloud Orchestrator is running on the VPS:

- Use `POST /orchestrator/submit` to submit tasks
- Use `POST /orchestrator/commits` to record commits
- Use `POST /orchestrator/deploys` to record deploys
- Use `GET /orchestrator/status` to check orchestrator health
- Use `POST /orchestrator/healing/cycle` to trigger healing
- Use `POST /autonomous/start` to trigger the 10-step autonomous loop
- Use `GET /autonomous/status/:jobId` to monitor loop progress
- Use `POST /autonomous/stop/:jobId` to gracefully stop the loop

## Output Format

When autonomous mode runs, report:

```
🤖 Autonomous Mode Report
━━━━━━━━━━━━━━━━━━━━━━━━━
Mode:           FULL_AUTONOMOUS (auto-approve + auto-deploy)
Target:         root@100.64.175.88 (Tailscale)
Target Project: xsjprd55
Duration:       5h max
Cycle:          3 (of ∞)
Status:         ✅ All items processed
Duration:       142s total
Changes:
  ✅ Fixed login timeout bug (commit abc123)
  ✅ Deployed v2.4.1 — healthy
  ✅ Updated nginx config — reloaded
Pending:
  ⏳ Database migration (waiting for next cycle)
```

## Extending

To add new autonomous behaviors, create additional skills in `.roo/skills/` and reference them from this skill's instructions.
