---
name: auto-deployer
description: 🤖 Auto-Deployer Bot — Self-retrying SSH deploy agent that kills stuck processes, auto-deploys when traffic is high, and keeps retrying until deployment succeeds
---

# Auto-Deployer Skill

## When To Use

Use this skill when:

- The user asks to **auto-deploy**, **keep deploying until it works**, or **make deployment automatic**
- The user says **"auto deploy after ssh fails"**, **"make a autodeployer agent bot"**, or **"keep deploying and killing ssh stucks until the deploy is successful"**
- The user wants **traffic-based auto-deploy** (deploy when traffic is high)
- The user is tired of **manually retrying failed SSH deploys** and wants a bot to handle it
- The user wants to **move on to other things** while deployment keeps retrying in the background

## Goal

Create a self-healing, self-retrying deployment bot that:

1. **Kills stuck SSH processes** automatically (detects hangs via timeout + ServerAlive)
2. **Retries failed deploys** with exponential backoff until success
3. **Auto-deploys when traffic is high** (monitors PM2 metrics, nginx logs, or API load)
4. **Reports deploy status** to the user so they can move on to other work
5. **Works as a global agent** — usable from any SuperRoo coding session

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Auto-Deployer Bot                           │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │  SSH Manager  │   │ Traffic      │   │  Retry       │    │
│  │  - Kill stuck │──▶│ Monitor      │──▶│  Engine      │    │
│  │  - Timeout    │   │ - PM2 stats  │   │  - Backoff   │    │
│  │  - Alive check│   │ - nginx logs │   │  - Max retry │    │
│  └──────────────┘   │ - API load   │   │  - Report    │    │
│                     └──────────────┘   └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## SSH Hang Prevention (Built-in)

Every SSH command MUST include these safeguards to prevent indefinite hangs:

```bash
# SSH options that prevent hanging
SSH_OPTS="-o StrictHostKeyChecking=no"
SSH_OPTS="$SSH_OPTS -o ConnectTimeout=15"        # Fail fast if host unreachable
SSH_OPTS="$SSH_OPTS -o ServerAliveInterval=15"    # Send keepalive every 15s
SSH_OPTS="$SSH_OPTS -o ServerAliveCountMax=3"     # Disconnect after 45s silence

# Wrap EVERY SSH command with timeout(1) to enforce per-command deadline
# If SSH hangs beyond the timeout, timeout(1) kills it
timeout <SECONDS> ssh $SSH_OPTS user@host "command"

# On Windows (no timeout command), use PowerShell:
#   $proc = Start-Process ssh -PassThru; Start-Sleep -Seconds <TIMEOUT>; if (!$proc.HasExited) { $proc.Kill() }
```

### Per-Command Timeout Defaults

| Operation           | Timeout | Why                                     |
| ------------------- | ------- | --------------------------------------- |
| SSH connection test | 15s     | Quick connectivity check                |
| git pull            | 60s     | Should be fast over existing connection |
| pnpm install        | 180s    | Network deps, but filtered installs     |
| pnpm build          | 300s    | Next.js build can be slow               |
| nginx test+reload   | 30s     | Config test is instant                  |
| pm2 restart         | 60s     | Service restart + health check          |
| pm2 status          | 30s     | Simple process list                     |
| SCP file transfer   | 30s     | Small config files only                 |
| pm2 logs            | 15s     | Just tail a few lines                   |

## Retry Engine

When a deploy step fails, the retry engine kicks in:

```bash
# Retry logic with exponential backoff
MAX_RETRIES=5
RETRY_DELAY=10  # seconds, doubles each retry

retry_deploy() {
    local attempt=1
    while [ $attempt -le $MAX_RETRIES ]; do
        echo "[ATTEMPT $attempt/$MAX_RETRIES] Deploying..."

        # Kill any stuck SSH processes from previous attempts
        kill_stuck_ssh

        # Run the deploy
        if run_deploy; then
            echo "[SUCCESS] Deploy succeeded on attempt $attempt"
            return 0
        fi

        # Calculate backoff: 10s, 20s, 40s, 80s, 160s
        local delay=$((RETRY_DELAY * (2 ** (attempt - 1))))
        echo "[RETRY] Attempt $attempt failed. Waiting ${delay}s before retry..."
        sleep $delay
        ((attempt++))
    done

    echo "[FAILED] All $MAX_RETRIES attempts exhausted"
    return 1
}
```

### Kill Stuck SSH Processes

```bash
# Kill ALL ssh.exe processes (Windows) or ssh (Linux/Mac)
kill_stuck_ssh() {
    case "$(uname -s)" in
        MINGW*|CYGWIN*|MSYS*)
            # Windows (Git Bash / MSYS2)
            taskkill /f /im ssh.exe 2>/dev/null || true
            ;;
        Linux|Darwin)
            # Linux / macOS
            pkill -9 ssh 2>/dev/null || true
            ;;
    esac
    echo "[SSH] Killed all stuck SSH processes"
}
```

## Traffic-Based Auto-Deploy

Monitor traffic levels to decide when to auto-deploy:

```bash
# Check if traffic is "high" based on nginx access logs
check_traffic_high() {
    local threshold=${1:-100}  # Default: 100 requests/min

    # Method 1: Check nginx access log for recent requests
    local recent_requests=$(ssh $SSH_OPTS $SSH_TARGET \
        "tail -1000 /var/log/nginx/access.log 2>/dev/null | \
         awk -v date=\"\$(date -d '1 minute ago' '+%d/%b/%Y:%H:%M')\" \
         '\$4 ~ date {count++} END {print count+0}'")

    if [ "$recent_requests" -ge "$threshold" ] 2>/dev/null; then
        echo "[TRAFFIC] High traffic detected: ${recent_requests} req/min (threshold: ${threshold})"
        return 0
    fi

    # Method 2: Check PM2 API metrics (if available)
    local api_metrics=$(ssh $SSH_OPTS $SSH_TARGET \
        "curl -sf http://localhost:3000/api/health 2>/dev/null | \
         python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"metrics\",{}).get(\"requestsPerMinute\",0))' 2>/dev/null || echo 0")

    if [ "$api_metrics" -ge "$threshold" ] 2>/dev/null; then
        echo "[TRAFFIC] High traffic via API metrics: ${api_metrics} req/min"
        return 0
    fi

    echo "[TRAFFIC] Normal traffic (${recent_requests:-0} req/min)"
    return 1
}
```

## Auto-Deploy Script

The auto-deploy script is at [`cloud/auto-deploy.sh`](cloud/auto-deploy.sh). It combines all the above into a single executable:

```bash
# One-shot auto-deploy (retries until success)
./cloud/auto-deploy.sh

# With custom thresholds
./cloud/auto-deploy.sh --traffic-threshold 200 --max-retries 10

# Run in background (move on to other work)
nohup ./cloud/auto-deploy.sh > auto-deploy.log 2>&1 &
echo "Auto-deploy running in background (PID: $!)"
echo "Check status: tail -f auto-deploy.log"
```

## Integration with Existing Deploy Scripts

The auto-deployer wraps the existing deploy scripts:

| Script                       | Location                                                                                   | Purpose                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `remote-deploy-dashboard.sh` | [`cloud/remote-deploy-dashboard.sh`](cloud/remote-deploy-dashboard.sh)                     | Single-shot deploy (called inside retry loop) |
| `deploy-dashboard.sh`        | [`cloud/deploy-dashboard.sh`](cloud/deploy-dashboard.sh)                                   | On-VPS deploy (called via SSH on VPS)         |
| `auto-deploy.sh`             | [`cloud/auto-deploy.sh`](cloud/auto-deploy.sh)                                             | **Auto-retry deploy (this is the bot)**       |
| `DeployOrchestrator.ts`      | [`src/super-roo/deploy/DeployOrchestrator.ts`](src/super-roo/deploy/DeployOrchestrator.ts) | TypeScript orchestrator                       |

## Usage from SuperRoo Chat

When the user says "auto deploy" or "keep deploying until it works":

1. Load this skill
2. Run `./cloud/auto-deploy.sh` in the background
3. Report back to the user that the bot is running
4. The bot will keep retrying, killing stuck SSH, and reporting progress
5. When done, notify the user of success or failure

## Safety Rules

1. **Always kill stuck SSH first** — before any deploy attempt, kill all previous SSH processes
2. **Never exceed max retries** — prevent infinite loops
3. **Report every attempt** — log each attempt so the user can check progress
4. **Don't auto-deploy without user intent** — only trigger on user request or explicit traffic threshold
5. **Respect maintenance windows** — if the user says "don't deploy now", respect it
6. **Keep deploy history** — record each attempt in `CommitDeployLog` for audit trail

## Output Format

When the auto-deployer runs, report:

```
🤖 Auto-Deployer Bot Report
━━━━━━━━━━━━━━━━━━━━━━━━━
Target:       root@104.248.225.250
Attempts:     3 (of 5 max)
Status:       ✅ SUCCESS on attempt 3
Duration:     142s total
Traffic:      250 req/min (high)
Steps:
  ✅ SSH connection test (2s)
  ✅ git pull (8s)
  ✅ pnpm install (45s)
  ✅ pnpm build (120s)
  ✅ pm2 restart (12s)
  ✅ pm2 status (3s)
Retries:
  ❌ Attempt 1: SSH timed out on pnpm install (killed)
  ❌ Attempt 2: Build failed (retrying)
  ✅ Attempt 3: All steps passed
```

## Extending for CI/CD

To make this a GitHub Action or cron job:

```yaml
# .github/workflows/auto-deploy.yml
name: Auto-Deploy
on:
    schedule:
        - cron: "*/30 * * * *" # Every 30 minutes
    workflow_dispatch:
        inputs:
            traffic_threshold:
                description: "Requests/min threshold"
                default: "100"

jobs:
    auto-deploy:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - name: Auto-Deploy
              run: |
                  chmod +x cloud/auto-deploy.sh
                  ./cloud/auto-deploy.sh --traffic-threshold ${{ github.event.inputs.traffic_threshold || '100' }}
              env:
                  SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
```
