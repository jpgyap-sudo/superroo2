#!/bin/bash
#
# Deploy Intelligence Layer to SuperRoo VPS via Tailscale SSH
#

set -e

# Configuration
SSH_KEY="C:\Users\User\.ssh\id_superroo_vps"
SSH_TARGET="root@100.64.175.88"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ${SSH_KEY}"
VPS_PATH="/opt/superroo2"
COMMIT_SHA="${1:-$(git rev-parse HEAD)}"

echo "════════════════════════════════════════════════════════════"
echo "Deploying Intelligence Layer via Tailscale SSH"
echo "════════════════════════════════════════════════════════════"
echo "Target: ${SSH_TARGET}"
echo "Commit: ${COMMIT_SHA}"
echo ""

# Test Tailscale SSH connection
echo "🔍 Testing Tailscale SSH connection..."
if ! timeout 15 ssh ${SSH_OPTS} ${SSH_TARGET} "echo 'Tailscale SSH OK' && hostname"; then
    echo "❌ Failed to connect via Tailscale SSH"
    echo "   Ensure Tailscale is running on both local machine and VPS"
    exit 1
fi
echo "✅ Tailscale SSH connection successful"
echo ""

# Deploy to VPS
echo "🚀 Deploying intelligence layer changes..."
timeout 60 ssh ${SSH_OPTS} ${SSH_TARGET} << EOF
    set -e
    
    echo "📂 Changing to ${VPS_PATH}..."
    cd ${VPS_PATH}
    
    echo "📥 Pulling latest changes..."
    git fetch origin
    git checkout ${COMMIT_SHA} || git pull origin fix/webview-recovery
    
    echo "📊 Verifying intelligence files..."
    ls -la memory/
    wc -l memory/lesson-index.jsonl
    
    echo "📝 Recording deployment..."
    if [ -f "server/src/memory/commit-deploy-log.json" ]; then
        echo "Deployment of ${COMMIT_SHA} recorded at \$(date -Iseconds)" >> /tmp/deploy-log.txt
    fi
    
    echo "✅ Deployment complete!"
EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "✅ Deployment Successful!"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "Deployed files:"
    echo "  - memory/lessons-learned.md"
    echo "  - memory/bugs-fixed.md"
    echo "  - memory/model-decisions.md"
    echo "  - memory/lesson-index.jsonl"
    echo "  - src/super-roo/lessons/"
    echo "  - scripts/*-lesson*.mjs"
    echo ""
    echo "Commit: ${COMMIT_SHA}"
    echo "Deployed via Tailscale: 100.64.175.88"
else
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "❌ Deployment Failed"
    echo "════════════════════════════════════════════════════════════"
    exit 1
fi
