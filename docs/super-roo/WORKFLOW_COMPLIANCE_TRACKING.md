# SuperRoo Workflow Compliance Tracking

This document describes the workflow compliance tracking system that ensures the SuperRoo multi-agent workflow is followed correctly.

## Overview

The SuperRoo workflow defines specific roles for each AI model:

- **Codex/Claude (VS Code Extension)** = Planning and Review
- **DeepSeek** = Coding/Implementation
- **Ollama** = Lesson Summarization
- **Central Brain** = Persistent Memory Storage

The workflow compliance system tracks and enforces these assignments to ensure:

1. DeepSeek is used for coding tasks
2. API key usage is tracked and verifiable
3. All workflow phases are completed
4. Lessons are properly summarized and stored

## Components

### 1. CommitDeployLog (Enhanced)

**File**: [`src/super-roo/product-memory/CommitDeployLog.ts`](../../src/super-roo/product-memory/CommitDeployLog.ts)

The CommitDeployLog has been extended with:

- `ModelUsage[]` - Records which AI model was used for each workflow phase
- `WorkflowCompliance` - Tracks if the task followed the complete workflow
- DeepSeek-specific filtering and statistics

```typescript
interface ModelUsage {
	phase: "planning" | "coding" | "review" | "summarization" | "memory_storage"
	provider: string
	model: string
	apiKeyLast4?: string // For verification
	promptTokens?: number
	completionTokens?: number
	latencyMs?: number
	success: boolean
	fallbackUsed?: boolean
}

interface WorkflowCompliance {
	isCompliant: boolean
	steps: {
		lessonsRead: boolean
		deepseekDelegated: boolean
		codexReviewed: boolean
		ollamaSummarized: boolean
		centralBrainStored: boolean
	}
	violations: string[]
}
```

### 2. ModelUsageTracker

**File**: [`src/super-roo/product-memory/ModelUsageTracker.ts`](../../src/super-roo/product-memory/ModelUsageTracker.ts)

A dedicated service for logging and tracking AI model API calls:

**Features**:

- Real-time API call logging
- Token usage tracking
- Latency measurement
- Fallback detection
- DeepSeek delegation verification
- Task-level workflow compliance auditing

**Storage**:

- `server/src/memory/model-usage-log.json` - All API calls
- `server/src/memory/task-usage-summaries.json` - Task summaries

### 3. WorkflowEnforcer

**File**: [`src/super-roo/product-memory/WorkflowEnforcer.ts`](../../src/super-roo/product-memory/WorkflowEnforcer.ts)

Enforces workflow rules at runtime:

**Features**:

- Intercepts API calls before they're made
- Validates correct model for each phase
- Enforces DeepSeek delegation for coding (configurable: warn/block/log)
- Tracks API key usage (last 4 chars for verification)
- Generates compliance warnings/errors
- Provides fallback handling with logging

### 4. Compliance Checker Script

**File**: [`scripts/check-workflow-compliance.mjs`](../../scripts/check-workflow-compliance.mjs)

A command-line tool to check and report on workflow compliance:

```bash
# Check all commits
node scripts/check-workflow-compliance.mjs

# Check commits since specific date
node scripts/check-workflow-compliance.mjs --since "1 day ago"

# Check specific commit
node scripts/check-workflow-compliance.mjs --commit 4c7da1fbb

# Verify a specific API key was used
node scripts/check-workflow-compliance.mjs --verify-key ab12

# Show only non-compliant commits
node scripts/check-workflow-compliance.mjs --deepseek-only

# Generate detailed report
node scripts/check-workflow-compliance.mjs --report
```

## Configuration

### `.codex/config.toml`

```toml
[workflow_enforcement]
require_deepseek_for_coding = true
violation_action = "warn"  # Options: "warn", "block", "log_only"
require_api_key_tracking = true
require_all_phases = true
require_ollama_summary = true

[deepseek]
primary_api_key = "your-deepseek-api-key"
fallback_api_key = "your-fallback-key"
model = "deepseek-chat"
verify_key_usage = true
store_key_last4 = true

[api_tracking]
enabled = true
log_dir = "server/src/memory"
track_tokens = true
track_latency = true
track_api_keys = true
```

### Environment Variables

```bash
# DeepSeek API Keys
DEEPSEEK_API_KEY=your-primary-key
DEEPSEEK_API_KEY_FALLBACK=your-fallback-key

# Workflow Enforcement
SUPERROO_REQUIRE_DEEPSEEK=true
SUPERROO_VIOLATION_ACTION=warn
```

## Usage Examples

### Recording a Task with Full Workflow

```typescript
import { getWorkflowEnforcer } from "./src/super-roo/product-memory"

// Start task tracking
const enforcer = getWorkflowEnforcer()
enforcer.startTask("fix-login-bug-001")

// 1. Planning phase (Codex/Claude)
await enforcer.validateApiCall({
	phase: "planning",
	provider: "codex",
	model: "codex-latest",
})

// 2. Coding phase (DeepSeek) - This will be enforced
const validation = await enforcer.validateApiCall({
	phase: "coding",
	provider: "deepseek",
	model: "deepseek-chat",
	apiKey: process.env.DEEPSEEK_API_KEY,
})

// Log the actual DeepSeek call
await enforcer.logDeepseekDelegation(
	true, // success
	1234, // latency ms
	{ prompt: 100, completion: 50 }, // tokens
	false, // used fallback?
)

// 3. Review phase (Codex/Claude)
await enforcer.validateApiCall({
	phase: "review",
	provider: "codex",
	model: "codex-latest",
})

// 4. End task and get compliance report
const result = await enforcer.endTask()
console.log(`Compliant: ${result.isCompliant}`)
console.log(`Violations: ${result.violations}`)

// 5. Record commit with compliance data
await commitDeployLog.recordCommit({
	commitSha: "abc123",
	agent: "Codex",
	type: "bugfix",
	title: "Fix login bug",
	workflowCompliance: result.complianceData,
})
```

### Checking API Key Usage

```typescript
import { getModelUsageTracker } from "./src/super-roo/product-memory"

const tracker = getModelUsageTracker()

// Verify if specific API key was used
const wasUsed = await tracker.wasApiKeyUsed("ab12")
console.log(`API key ****ab12 was used: ${wasUsed}`)

// Get DeepSeek statistics
const stats = await tracker.getDeepSeekStats()
console.log(`DeepSeek delegation rate: ${stats.delegationRate * 100}%`)

// Get overall statistics
const allStats = await tracker.getStats()
console.log(`Total API calls: ${allStats.totalCalls}`)
console.log(`Fallback rate: ${allStats.fallbackRate * 100}%`)
```

## Workflow Compliance Report

The system generates detailed compliance reports showing:

- Total tasks analyzed
- Compliant vs non-compliant tasks
- DeepSeek usage rate
- Missing phases per task
- API key verification status
- Token usage and latency statistics

### Example Report Output

```
═══════════════════════════════════════════════════════════
       SUPERROO WORKFLOW COMPLIANCE REPORT
═══════════════════════════════════════════════════════════

📊 Summary Statistics

  Total commits analyzed:      42
  With model usage tracking:   38
  Using DeepSeek for coding:   35
  Skipped DeepSeek:            3
  With planning phase:         38
  With review phase:           36
  With Ollama summarization:   34
  Fully compliant:             32
  Non-compliant:               6

  Compliance rate:             76.2%

⚠️  NON-COMPLIANT COMMITS (DeepSeek not used)

  Commit: 4c7da1fbb
  Title:  fix: correct terminal output import path
  Date:   2026-05-17 08:43:14
  Agent:  Codex
  Actual: openai/gpt-4o

═══════════════════════════════════════════════════════════
```

## Integration with VS Code Extension

To integrate workflow tracking into the VS Code extension:

1. **Initialize the tracker on extension activation**:

```typescript
import { initializeModelUsageTracker, initializeWorkflowEnforcer } from "./src/super-roo/product-memory"
import { getEventLog } from "./src/super-roo/logging"

const events = getEventLog()
initializeModelUsageTracker(events)
initializeWorkflowEnforcer(events)
```

2. **Track API calls in your provider implementations**:

```typescript
// In your DeepSeek provider
async function callDeepSeek(request: ApiRequest) {
	const enforcer = getWorkflowEnforcer()

	// Validate this is a proper coding phase call
	const validation = await enforcer.validateApiCall({
		phase: "coding",
		provider: "deepseek",
		model: request.model,
		apiKey: request.apiKey,
	})

	if (!validation.approved) {
		throw new Error(`Workflow violation: ${validation.violation?.message}`)
	}

	// Make the actual API call
	const startTime = Date.now()
	const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
		// ... request config
	})
	const latencyMs = Date.now() - startTime()

	// Log the usage
	await enforcer.logDeepseekDelegation(
		response.ok,
		latencyMs,
		{
			prompt: response.usage.prompt_tokens,
			completion: response.usage.completion_tokens,
		},
		validation.violation?.fallbackUsed || false,
	)

	return response
}
```

## Testing

Run the tests:

```bash
# ModelUsageTracker tests
cd src && npx vitest run super-roo/product-memory/__tests__/ModelUsageTracker.test.ts

# WorkflowEnforcer tests
cd src && npx vitest run super-roo/product-memory/__tests__/WorkflowEnforcer.test.ts
```

## Troubleshooting

### Common Issues

**Issue**: "Workflow violation: Coding task must use DeepSeek"

**Solution**: Check your `.codex/config.toml`:

- Ensure `require_deepseek_for_coding = true`
- Set `violation_action = "warn"` to allow but warn, or `"log_only"` to just log
- Verify `DEEPSEEK_API_KEY` is set

**Issue**: "ModelUsageTracker not initialized"

**Solution**: Call `initializeModelUsageTracker()` before using the tracker:

```typescript
import { initializeModelUsageTracker } from "./src/super-roo/product-memory"
initializeModelUsageTracker(eventLog, "path/to/memory/dir")
```

**Issue**: API key verification always returns false

**Solution**:

- Ensure `store_key_last4 = true` in config
- Check that API calls are being logged through `logDeepSeekDelegation()`
- Verify the key you're checking matches the last 4 chars format

## Migration from Legacy System

If you have existing commits without workflow tracking:

```bash
# Run migration to add placeholder compliance data
node scripts/migrate-workflow-tracking.mjs

# Verify migration
node scripts/check-workflow-compliance.mjs --report
```

## Best Practices

1. **Always start a task** before making API calls
2. **Validate API calls** before making them to catch violations early
3. **Log all API calls** for complete tracking
4. **End tasks properly** to generate compliance reports
5. **Review compliance reports regularly** to identify workflow drift
6. **Use API key verification** to confirm the correct keys are being used

## Future Enhancements

- [ ] Automatic fallback to DeepSeek when other providers are used for coding
- [ ] Dashboard visualization of compliance metrics
- [ ] Real-time alerts for workflow violations
- [ ] Machine learning to predict optimal model routing
- [ ] Cost analysis per workflow phase
