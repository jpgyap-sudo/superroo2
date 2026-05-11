---
name: autonomous
description: 🤖 Autonomous Mode — Self-directed scanning, reporting, auto-approval, and auto-deployment loop using Tailscale SSH
---

# Autonomous Skill (v2 — Auto-Pilot)

## Purpose

Enable the assistant to run as a **fully autonomous agent** that:

1. Self-directs scans and generates comprehensive status reports
2. **Auto-approves ALL code changes** — no human gates needed
3. **Auto-deploys ALL changes** — using Tailscale SSH (`100.64.175.88`)
4. Runs continuously in the background while the user sleeps

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

## ⚠️ Auto-Approval Mode

When Autonomous Mode is **ACTIVE**:

- **ALL approvals are auto-approved** — No human gates for code changes
- **ALL deployments are auto-run** — No human gates for deployments
- **Full discretion** — The agent can do everything in a loop
- **Container-first** — All changes must be tested in the sandbox FIRST
- **Automatic rollback** — Any test failure triggers immediate rollback
- **Automatic retry** — Failed attempts generate improved hypotheses
- **Automatic skill generation** — Failures create reusable skills
- **CommitDeployLog** — Every commit and deploy is recorded automatically

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

## Output Format

When autonomous mode runs, report:

```
🤖 Autonomous Mode Report
━━━━━━━━━━━━━━━━━━━━━━━━━
Mode:           AUTO-PILOT (auto-approve + auto-deploy)
Target:         root@100.64.175.88 (Tailscale)
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
