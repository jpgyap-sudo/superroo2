/**
 * Workflow Tracking Integration Example
 *
 * This example demonstrates how to integrate the SuperRoo workflow
 * tracking system with DeepSeek API calls in a VS Code extension.
 *
 * The workflow ensures:
 * 1. Codex/Claude handles planning and review
 * 2. DeepSeek handles coding tasks
 * 3. Ollama summarizes lessons
 * 4. All API calls are tracked and verified
 */

import {
	CommitDeployLog,
	initializeModelUsageTracker,
	getModelUsageTracker,
	initializeWorkflowEnforcer,
	getWorkflowEnforcer,
} from "../src/super-roo/product-memory"
import type { EventLog } from "../src/super-roo/logging/EventLog"

// ── Types ─────────────────────────────────────────────────────────────────────

interface CodeGenerationRequest {
	taskId: string
	description: string
	filesToModify: string[]
	context?: string
}

interface CodeGenerationResult {
	success: boolean
	code?: string
	error?: string
	latencyMs: number
	tokensUsed: { prompt: number; completion: number }
}

// ── Configuration ─────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ""
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
const DEEPSEEK_MODEL = "deepseek-chat"

// ── Workflow Tracking Setup ───────────────────────────────────────────────────

/**
 * Initialize the workflow tracking system
 */
export function initializeWorkflowTracking(eventLog: EventLog, memoryDir?: string) {
	// Initialize the model usage tracker
	initializeModelUsageTracker(eventLog, memoryDir)

	// Initialize the workflow enforcer
	initializeWorkflowEnforcer(eventLog, {
		requireDeepseekForCoding: true,
		violationAction: "warn",
		requireApiKeyTracking: true,
		storeKeyLast4: true,
		deepseek: {
			primaryApiKey: DEEPSEEK_API_KEY,
			fallbackApiKey: process.env.DEEPSEEK_API_KEY_FALLBACK || "",
			model: DEEPSEEK_MODEL,
			maxTokens: 4096,
			timeoutMs: 30000,
			retryAttempts: 2,
		},
	})

	console.log("✅ Workflow tracking initialized")
}

// ── Workflow Implementation ───────────────────────────────────────────────────

/**
 * Complete workflow: Plan → Code (DeepSeek) → Review → Summarize
 */
export async function executeCodingWorkflow(
	request: CodeGenerationRequest,
	eventLog: EventLog,
): Promise<CodeGenerationResult> {
	const tracker = getModelUsageTracker()
	const enforcer = getWorkflowEnforcer()
	const commitLog = new CommitDeployLog(eventLog)

	// Step 1: Start workflow tracking
	console.log(`\n🚀 Starting workflow for task: ${request.taskId}`)
	enforcer.startTask(request.taskId)

	try {
		// Step 2: Planning Phase (Codex/Claude)
		console.log("\n📋 Phase 1: Planning...")
		await validateAndLogPhase(enforcer, "planning", "codex", "codex-latest")
		const plan = await generatePlan(request)

		// Step 3: Coding Phase (DeepSeek) - ENFORCED
		console.log("\n💻 Phase 2: Coding (DeepSeek)...")
		const validation = await enforcer.validateApiCall({
			phase: "coding",
			provider: "deepseek",
			model: DEEPSEEK_MODEL,
			apiKey: DEEPSEEK_API_KEY,
		})

		if (!validation.approved) {
			throw new Error(`Workflow violation: ${validation.violation?.message}`)
		}

		const startTime = Date.now()
		const result = await callDeepSeekAPI(request, plan)
		const latencyMs = Date.now() - startTime

		// Log the DeepSeek API call
		await enforcer.logDeepseekDelegation(
			result.success,
			latencyMs,
			result.tokensUsed,
			false, // fallback not used in this example
			result.error,
		)

		if (!result.success) {
			throw new Error(`DeepSeek API error: ${result.error}`)
		}

		// Step 4: Review Phase (Codex/Claude)
		console.log("\n🔍 Phase 3: Review...")
		await validateAndLogPhase(enforcer, "review", "codex", "codex-latest")
		await reviewCode(result.code!, request)

		// Step 5: End workflow and get compliance report
		console.log("\n📊 Phase 4: Workflow Completion...")
		const workflowResult = await enforcer.endTask()

		console.log(`\n✅ Workflow completed`)
		console.log(`   Compliant: ${workflowResult.isCompliant}`)
		console.log(`   Violations: ${workflowResult.violations.length}`)

		// Step 6: Record commit with workflow data
		await commitLog.recordCommit({
			commitSha: generateCommitSha(),
			agent: "Codex",
			type: "feature",
			title: `feat: ${request.description}`,
			filesChanged: request.filesToModify,
			workflowCompliance: workflowResult.complianceData,
		})

		return result
	} catch (error) {
		// End workflow even on error
		await enforcer.endTask()
		throw error
	}
}

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Validate phase and log to tracker
 */
async function validateAndLogPhase(
	enforcer: ReturnType<typeof getWorkflowEnforcer>,
	phase: "planning" | "coding" | "review" | "summarization",
	provider: string,
	model: string,
) {
	const validation = await enforcer.validateApiCall({
		phase,
		provider,
		model,
	})

	if (!validation.approved) {
		console.warn(`⚠️  Workflow violation: ${validation.violation?.message}`)
	}

	await enforcer.logApiCall({
		phase,
		provider,
		model,
		success: true,
		fallbackUsed: false,
	})
}

/**
 * Generate implementation plan (simulated - would be Codex/Claude)
 */
async function generatePlan(request: CodeGenerationRequest): Promise<string> {
	// In real implementation, this would call Codex/Claude
	return `Plan for: ${request.description}\nFiles: ${request.filesToModify.join(", ")}`
}

/**
 * Review generated code (simulated - would be Codex/Claude)
 */
async function reviewCode(code: string, request: CodeGenerationRequest): Promise<void> {
	// In real implementation, this would call Codex/Claude
	console.log(`   Reviewed ${code.length} characters of code`)
}

/**
 * Call DeepSeek API for code generation
 */
async function callDeepSeekAPI(request: CodeGenerationRequest, plan: string): Promise<CodeGenerationResult> {
	const prompt = buildPrompt(request, plan)

	try {
		const response = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
			},
			body: JSON.stringify({
				model: DEEPSEEK_MODEL,
				messages: [
					{
						role: "system",
						content: "You are an expert programmer. Generate clean, well-documented code.",
					},
					{
						role: "user",
						content: prompt,
					},
				],
				max_tokens: 4096,
				temperature: 0.3,
			}),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}))
			return {
				success: false,
				error: errorData.error?.message || `HTTP ${response.status}`,
				latencyMs: 0,
				tokensUsed: { prompt: 0, completion: 0 },
			}
		}

		const data = await response.json()
		const code = data.choices?.[0]?.message?.content

		return {
			success: true,
			code,
			latencyMs: 0, // Calculated by caller
			tokensUsed: {
				prompt: data.usage?.prompt_tokens || 0,
				completion: data.usage?.completion_tokens || 0,
			},
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			latencyMs: 0,
			tokensUsed: { prompt: 0, completion: 0 },
		}
	}
}

/**
 * Build prompt for DeepSeek
 */
function buildPrompt(request: CodeGenerationRequest, plan: string): string {
	return `
Task: ${request.description}

Plan:
${plan}

Files to modify: ${request.filesToModify.join(", ")}

${request.context ? `Context:\n${request.context}\n\n` : ""}

Please generate the implementation code.
`.trim()
}

/**
 * Generate a fake commit SHA for the example
 */
function generateCommitSha(): string {
	return Math.random().toString(36).substring(2, 10)
}

// ── Verification Functions ────────────────────────────────────────────────────

/**
 * Verify that a specific API key was used
 */
export async function verifyApiKeyUsage(keyLast4: string): Promise<boolean> {
	const tracker = getModelUsageTracker()
	return await tracker.wasApiKeyUsed(keyLast4)
}

/**
 * Get workflow compliance statistics
 */
export async function getComplianceStats() {
	const tracker = getModelUsageTracker()

	const [deepseekStats, overallStats, complianceReport] = await Promise.all([
		tracker.getDeepSeekStats(),
		tracker.getStats(),
		tracker.getWorkflowComplianceReport(),
	])

	return {
		deepseek: deepseekStats,
		overall: overallStats,
		compliance: complianceReport,
	}
}

// ── Example Usage ─────────────────────────────────────────────────────────────

async function main() {
	// Mock event log for the example
	const mockEventLog = {
		info: (msg: string, data?: unknown) => console.log(`[INFO] ${msg}`, data || ""),
		warn: (msg: string, data?: unknown) => console.warn(`[WARN] ${msg}`, data || ""),
		error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data || ""),
	} as EventLog

	// Initialize workflow tracking
	initializeWorkflowTracking(mockEventLog)

	// Example coding task
	const request: CodeGenerationRequest = {
		taskId: "example-task-001",
		description: "Add workflow tracking to API calls",
		filesToModify: ["src/api/provider.ts", "src/super-roo/product-memory/index.ts"],
		context: "Need to track DeepSeek API calls for compliance",
	}

	try {
		// Execute the full workflow
		const result = await executeCodingWorkflow(request, mockEventLog)

		console.log("\n" + "=".repeat(60))
		console.log("Result:")
		console.log(`  Success: ${result.success}`)
		console.log(`  Latency: ${result.latencyMs}ms`)
		console.log(`  Tokens: ${result.tokensUsed.prompt} prompt, ${result.tokensUsed.completion} completion`)

		// Verify API key was tracked
		const keyLast4 = DEEPSEEK_API_KEY.slice(-4)
		const wasUsed = await verifyApiKeyUsage(keyLast4)
		console.log(`\n  API Key (****${keyLast4}) tracked: ${wasUsed}`)

		// Get compliance stats
		const stats = await getComplianceStats()
		console.log(`\n  DeepSeek Delegation Rate: ${(stats.deepseek.delegationRate * 100).toFixed(1)}%`)
		console.log(`  Total Tasks: ${stats.compliance.totalTasks}`)
		console.log(`  Compliant Tasks: ${stats.compliance.compliantTasks}`)
	} catch (error) {
		console.error("\n❌ Workflow failed:", error)
	}
}

// Run the example if this file is executed directly
if (require.main === module) {
	main().catch(console.error)
}

// Note: Functions are exported above with 'export' keyword
// This file can be imported as:
// import { executeCodingWorkflow } from './workflow-tracking-integration'
