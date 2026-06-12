#!/bin/bash
# deploy-ml-fixes.sh — Apply all ML gap fixes to VPS
# Runs ON the VPS after being copied via scp.
set -e
ROOT=/opt/superroo2
cd $ROOT

echo "=== SuperRoo ML Gap Fixes ==="

# 1. Pull latest code from git
echo "[1/6] Pulling latest code..."
git fetch origin main --quiet
git pull origin main --ff-only 2>&1 || echo "  (already up to date or manual merge needed)"

# 2. Verify NeuralNetwork.js is complete (check for module.exports)
echo "[2/6] Checking NeuralNetwork.js..."
if grep -q "module.exports" cloud/orchestrator/ml/NeuralNetwork.js; then
  echo "  ✅ NeuralNetwork.js has exports"
else
  echo "  ⚠️  NeuralNetwork.js still truncated — appending fix..."
  cat >> cloud/orchestrator/ml/NeuralNetwork.js << 'EOF'

// ─── Exports (appended by deploy-ml-fixes.sh) ────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { Tensor, DenseLayer, BatchNormLayer, ReLULayer, TanhLayer,
    SigmoidLayer, SoftmaxLayer, DropoutLayer, AdamOptimizer,
    MSELoss, CrossEntropyLoss, BinaryCrossEntropyLoss }
}
EOF
  echo "  ✅ Exports appended"
fi

# 3. Verify ML endpoints are public in auth.js
echo "[3/6] Checking ML endpoint auth..."
if grep -q "ml/model/upload.*return false" cloud/api/auth.js; then
  echo "  ✅ ML endpoints are public"
else
  echo "  Patching auth.js to make ML endpoints public..."
  # Find the lessons/export line and insert ML exceptions after it
  sed -i '/normalizedPath.startsWith.*lessons\/export.*return false/a\\n\t\/\/ ML sync endpoints — agent-to-agent, no user auth needed\n\tif (normalizedPath === "\/ml\/model\/upload") return false\n\tif (normalizedPath.startsWith("\/ml\/model\/latest")) return false\n\tif (normalizedPath === "\/ml\/observations\/sync") return false\n\tif (normalizedPath === "\/ml\/model\/merge") return false\n\tif (normalizedPath.startsWith("\/ml\/observations")) return false' cloud/api/auth.js
  echo "  ✅ auth.js patched"
fi

# 4. Ensure ML data directories exist
echo "[4/6] Setting up ML data directories..."
mkdir -p /root/.superroo/models /root/.superroo/brain
echo "  ✅ Directories ready"

# 5. Run initial ML training on VPS lessons if model doesn't exist
echo "[5/6] Checking ML model..."
if [ -f /root/.superroo/models/code-learner.json ]; then
  echo "  ✅ Model already trained"
else
  echo "  Training initial model on VPS lessons..."
  if [ -f memory/lesson-index.jsonl ]; then
    node scripts/train-central-ml.mjs --epochs=50 2>&1 | tail -5
    echo "  ✅ Initial model trained"
  else
    echo "  ⚠️  No lesson-index.jsonl found — skipping training"
  fi
fi

# 6. Restart API to pick up auth.js changes
echo "[6/6] Restarting superroo-api..."
pm2 restart superroo-api --update-env 2>&1 | tail -3
sleep 3
pm2 show superroo-api 2>&1 | grep -E "status|restarts|uptime" | head -5
echo "  ✅ API restarted"

echo ""
echo "=== All fixes applied ==="
echo "Test ML endpoint:"
echo "  curl http://localhost:8787/ml/model/latest"
