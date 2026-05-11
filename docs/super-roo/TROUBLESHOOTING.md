# SuperRoo Troubleshooting Guide

> **Last updated**: 2026-05-11  
> **Applies to**: SuperRoo v2.x (Healing Module, ML Engine, Cloud Dashboard)

This guide covers common issues across the SuperRoo ecosystem and how to resolve them.

---

## Table of Contents

1. [Healing Module Issues](#1-healing-module-issues)
    - [Auto-fixes aren't working](#auto-fixes-arent-working)
    - [Circuit breaker is open](#circuit-breaker-is-open)
    - [How to check healing metrics](#how-to-check-healing-metrics)
    - [How to manually trigger healing](#how-to-manually-trigger-healing)
    - [How to reset the circuit breaker](#how-to-reset-the-circuit-breaker)
2. [ML Engine Issues](#2-ml-engine-issues)
    - [Learning rate too high/low](#learning-rate-too-highlow)
    - [Vanishing gradients](#vanishing-gradients)
    - [Model not converging](#model-not-converging)
    - [Checkpoint load failures](#checkpoint-load-failures)
3. [Log Aggregator Issues](#3-log-aggregator-issues)
    - [How to read LogAggregator output](#how-to-read-logaggregator-output)
    - [Logs not being written](#logs-not-being-written)
4. [Dashboard Connectivity Issues](#4-dashboard-connectivity-issues)
5. [Deployment Issues](#5-deployment-issues)
6. [Common Error Codes](#6-common-error-codes)

---

## 1. Healing Module Issues

### Auto-fixes aren't working

**Symptoms**: Incidents remain in `"new"` or `"investigating"` status and are never auto-fixed.

**Checklist**:

1. **Verify the SelfHealingLoop is running**

    ```typescript
    const stats = loop.getStats()
    console.log(stats.isRunning) // Should be true
    console.log(stats.circuitBreakerOpen) // Should be false
    ```

2. **Check auto-fix policies**
   The [`SelfHealingLoop`](src/super-roo/healing/SelfHealingLoop.ts) (line 61) has per-severity policies. By default, only `low` severity is auto-fixed:

    ```typescript
    autoFixPolicies: {
      low: true,        // Auto-fix low severity
      medium: false,    // Suggest only
      high: false,      // Suggest only
      critical: false,  // Suggest only
    }
    ```

    To enable auto-fix for higher severities, update the config when creating the loop.

3. **Check if suggestion-only mode is on**

    ```typescript
    suggestionOnly: false // Must be false for auto-fixes
    ```

4. **Check the circuit breaker**
   If `stats.circuitBreakerOpen === true`, the loop has paused due to consecutive failures. See [Circuit breaker is open](#circuit-breaker-is-open).

5. **Check escalation policy**
   If an incident has been reopened more than `maxRetries` (default: 3), the escalation policy may have blocked it:
    ```typescript
    escalationPolicy: {
      maxRetries: 3,
      escalationAction: "block",  // or "warn" | "notify" | "circuit_breaker"
      skipAutoRepair: true,
    }
    ```

### Circuit breaker is open

**Symptoms**: The healing loop logs show "Circuit breaker is open" and incidents are not being processed.

**Cause**: The circuit breaker opens after `circuitBreakerThreshold` (default: 5) consecutive cycle failures. This prevents resource burn on systemic issues.

**Resolution**:

1. **Check the failure count**

    ```typescript
    const stats = loop.getStats()
    console.log(stats.consecutiveFailures) // Should be >= 5
    ```

2. **Investigate the root cause**
   Check the [`LogAggregator`](src/super-roo/infrastructure/LogAggregator.ts) for error patterns:

    ```typescript
    const errors = await aggregator.query({
    	source: "healing",
    	level: "error",
    	limit: 20,
    })
    ```

3. **Reset the circuit breaker**

    ```typescript
    loop.resetCircuitBreaker()
    ```

    Or via the monitoring API:

    ```bash
    curl -X POST http://localhost:8787/api/monitoring/reset-circuit-breaker
    ```

4. **Wait for automatic recovery**
   The circuit breaker automatically transitions to half-open after `circuitBreakerTimeoutMs` (default: 5 minutes). If the next cycle succeeds, it closes.

### How to check healing metrics

The [`HealingMetrics`](src/super-roo/healing/HealingMetrics.ts) class persists success/failure rates to `memory/healing-metrics.json`.

**Programmatic access**:

```typescript
import { HealingMetrics } from "../healing"

const metrics = new HealingMetrics()

// Overall stats
console.log(`Success rate: ${(metrics.getOverallSuccessRate() * 100).toFixed(1)}%`)
console.log(`Total attempts: ${metrics.getTotalAttempts()}`)
console.log(`Total successes: ${metrics.getTotalSuccesses()}`)
console.log(`Total failures: ${metrics.getTotalFailures()}`)

// Per-category stats
const allCats = metrics.getAllCategoryMetrics()
for (const [category, catMetrics] of allCats) {
	const rate = ((catMetrics.successCount / catMetrics.totalAttempts) * 100).toFixed(1)
	console.log(`${category}: ${catMetrics.successCount}/${catMetrics.totalAttempts} (${rate}%)`)
}
```

**Via the monitoring API**:

```bash
# Get healing metrics
curl http://localhost:8787/api/monitoring/stats

# Get healing metrics (dedicated endpoint)
curl http://localhost:8787/api/healing-metrics
```

**From the persisted file**:

```bash
cat memory/healing-metrics.json
```

Example output:

```json
{
	"byCategory": {
		"BROKEN_ROUTE": { "successCount": 17, "failureCount": 3, "totalAttempts": 20 },
		"ENV_MISSING": { "successCount": 12, "failureCount": 1, "totalAttempts": 13 },
		"DEPLOY_DRIFT": { "successCount": 5, "failureCount": 4, "totalAttempts": 9 }
	},
	"overall": { "successCount": 34, "failureCount": 8, "totalAttempts": 42 },
	"lastUpdated": 1712345678901
}
```

### How to manually trigger healing

If the auto-loop is not running or you want to process incidents immediately:

```typescript
// Process all pending incidents right now
await loop.processPendingIncidents()
```

Or report an incident directly via the [`HealingBus`](src/super-roo/healing/HealingBus.ts):

```typescript
const bus = new HealingBus(memory, events)
const incident = await bus.reportIncident({
	title: "Manual test incident",
	symptom: "Testing healing pipeline",
	severity: "low",
	sourceAgent: "human",
})
```

### How to reset the circuit breaker

**Programmatic**:

```typescript
loop.resetCircuitBreaker()
```

**Via API**:

```bash
curl -X POST http://localhost:8787/api/monitoring/reset-circuit-breaker
```

**Direct state manipulation** (last resort):

```typescript
const stats = loop.getStats()
// Access the private stats object via the getter
// Then modify: this only works if you have access to the loop instance
```

---

## 2. ML Engine Issues

### Learning rate too high/low

**Symptoms**:

- **Too high**: Loss oscillates or diverges (NaN, Infinity)
- **Too low**: Loss decreases very slowly or not at all

**Diagnosis**:

```typescript
// Track loss values during training
const losses = model.train(X, y, lossFn, {
	epochs: 100,
	batchSize: 32,
	learningRate: 0.001,
	onEpoch: (epoch, trainLoss) => {
		if (epoch % 10 === 0) {
			console.log(`Epoch ${epoch}: loss=${trainLoss}`)
		}
		// Detect divergence
		if (isNaN(trainLoss) || !isFinite(trainLoss)) {
			console.error("Loss diverged! LR too high.")
			return true // Stop training
		}
		return false
	},
})
```

**Fixes**:

| Symptom                      | Action             | Typical LR                         |
| ---------------------------- | ------------------ | ---------------------------------- |
| Loss oscillates              | Reduce LR by 10×   | Try 0.0001 instead of 0.001        |
| Loss diverges to NaN         | Reduce LR by 100×  | Try 0.00001                        |
| Loss barely changes          | Increase LR by 10× | Try 0.01                           |
| Loss decreases then plateaus | Use LR scheduler   | Add StepDecay or ReduceLROnPlateau |

**Using LR schedulers**:

```typescript
import { StepDecayScheduler, ReduceLROnPlateau } from "../ml/engine"

// Option 1: Step decay
const scheduler = new StepDecayScheduler({
	initialLR: 0.01,
	dropFactor: 0.1,
	stepSize: 20, // Drop every 20 epochs
})

// Option 2: Adaptive reduction
const scheduler = new ReduceLROnPlateau({
	initialLR: 0.01,
	factor: 0.5, // Gentler reduction
	patience: 5, // Wait 5 epochs
})

// Attach to optimizer
const opt = new AdamOptimizer(params, 0.9, 0.999, 1e-8, scheduler)
```

### Vanishing gradients

**Symptoms**: Early layers' gradients are near zero, loss stops decreasing despite high LR.

**Root causes**:

1. Using Sigmoid/Tanh with deep networks (saturating activations)
2. Improper weight initialization
3. Network too deep for the task

**Fixes**:

1. **Use ReLU instead of Sigmoid/Tanh**:

    ```typescript
    const model = new NeuralNetwork({
    	activation: "relu", // Instead of "sigmoid" or "tanh"
    })
    ```

2. **Use proper weight initialization**:

    ```typescript
    // He init for ReLU layers
    const dense = new DenseLayer(128, 64, "he")

    // Xavier init for tanh/softmax layers
    const dense = new DenseLayer(128, 64, "xavier")
    ```

3. **Add Batch Normalization**:

    ```typescript
    const model = new NeuralNetwork({
    	useBatchNorm: true,
    })
    ```

4. **Reduce network depth** — fewer layers with more neurons per layer.

### Model not converging

**Symptoms**: Loss stays flat or decreases very slowly regardless of LR tuning.

**Checklist**:

1. **Data normalization**: Are inputs normalized to ~[-1, 1] or [0, 1]?

    ```typescript
    // Normalize inputs
    const mean = X.mean(0)
    const std = X.sub(mean).mul(X.sub(mean)).mean(0) // Variance
    // X_norm = (X - mean) / sqrt(std)
    ```

2. **Label format**: Are classification targets one-hot encoded?

    ```typescript
    // Correct for CrossEntropyLoss:
    // y = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    ```

3. **Batch size**: Too large can cause slow convergence. Try smaller batches.

4. **Network capacity**: Too few neurons can't learn the pattern. Increase `hiddenDims`.

5. **Check for data leakage**: Are you using the same data for train and validation?

### Checkpoint load failures

**Symptoms**: `ModelCheckpoint.load()` throws errors or returns null.

**Common causes and fixes**:

| Error                                | Cause                                                 | Fix                                                         |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| `"Unsupported checkpoint version"`   | Checkpoint was saved with a different version         | Re-train or migrate the checkpoint format                   |
| `"Layer N parameter count mismatch"` | Model architecture changed since checkpoint was saved | Ensure the model config matches the checkpoint              |
| `"Shape mismatch loading layer N"`   | Layer dimensions changed                              | Rebuild model with original dimensions                      |
| `ENOENT`                             | Checkpoint file doesn't exist                         | Check the file path; train the model first                  |
| `JSON.parse` error                   | Corrupted checkpoint file                             | Delete and re-save; use atomic writes (already implemented) |

```typescript
// Safe loading with fallback
const ckpt = new ModelCheckpoint({ dir: "./checkpoints", name: "my_model" })
const data = await ckpt.load(layers, optimizer)
if (!data) {
	console.warn("No checkpoint found, starting from scratch")
	// Train from scratch
} else {
	console.log(`Loaded checkpoint from epoch ${data.metadata?.epoch}`)
}
```

---

## 3. Log Aggregator Issues

### How to read LogAggregator output

The [`LogAggregator`](src/super-roo/infrastructure/LogAggregator.ts) writes to JSONL files in `logs/superroo-YYYY-MM-DD.jsonl`.

**Via the query API**:

```typescript
const logs = await aggregator.query({
	source: "healing",
	level: "error",
	from: Date.now() - 3600000, // Last hour
	limit: 50,
})

for (const entry of logs.entries) {
	console.log(`[${entry.timestamp}] [${entry.source}] ${entry.message}`)
	if (entry.metadata) console.log(entry.metadata)
}
```

**Via the monitoring API**:

```bash
# Get recent logs
curl http://localhost:8787/api/monitoring/logs

# Get monitoring stats
curl http://localhost:8787/api/monitoring/stats

# Get health timeline
curl http://localhost:8787/api/monitoring/health-timeline
```

**Direct file access**:

```bash
# View today's logs
cat logs/superroo-2026-05-11.jsonl

# Search for errors
findstr "error" logs/superroo-2026-05-11.jsonl

# Count log entries by level
findstr /R "^" logs/superroo-2026-05-11.jsonl | find /C /V ""
```

### Logs not being written

**Checklist**:

1. **Is the aggregator started?**

    ```typescript
    aggregator.start() // Must be called to begin periodic flush
    ```

2. **Check the logs directory exists**
   Default: `./logs/`. The aggregator creates it on first flush, but ensure write permissions.

3. **Check buffer size**
   The aggregator flushes when buffer reaches `maxBufferSize` (default: 100) or every `flushIntervalMs` (default: 5000ms). Small workloads may not trigger a flush for up to 5 seconds.

4. **Force a flush**

    ```typescript
    await aggregator.flush() // Force immediate write
    ```

5. **Check retention policy**
   Logs older than `retentionDays` (default: 30) are automatically cleaned up on start.

---

## 4. Dashboard Connectivity Issues

**Symptoms**: Cloud dashboard shows "Connection lost" or fails to load.

**Checklist**:

1. **Is the API server running?**

    ```bash
    curl http://localhost:8787/api/monitoring/health-timeline
    # Should return JSON with health data
    ```

2. **Check the API logs**

    ```bash
    ssh root@100.64.175.88 "tail -50 /var/log/superroo-api.log"
    ```

3. **Is the daemon running?**

    ```bash
    ssh root@100.64.175.88 "systemctl status superroo-daemon --no-pager"
    ```

4. **Check port binding**

    ```bash
    ssh root@100.64.175.88 "lsof -i :8787"
    ```

5. **Restart the API**

    ```bash
    ssh root@100.64.175.88 "kill -9 \$(lsof -ti:8787) 2>/dev/null; sleep 2; cd /opt/superroo2/cloud/api && nohup node api.js > /var/log/superroo-api.log 2>&1 &"
    ```

6. **Check Tailscale connectivity**
    ```bash
    tailscale status
    # Ensure 100.64.175.88 is reachable
    ```

---

## 5. Deployment Issues

See the [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for full deployment instructions.

**Quick checks**:

| Symptom                     | Check                                                       |
| --------------------------- | ----------------------------------------------------------- |
| SSH fails                   | Is Tailscale running? `tailscale status`                    |
| `pnpm install` fails        | Node.js version? `node --version` (should be 20.x)          |
| Daemon won't start          | Check env file: `/etc/superroo/superroo.env`                |
| Telegram bot not responding | Is `TELEGRAM_BOT_TOKEN` set? Is the bridge service running? |
| Auto-deploy not triggering  | Check GitHub Actions logs; check auto-deployer worker       |

---

## 6. Common Error Codes

| Code   | Meaning                           | Action                                 |
| ------ | --------------------------------- | -------------------------------------- |
| `E001` | Healing circuit breaker open      | Wait for timeout or reset manually     |
| `E002` | Incident escalation limit reached | Review escalation policy config        |
| `E003` | ML checkpoint version mismatch    | Re-train or migrate checkpoint         |
| `E004` | LogAggregator flush failed        | Check disk space and write permissions |
| `E005` | API server not responding         | Restart the API service                |
| `E006` | Tailscale SSH connection failed   | Check Tailscale status and IP          |
| `E007` | Model training diverged           | Reduce learning rate                   |
| `E008` | Feature vector dimension mismatch | Check learner input dimensions         |

---

## See Also

- [`ML_ENGINE_API.md`](ML_ENGINE_API.md) — ML engine API reference
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Healing module usage guide
- [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) — System architecture diagrams
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Deployment instructions
- [`src/super-roo/healing/`](src/super-roo/healing/) — Healing module source
- [`src/super-roo/ml/engine/`](src/super-roo/ml/engine/) — ML engine source
