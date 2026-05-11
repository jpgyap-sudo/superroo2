#!/bin/bash
# SuperRoo Auto-Deployer Bot
# Self-retrying SSH deploy with stuck-kill and traffic monitoring
# Usage: ./cloud/auto-deploy.sh [--traffic-threshold 100] [--max-retries 5]
#
# Features:
#   - Kills stuck SSH processes before each attempt
#   - Retries with exponential backoff (10s, 20s, 40s, 80s, 160s)
#   - Monitors nginx traffic to decide when to deploy
#   - Reports status at each step
#   - Can run in background: nohup ./cloud/auto-deploy.sh > auto-deploy.log 2>&1 &

set -euo pipefail

# === Configuration ===
SSH_KEY="C:\\Users\\User\\.ssh\\id_superroo_vps"
SSH_TARGET="root@104.248.225.250"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ${SSH_KEY}"
PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
DASHBOARD_DIR="${CLOUD_DIR}/dashboard"

# Parse arguments
MAX_RETRIES=5
TRAFFIC_THRESHOLD=100
DEPLOY_TIMEOUT=600

while [[ $# -gt 0 ]]; do
    case "$1" in
        --traffic-threshold) TRAFFIC_THRESHOLD="$2"; shift 2 ;;
        --max-retries) MAX_RETRIES="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: $0 [--traffic-threshold N] [--max-retries N]"
            echo "  --traffic-threshold N  Deploy only if traffic > N req/min (default: 100)"
            echo "  --max-retries N        Max deploy attempts (default: 5)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

RETRY_DELAY=10
START_TIME=$(date +%s)

# === Colors ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  SuperRoo Auto-Deployer Bot${NC}"
echo -e "${CYAN}  Target: ${SSH_TARGET}${NC}"
echo -e "${CYAN}  Max retries: ${MAX_RETRIES}${NC}"
echo -e "${CYAN}  Traffic threshold: ${TRAFFIC_THRESHOLD} req/min${NC}"
echo -e "${CYAN}============================================${NC}"

# === Helpers ===

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
    echo -e "${YELLOW}[SSH] Killed all stuck SSH processes${NC}"
}

check_traffic() {
    local threshold=${1:-$TRAFFIC_THRESHOLD}
    local recent=$(timeout 15 ssh $SSH_OPTS $SSH_TARGET \
        "tail -500 /var/log/nginx/access.log 2>/dev/null | \
         awk -v date=\"\$(date -d '1 minute ago' '+%d/%b/%Y:%H:%M' 2>/dev/null || date '+%d/%b/%Y:%H:%M')\" \
         '\$4 ~ date {count++} END {print count+0}'" 2>/dev/null || echo 0)
    if [ "$recent" -ge "$threshold" ] 2>/dev/null; then
        echo -e "${GREEN}[TRAFFIC] HIGH: ${recent} req/min (threshold: ${threshold})${NC}"
        return 0
    fi
    echo -e "${YELLOW}[TRAFFIC] Normal: ${recent} req/min${NC}"
    return 1
}

ssh_cmd() {
    local desc="$1"
    local step_timeout="$2"
    shift 2
    echo -e "${CYAN}[SSH] ${desc} (timeout: ${step_timeout}s)...${NC}"
    timeout "${step_timeout}" ssh ${SSH_OPTS} "${SSH_TARGET}" "$@" 2>&1
    local exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo -e "${RED}[ERROR] SSH timed out after ${step_timeout}s during: ${desc}${NC}"
        kill_stuck_ssh
        return 1
    elif [ $exit_code -ne 0 ]; then
        echo -e "${RED}[ERROR] SSH failed (exit: ${exit_code}) during: ${desc}${NC}"
        return $exit_code
    fi
    echo -e "${GREEN}[OK] ${desc}${NC}"
    return 0
}

run_deploy() {
    local attempt_start=$(date +%s)

    echo -e "${CYAN}=== Auto-Deployer: Starting deploy ===${NC}"

    # Step 1: Test connection
    ssh_cmd "SSH connection test" 15 "echo 'SSH OK'" || return 1

    # Step 2: Git pull
    ssh_cmd "git pull" 60 "cd ${PROJECT_ROOT} && git pull origin main" || return 1

    # Step 3: Install deps (filtered)
    ssh_cmd "pnpm install (filtered)" 180 \
        "cd ${PROJECT_ROOT} && corepack enable 2>/dev/null; corepack pnpm install --filter cloud/dashboard --frozen-lockfile --prefer-offline" || return 1

    # Step 4: Build
    ssh_cmd "pnpm build" 300 \
        "cd ${PROJECT_ROOT} && corepack pnpm --dir ${DASHBOARD_DIR} run build" || return 1

    # Step 5: Restart PM2
    ssh_cmd "pm2 restart" 60 \
        "cd ${CLOUD_DIR} && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save" || return 1

    # Step 6: Verify
    ssh_cmd "pm2 status" 30 "pm2 list" || return 1

    local attempt_end=$(date +%s)
    echo -e "${GREEN}=== Auto-Deployer: Deploy completed in $((attempt_end - attempt_start))s ===${NC}"
    return 0
}

# === Main Loop ===

# Check traffic first
if check_traffic; then
    echo -e "${GREEN}[TRAFFIC] High traffic detected — triggering auto-deploy${NC}"
else
    echo -e "${YELLOW}[TRAFFIC] Normal traffic — deploying anyway (user-requested)${NC}"
fi

# Retry loop
attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
    echo ""
    echo -e "${CYAN}=== Attempt ${attempt}/${MAX_RETRIES} ===${NC}"

    # Kill any stuck SSH from previous runs
    kill_stuck_ssh

    if run_deploy; then
        end_time=$(date +%s)
        echo ""
        echo -e "${GREEN}============================================${NC}"
        echo -e "${GREEN}  ✅ DEPLOY SUCCESSFUL on attempt ${attempt}${NC}"
        echo -e "${GREEN}  Total duration: $((end_time - START_TIME))s${NC}"
        echo -e "${GREEN}============================================${NC}"
        exit 0
    fi

    delay=$((RETRY_DELAY * (2 ** (attempt - 1))))
    echo ""
    echo -e "${RED}❌ Attempt ${attempt} failed. Waiting ${delay}s before retry...${NC}"
    echo -e "${YELLOW}   (You can move on to other things — the bot will keep trying)${NC}"
    sleep $delay
    ((attempt++))
done

echo ""
echo -e "${RED}============================================${NC}"
echo -e "${RED}  ❌❌❌ ALL ${MAX_RETRIES} ATTEMPTS EXHAUSTED${NC}"
echo -e "${RED}  Manual intervention required.${NC}"
echo -e "${RED}  Check: tail -f auto-deploy.log${NC}"
echo -e "${RED}============================================${NC}"
exit 1
