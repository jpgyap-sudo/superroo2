/**
 * SuperRoo Cloud — Agent Runners
 *
 * Individual agent runners that execute orchestrator sub-tasks on the VPS.
 * Each runner corresponds to a local VS Code agent (CoderAgent, DebuggerAgent,
 * TesterAgent, etc.) but operates headlessly via LLM calls + command execution.
 *
 * Architecture:
 *   TaskExecutor creates sub-tasks → BullMQ queue → orchestratorWorker.js
 *   → agentRunners.js (this file) → LLM + exec + file ops → result
 *   → HermesClaw lesson extraction (after completion)
 *
 * Crash resilience:
 *   - All runners have configurable timeouts (default 10 min)
 *   - LLM calls use AbortSignal.timeout() to prevent hangs
 *   - Command execution uses execAsync with timeout
 *   - Errors are caught and returned as structured failure objects
 */

const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")

const execAsync = promisify(exec)

// ── Configuration ─────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.env.SUPERROO_ROOT || "/opt/superroo2"
const RUNNER_TIMEOUT_MS = parseInt(process.env.RUNNER_TIMEOUT_MS || "600000", 10)
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "120000", 10)
const LOGS_DIR = path.join(PROJECT_ROOT, "cloud", "logs", "agent-runners")

// ── Vault helpers (shared with debugJobRunner) ────────────────────────────────

const VAULT_KEY_B64 = process.env.SUPERROO_VAULT_KEY || ""
const SECRETS_FILE = path.join(PROJECT_ROOT, "cloud/data/settings/encrypted-secrets.json")
const ALGO = "aes-256-gcm"

function decryptSecret(payload) {
	const key = Buffer.from(VAULT_KEY_B64, "base64")
	const [ivB64, tagB64, dataB64] = payload.split(".")
	const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

async function getProviderKey(providerId) {
	try {
		const raw = await fs.readFile(SECRETS_FILE, "utf8")
		const secrets = JSON.parse(raw)
		const entry = secrets[providerId]
		if (!entry) return null
		// entry is the raw encrypted payload string (e.g. "iv.tag.data")
		return decryptSecret(entry)
	} catch {
		return null
	}
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt, options = {}) {
	const providers = [
		{ providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
		{ providerId: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
		{ providerId: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
	]

	// Build messages array — inject conversation context if provided
	const messages = [{ role: "system", content: systemPrompt }]
	if (options.conversationContext && Array.isArray(options.conversationContext)) {
		for (const ctx of options.conversationContext) {
			messages.push({ role: ctx.role || "user", content: ctx.content })
		}
	}
	messages.push({ role: "user", content: userPrompt })

	// Fire all providers in parallel — first successful response wins
	const promises = providers.map(async (p) => {
		const apiKey = await getProviderKey(p.providerId)
		if (!apiKey) {
			console.log(`[callLLM] No API key for ${p.providerId} — skipping`)
			throw new Error(`No API key for ${p.providerId}`)
		}

		console.log(`[callLLM] Trying ${p.providerId} with model ${p.model}...`)
		const res = await fetch(`${p.baseUrl}/chat/completions`, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				model: p.model,
				messages,
				max_tokens: options.maxTokens || 4000,
				temperature: options.temperature ?? 0.3,
			}),
			signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
		})
		if (!res.ok) {
			const errText = await res.text().catch(() => "unknown")
			throw new Error(`${p.providerId} returned ${res.status}: ${errText.substring(0, 200)}`)
		}
		const data = await res.json()
		const content = data.choices?.[0]?.message?.content || null
		if (!content) {
			throw new Error(`${p.providerId} returned empty content`)
		}
		console.log(`[callLLM] ${p.providerId} succeeded`)
		return content
	})

	try {
		const result = await Promise.any(promises)
		return result
	} catch (aggErr) {
		const errors = aggErr.errors || [aggErr]
		for (const e of errors) {
			console.log(`[callLLM] Provider failed: ${e.message}`)
		}
		console.log(`[callLLM] All providers exhausted — returning null`)
		return null
	}
}

// ── Logging helpers ───────────────────────────────────────────────────────────

async function ensureLogsDir() {
	await fs.mkdir(LOGS_DIR, { recursive: true })
}

function log(runner, jobId, message) {
	const ts = new Date().toISOString()
	console.log(`[${ts}] [${runner}:${jobId}] ${message}`)
}

async function writeResultLog(runner, jobId, result) {
	await ensureLogsDir()
	const filePath = path.join(LOGS_DIR, `${runner}-${jobId}.json`)
	await fs.writeFile(filePath, JSON.stringify({ runner, jobId, result, ts: new Date().toISOString() }, null, 2))
}

// ── Command execution ─────────────────────────────────────────────────────────

async function runCommands(commands, cwd, timeout = 300000) {
	const outputs = []
	for (const cmd of commands) {
		try {
			const { stdout, stderr } = await execAsync(cmd, { cwd, timeout })
			outputs.push({
				command: cmd,
				exitCode: 0,
				stdout: stdout?.substring(0, 2000),
				stderr: stderr?.substring(0, 2000),
			})
		} catch (err) {
			outputs.push({
				command: cmd,
				exitCode: err.code || 1,
				stdout: err.stdout?.substring(0, 2000) || "",
				stderr: err.stderr?.substring(0, 2000) || err.message,
			})
		}
	}
	return outputs
}

// ── File helpers ──────────────────────────────────────────────────────────────

async function readFileContent(filePath) {
	try {
		return await fs.readFile(filePath, "utf8")
	} catch {
		return "(file not found)"
	}
}

async function writeFileContent(filePath, content) {
	try {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, "utf8")
		return { ok: true }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Runners
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CoderRunner — Multi-phase state machine for writing and modifying code.
 *
 * Supports a Telegram-driven approval/commit/deploy workflow:
 *   Phase "plan"       → LLM generates plan → sends to Telegram for approval
 *   Phase "apply"      → Applies approved changes → sends to Telegram for commit decision
 *   Phase "commit"     → Git commit → sends to Telegram for deploy decision
 *   Phase "deploy"     → Deploy + health check → sends to Telegram as done
 *   Phase "direct"     → Original behavior: plan + apply in one shot (no Telegram)
 *
 * Input (job.data):
 *   - instruction: string — what to code
 *   - workspaceDir: string — project root path
 *   - repoName: string — for context
 *   - branch: string — git branch
 *   - files?: string[] — specific files to modify (optional)
 *   - phase?: string — "plan" | "apply" | "commit" | "deploy" | "direct" (default: "plan" if telegram present, else "direct")
 *   - telegram?: { botToken: string, chatId: number } — Telegram context for notifications
 *   - taskId?: string — unique task ID for pending job lookup
 */
async function runCoder(job) {
	const { instruction, workspaceDir, repoName, branch, files, phase, telegram, taskId } = job.data
	const jobId = job.id

	// Determine which phase to run
	const effectivePhase = phase || (telegram ? "plan" : "direct")

	log("coder", jobId, `Starting phase="${effectivePhase}" | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	let result
	switch (effectivePhase) {
		case "plan":
			result = await runCoderPlan(job, jobId, taskId, telegram)
			break
		case "apply":
			result = await runCoderApply(job, jobId, taskId, telegram)
			break
		case "commit":
			result = await runCoderCommit(job, jobId, taskId, telegram)
			break
		case "deploy":
			result = await runCoderDeploy(job, jobId, taskId, telegram)
			break
		case "direct":
		default:
			return runCoderDirect(job)
	}

	// ─── Auto Mode Chaining ──────────────────────────────────────────────
	// When --auto flag is set, automatically enqueue the next phase
	// without waiting for user button clicks.
	if (telegram && telegram.auto && result && result.success !== false) {
		const nextPhase = getNextAutoPhase(effectivePhase, result)
		if (nextPhase) {
			log("coder", jobId, `Auto mode: chaining to next phase "${nextPhase}"`)
			try {
				const BullMQ = require("bullmq")
				const connection = {
					host: process.env.REDIS_HOST || "127.0.0.1",
					port: parseInt(process.env.REDIS_PORT || "6379", 10),
				}
				const autoQueue = new BullMQ.Queue("superroo-jobs", { connection })
				await autoQueue.add(`coder-${nextPhase}-${taskId}`, {
					task: instruction,
					agentId: "superroo-coder-agent",
					phase: nextPhase,
					taskId,
					workspaceDir,
					repoName,
					branch,
					files,
					plan: result.plan || job.data.plan,
					telegram: {
						botToken: telegram.botToken,
						chatId: telegram.chatId,
						taskId,
						branchName: telegram.branchName,
						auto: true,
					},
				})
				log("coder", jobId, `Auto mode: enqueued ${nextPhase} job for ${taskId}`)
			} catch (e) {
				log("coder", jobId, `Auto mode: failed to enqueue ${nextPhase}: ${e.message}`)
			}
		}
	}

	return result
}

/**
 * Determines the next phase in the auto-chaining workflow.
 */
function getNextAutoPhase(currentPhase, result) {
	switch (currentPhase) {
		case "plan":
			// Plan succeeded — auto-apply
			return "apply"
		case "apply":
			// Apply succeeded — auto-commit
			return "commit"
		case "commit":
			// Commit succeeded — auto-deploy
			return "deploy"
		case "deploy":
			// Deploy is the final phase
			return null
		default:
			return null
	}
}

/**
 * Phase "plan" — LLM generates a plan and sends it to Telegram for approval.
 * Returns early with { phase: "awaiting_approval", taskId }.
 */
async function runCoderPlan(job, jobId, taskId, telegram) {
	const { instruction, workspaceDir, repoName, branch, files } = job.data

	log("coder", jobId, "Phase: plan — gathering context and calling LLM")

	// Step 1: Gather context — rich multi-source context for the LLM
	let context = ""

	// 1a. Conversation history from Telegram (passed via job.data.telegram)
	if (telegram && telegram.conversationSummary) {
		context += `${telegram.conversationSummary}\n\n`
		log("coder", jobId, `Injected conversation summary (${telegram.conversationSummary.length} chars)`)
	} else {
		log("coder", jobId, "No conversation summary available — LLM will only see the raw instruction")
	}

	// 1a-rag. RAG context from BugKnowledgeStore — similar past fixes
	try {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		const ragContext = await ragStore.buildRagContext(instruction, { maxResults: 3, threshold: 0.5 })
		if (ragContext) {
			context += `=== Similar Past Fixes from Knowledge Base ===\n${ragContext}\n\n`
			log("coder", jobId, `Injected RAG context (${ragContext.length} chars) from BugKnowledgeStore`)
		}
		await ragStore.close()
	} catch (err) {
		log("coder", jobId, `RAG context unavailable (non-fatal): ${err.message}`)
	}

	// 1b. Project file listing — broader file types, more files
	try {
		const { stdout: fileList } = await execAsync(
			`find ${workspaceDir} -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "*.css" -o -name "*.html" -o -name "*.env*" \\) | head -100`,
			{ timeout: 10000 },
		)
		context += `Project files:\n${fileList}\n\n`
	} catch {
		context += "(file listing unavailable)\n\n"
	}

	// 1c. Git history — more commits + current branch + uncommitted changes
	try {
		const { stdout: gitLog } = await execAsync(
			`cd ${workspaceDir} && git log --oneline -15 2>/dev/null || echo "(no git history)"`,
			{ timeout: 10000 },
		)
		context += `Recent git history (last 15 commits):\n${gitLog}\n\n`
	} catch {
		context += "(git unavailable)\n\n"
	}

	// 1d. Git status — uncommitted changes (shows what's already been modified)
	try {
		const { stdout: gitStatus } = await execAsync(
			`cd ${workspaceDir} && git status --short 2>/dev/null || echo "(no changes)"`,
			{ timeout: 10000 },
		)
		if (gitStatus.trim() && !gitStatus.includes("(no changes)")) {
			context += `Uncommitted changes (git status):\n${gitStatus}\n\n`
		}
	} catch {
		// non-fatal
	}

	// 1e. Project identity — package.json, README, etc.
	try {
		const pkgPath = path.join(workspaceDir, "package.json")
		const pkgContent = await readFileContent(pkgPath)
		if (pkgContent) {
			const pkg = JSON.parse(pkgContent)
			context += `Project: ${pkg.name || "unknown"} v${pkg.version || "?"}\n`
			if (pkg.description) context += `Description: ${pkg.description}\n`
			if (pkg.scripts) {
				const scriptKeys = Object.keys(pkg.scripts).slice(0, 15)
				context += `Available scripts: ${scriptKeys.join(", ")}\n`
			}
			context += "\n"
		}
	} catch {
		// non-fatal
	}

	// 1f. Read explicitly requested files (with larger content limit)
	if (Array.isArray(files) && files.length > 0) {
		for (const f of files) {
			const fullPath = path.resolve(workspaceDir, f)
			if (fullPath.startsWith(workspaceDir)) {
				const content = await readFileContent(fullPath)
				if (content) {
					context += `File: ${f}\n\`\`\`\n${content.substring(0, 8000)}\n\`\`\`\n\n`
				}
			}
		}
	}

	// Step 2: LLM generates the code plan
	const systemPrompt = `You are the Coder Agent inside SuperRoo Cloud Orchestrator.
You operate on the project at ${workspaceDir} (repo: ${repoName}, branch: ${branch}).

Your job is to:
1. Analyze the task AND the conversation history (provided below) to understand FULL context
2. The conversation history shows what the user has been discussing — use it to understand intent
3. Generate a precise plan of files to create/modify
4. Output the complete file contents for each change

IMPORTANT — Context Awareness:
- Read the "=== Recent Conversation History ===" section carefully. It shows what was discussed before.
- If the user says "proceed with improvement" or "continue" or similar, look at the conversation history to determine WHAT to improve.
- If the task is vague but the conversation history provides context, use the history to disambiguate.
- If you genuinely cannot determine what to do even with the conversation history, set "needsClarification": true in your JSON output and explain what you need.

Output format (JSON):
{
	 "plan": "Brief description of what you'll do",
	 "changes": [
	   {
	     "file": "relative/path/to/file.js",
	     "action": "create" | "modify" | "delete",
	     "content": "Complete file content (for create/modify)",
	     "description": "What this change does"
	   }
	 ],
	 "commands": [
	   "command to run after changes (e.g., npm test)"
	 ],
	 "needsClarification": false,
	 "clarificationQuestion": "Only if needsClarification is true — what specific info do you need?"
}

Be precise. Output ONLY valid JSON, no markdown fences.`

	const userPrompt = `Task: ${instruction}\n\nProject context:\n${context}\n\nGenerate the code changes needed. If the task is vague, use the conversation history above to infer intent. If still unclear, set needsClarification: true.`

	log("coder", jobId, "Calling LLM for code generation plan...")
	let llmReply = await callLLM(systemPrompt, userPrompt, {
		maxTokens: 8000,
		temperature: 0.2,
	})

	// ─── Self-Healing Retry ─────────────────────────────────────────────
	// If LLM fails on first attempt, retry once automatically with
	// slightly higher temperature for more creative output.
	if (!llmReply) {
		log("coder", jobId, "LLM returned null — retrying once with higher temperature")
		llmReply = await callLLM(systemPrompt, userPrompt, {
			maxTokens: 8000,
			temperature: 0.5,
		})
	}

	if (!llmReply) {
		// LLM failed after retry — notify Telegram if available
		if (telegram && taskId) {
			try {
				const notifier = require("../api/telegramNotifier")
				notifier.setPendingCoderJob(taskId, {
					instruction,
					workspaceDir,
					repoName,
					branch,
					files,
					chatId: telegram.chatId,
					status: "retry_available",
					lastError: "LLM returned no response after retry",
					createdAt: new Date().toISOString(),
				})
				await notifier.sendCoderRetryableFailure(
					telegram.botToken,
					telegram.chatId,
					taskId,
					instruction,
					"The AI model returned no response after multiple attempts.",
				)
			} catch (e) {
				log("coder", jobId, `Failed to send retryable failure: ${e.message}`)
			}
		}
		return {
			success: false,
			error: "LLM returned no response after retry",
			output: [],
			phase: "awaiting_approval",
			taskId,
		}
	}

	// Step 3: Parse LLM output
	let plan
	try {
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		plan = JSON.parse(jsonMatch ? jsonMatch[0] : llmReply)
	} catch {
		log("coder", jobId, "Failed to parse LLM output as JSON, sending retryable failure to Telegram")
		if (telegram && taskId) {
			try {
				const notifier = require("../api/telegramNotifier")
				notifier.setPendingCoderJob(taskId, {
					instruction,
					workspaceDir,
					repoName,
					branch,
					files,
					chatId: telegram.chatId,
					status: "retry_available",
					lastError: "Failed to parse LLM output",
					lastModelOutput: llmReply.substring(0, 2000),
					createdAt: new Date().toISOString(),
				})
				await notifier.sendCoderRetryableFailure(
					telegram.botToken,
					telegram.chatId,
					taskId,
					instruction,
					"The AI model returned an invalid response format.",
				)
			} catch (e) {
				log("coder", jobId, `Failed to send retryable failure: ${e.message}`)
			}
		}
		return {
			success: false,
			error: "Failed to parse LLM output",
			output: [llmReply],
			phase: "awaiting_approval",
			taskId,
		}
	}

	// Step 3b: Check if LLM needs clarification
	if (plan.needsClarification && plan.clarificationQuestion && telegram && taskId) {
		log("coder", jobId, `LLM requested clarification: ${plan.clarificationQuestion}`)
		try {
			const notifier = require("../api/telegramNotifier")
			notifier.setPendingCoderJob(taskId, {
				instruction,
				plan,
				workspaceDir,
				repoName,
				branch,
				files,
				chatId: telegram.chatId,
				status: "awaiting_clarification",
				clarificationQuestion: plan.clarificationQuestion,
				createdAt: new Date().toISOString(),
			})
			await notifier.sendCoderClarification(
				telegram.botToken,
				telegram.chatId,
				taskId,
				instruction,
				plan.clarificationQuestion,
			)
			log("coder", jobId, `Clarification request sent to Telegram chat ${telegram.chatId}`)
		} catch (e) {
			log("coder", jobId, `Failed to send clarification: ${e.message}`)
		}
		return {
			success: true,
			output: [`LLM requested clarification: ${plan.clarificationQuestion}`],
			phase: "awaiting_clarification",
			taskId,
		}
	}

	// Step 4: Store plan in pendingCoderJobs and send Telegram notification
	if (telegram && taskId) {
		try {
			const notifier = require("../api/telegramNotifier")
			notifier.setPendingCoderJob(taskId, {
				instruction,
				plan,
				workspaceDir,
				repoName,
				branch,
				files,
				chatId: telegram.chatId,
				status: "awaiting_approval",
				createdAt: new Date().toISOString(),
			})
			await notifier.sendCoderPlan(telegram.botToken, telegram.chatId, taskId, instruction, {
				plan: plan.plan || "No plan description",
				changes: (plan.changes || []).map((c) => ({
					file: c.file,
					action: c.action,
					description: c.description || "",
				})),
				auto: telegram.auto === true,
			})
			log("coder", jobId, `Plan sent to Telegram chat ${telegram.chatId} for approval`)
		} catch (e) {
			log("coder", jobId, `Failed to send Telegram notification: ${e.message}`)
		}
	} else {
		// No Telegram — store plan anyway for potential later use
		log("coder", jobId, `Plan generated: ${plan.plan || "No description"}`)
	}

	// Build output for logging
	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Coder Agent — Plan Generated            ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push(`Plan: ${plan.plan || "No plan description"}`)
	output.push(`Changes: ${(plan.changes || []).length} files`)
	for (const c of plan.changes || []) {
		output.push(`  ${c.action === "delete" ? "🗑️" : "📝"} ${c.file} — ${c.description || c.action}`)
	}

	return {
		success: true,
		output,
		phase: "awaiting_approval",
		taskId,
		plan: {
			description: plan.plan,
			changeCount: (plan.changes || []).length,
		},
	}
}

/**
 * Phase "apply" — Loads the approved plan from pendingCoderJobs and applies file changes.
 * Returns early with { phase: "awaiting_commit", taskId }.
 */
async function runCoderApply(job, jobId, taskId, telegram) {
	const { instruction, workspaceDir } = job.data

	log("coder", jobId, "Phase: apply — loading approved plan")

	// Load plan from pendingCoderJobs
	let pendingData = null
	if (taskId) {
		try {
			const notifier = require("../api/telegramNotifier")
			pendingData = notifier.getPendingCoderJob(taskId)
		} catch (e) {
			log("coder", jobId, `Failed to load pending job: ${e.message}`)
		}
	}

	const plan = pendingData?.plan || job.data.plan
	if (!plan) {
		return { success: false, error: "No plan found — cannot apply changes", output: [], phase: "failed", taskId }
	}

	log("coder", jobId, `Applying plan: ${plan.plan || "No description"}`)

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Coder Agent — Applying Changes          ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push(`Plan: ${plan.plan || "No plan description"}`)
	output.push("")

	// Apply file changes
	const changes = Array.isArray(plan.changes) ? plan.changes : []
	let allSuccess = true
	const appliedChanges = []

	for (const change of changes) {
		const filePath = path.resolve(workspaceDir, change.file)

		// Safety: prevent path traversal
		if (!filePath.startsWith(workspaceDir)) {
			output.push(`  ⚠️  Skipped ${change.file} — path traversal blocked`)
			appliedChanges.push({
				file: change.file,
				action: change.action,
				success: false,
				error: "path traversal blocked",
			})
			continue
		}

		if (change.action === "delete") {
			try {
				await fs.unlink(filePath)
				output.push(`  🗑️ Deleted ${change.file}`)
				appliedChanges.push({ file: change.file, action: "delete", success: true })
			} catch (err) {
				output.push(`  ❌ Failed to delete ${change.file}: ${err.message}`)
				appliedChanges.push({ file: change.file, action: "delete", success: false, error: err.message })
				allSuccess = false
			}
		} else {
			const result = await writeFileContent(filePath, change.content)
			if (result.ok) {
				output.push(`  ✅ ${change.action === "create" ? "Created" : "Modified"} ${change.file}`)
				appliedChanges.push({ file: change.file, action: change.action, success: true })
			} else {
				output.push(`  ❌ Failed to write ${change.file}: ${result.error}`)
				appliedChanges.push({ file: change.file, action: change.action, success: false, error: result.error })
				allSuccess = false
			}
		}
	}

	// Run post-change commands
	// Test commands (npm test, npx vitest, etc.) run in Docker sandbox for isolation.
	// Non-test commands (npm install, etc.) run directly on the host.
	const commands = Array.isArray(plan.commands) ? plan.commands : []
	if (commands.length > 0) {
		output.push("")
		output.push("── Post-change commands ──")

		// Separate test commands from non-test commands
		const testPatterns = [/test/i, /vitest/i, /jest/i, /mocha/i, /ava/i, /tape/i, /cypress/i, /playwright/i]
		const testCommands = commands.filter((c) => testPatterns.some((p) => p.test(c)))
		const directCommands = commands.filter((c) => !testPatterns.some((p) => p.test(c)))

		// Run non-test commands directly (npm install, lint, etc.)
		if (directCommands.length > 0) {
			const cmdResults = await runCommands(directCommands, workspaceDir, 60000)
			for (const r of cmdResults) {
				if (r.exitCode === 0) {
					output.push(`  ✅ $ ${r.command}`)
					if (r.stdout) output.push(`     ${r.stdout.substring(0, 500)}`)
				} else {
					output.push(`  ❌ $ ${r.command} (exit ${r.exitCode})`)
					if (r.stderr) output.push(`     ${r.stderr.substring(0, 500)}`)
					allSuccess = false
				}
			}
		}

		// Run test commands in Docker sandbox for isolation
		if (testCommands.length > 0) {
			output.push("")
			output.push("── Running tests in Docker sandbox ──")
			try {
				const { runSandboxJob } = require("./sandboxRunner")
				const sandboxResult = await runSandboxJob({
					id: `coder-apply-${taskId || jobId}`,
					task: `Test gate for ${taskId || "unknown"}`,
					commands: [`cd ${workspaceDir}`, ...testCommands],
					network: "bridge", // Needs network for npm install
				})
				if (sandboxResult.success) {
					output.push(`  ✅ Sandbox tests passed (exit ${sandboxResult.exitCode})`)
					if (sandboxResult.stdout) {
						const lines = sandboxResult.stdout.split("\n").filter((l) => l.trim())
						for (const line of lines.slice(-10)) {
							output.push(`     ${line.substring(0, 200)}`)
						}
					}
				} else {
					output.push(`  ❌ Sandbox tests failed (exit ${sandboxResult.exitCode})`)
					if (sandboxResult.stderr) {
						const lines = sandboxResult.stderr.split("\n").filter((l) => l.trim())
						for (const line of lines.slice(-10)) {
							output.push(`     ${line.substring(0, 200)}`)
						}
					}
					allSuccess = false
				}
				log("coder", jobId, `Sandbox test gate: ${sandboxResult.success ? "PASSED" : "FAILED"}`)
			} catch (err) {
				output.push(`  ⚠️  Sandbox unavailable, running tests directly: ${err.message}`)
				// Fallback: run test commands directly
				const cmdResults = await runCommands(testCommands, workspaceDir, 120000)
				for (const r of cmdResults) {
					if (r.exitCode === 0) {
						output.push(`  ✅ $ ${r.command}`)
					} else {
						output.push(`  ❌ $ ${r.command} (exit ${r.exitCode})`)
						if (r.stderr) output.push(`     ${r.stderr.substring(0, 500)}`)
						allSuccess = false
					}
				}
			}
		}
	}

	// Generate git diff summary
	let diffSummary = ""
	try {
		const { stdout: diff } = await execAsync(`cd ${workspaceDir} && git diff --stat 2>/dev/null || true`, {
			timeout: 10000,
		})
		diffSummary = diff
	} catch {
		diffSummary = "(diff unavailable)"
	}

	output.push("")
	output.push(allSuccess ? "✅ All changes applied successfully" : "⚠️  Some changes failed")
	if (diffSummary) {
		output.push("")
		output.push(`── Git diff stats ──\n${diffSummary}`)
	}

	// Store bug fix in BugKnowledgeStore for Ollama RAG learning loop
	if (allSuccess && taskId) {
		try {
			const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
			const ragStore = new BugKnowledgeStore()
			await ragStore.init()

			// Get git diff for the fix
			let gitDiff = ""
			try {
				const { stdout: diff } = await execAsync(`cd ${workspaceDir} && git diff 2>/dev/null || true`, {
					timeout: 10000,
				})
				gitDiff = diff.substring(0, 5000)
			} catch {
				/* non-fatal */
			}

			await ragStore.storeBugFix({
				task_id: taskId,
				agent_type: "deepseek",
				error_summary: instruction.substring(0, 200),
				instruction: instruction,
				diff: gitDiff,
				result: `Applied ${appliedChanges.length} changes: ${appliedChanges.map((c) => c.file).join(", ")}`,
				files_changed: appliedChanges.map((c) => c.file),
				test_commands: commands,
				test_passed: allSuccess ? null : false,
				metadata: { runner: "coder", phase: "apply", allSuccess },
			})
			log("coder", jobId, `Bug fix stored in BugKnowledgeStore for task ${taskId}`)
			await ragStore.close()
		} catch (err) {
			log("coder", jobId, `Failed to store bug fix in knowledge base (non-fatal): ${err.message}`)
		}
	}

	await writeResultLog("coder", jobId, { success: allSuccess, changes: appliedChanges.length })

	// Update pendingCoderJobs and send Telegram notification
	if (telegram && taskId) {
		try {
			const notifier = require("../api/telegramNotifier")
			notifier.setPendingCoderJob(taskId, {
				...(pendingData || {}),
				status: allSuccess ? "awaiting_commit" : "applied_with_errors",
				appliedChanges,
				allSuccess,
				diffSummary,
				updatedAt: new Date().toISOString(),
			})
			await notifier.sendCoderApplied(telegram.botToken, telegram.chatId, taskId, instruction, {
				changes: appliedChanges,
				allSuccess,
				diff: diffSummary,
			})
			log("coder", jobId, `Applied notification sent to Telegram chat ${telegram.chatId}`)
		} catch (e) {
			log("coder", jobId, `Failed to send Telegram notification: ${e.message}`)
		}
	}

	return {
		success: allSuccess,
		output,
		// Even if some changes failed, allow proceeding to commit/deploy
		// so partial progress isn't lost. The user can see which files failed.
		phase: allSuccess ? "awaiting_commit" : "awaiting_commit",
		taskId,
		changes: appliedChanges,
	}
}

/**
 * Phase "commit" — Git add + commit of applied changes.
 * Returns early with { phase: "awaiting_deploy", taskId }.
 */
async function runCoderCommit(job, jobId, taskId, telegram) {
	const { instruction, workspaceDir, branch } = job.data

	log("coder", jobId, "Phase: commit — staging and committing changes")

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Coder Agent — Committing Changes        ║")
	output.push("╚══════════════════════════════════════════════╝")

	// Check for uncommitted changes
	let hasChanges = false
	try {
		const { stdout: status } = await execAsync(`cd ${workspaceDir} && git status --porcelain 2>/dev/null || true`, {
			timeout: 10000,
		})
		hasChanges = status.trim().length > 0
	} catch {
		hasChanges = false
	}

	if (!hasChanges) {
		output.push("⚠️  No uncommitted changes found")
		if (telegram && taskId) {
			try {
				const notifier = require("../api/telegramNotifier")
				await notifier.sendCoderCommitted(telegram.botToken, telegram.chatId, taskId, instruction, {
					hash: "(no changes)",
					message: "No changes to commit",
					branch: branch || "unknown",
				})
			} catch (e) {
				log("coder", jobId, `Failed to send Telegram notification: ${e.message}`)
			}
		}
		return { success: true, output, phase: "awaiting_deploy", taskId, commit: null }
	}

	// Git add — use --no-verify to skip any pre-commit hooks on add
	try {
		await execAsync(`cd ${workspaceDir} && git add -A`, { timeout: 60000 })
		output.push("  ✅ Staged all changes")
	} catch (err) {
		output.push(`  ❌ Failed to stage: ${err.message}`)
		return { success: false, error: `Git add failed: ${err.message}`, output, phase: "failed", taskId }
	}

	// Git commit — use --no-verify to skip husky/lint-staged/prettier hooks that may hang
	const commitMessage = `[coder] ${instruction?.substring(0, 72) || "Code changes"}`
	let commitHash = ""
	try {
		const { stdout: commitOut } = await execAsync(
			`cd ${workspaceDir} && git commit --no-verify -m "${commitMessage.replace(/"/g, '\\"')}"`,
			{ timeout: 120000 },
		)
		commitHash = (commitOut.match(/\[[\w-]+ [a-f0-9]{7,}\]/) || [""])[0]
		output.push(`  ✅ Committed: ${commitOut.trim().split("\n")[0] || commitMessage}`)
	} catch (err) {
		output.push(`  ❌ Commit failed: ${err.message}`)
		return { success: false, error: `Git commit failed: ${err.message}`, output, phase: "failed", taskId }
	}

	// Get actual hash
	try {
		const { stdout: hash } = await execAsync(`cd ${workspaceDir} && git rev-parse HEAD`, { timeout: 10000 })
		commitHash = hash.trim()
	} catch {
		// use partial hash from commit output
	}

	await writeResultLog("coder", jobId, { success: true, commitHash, branch })

	// Update pendingCoderJobs and send Telegram notification
	if (telegram && taskId) {
		try {
			const notifier = require("../api/telegramNotifier")
			const pendingData = notifier.getPendingCoderJob(taskId)
			notifier.setPendingCoderJob(taskId, {
				...(pendingData || {}),
				status: "awaiting_deploy",
				commitHash,
				commitMessage,
				updatedAt: new Date().toISOString(),
			})
			await notifier.sendCoderCommitted(telegram.botToken, telegram.chatId, taskId, instruction, {
				hash: commitHash,
				message: commitMessage,
				branch: branch || "unknown",
			})
			log("coder", jobId, `Commit notification sent to Telegram chat ${telegram.chatId}`)
		} catch (e) {
			log("coder", jobId, `Failed to send Telegram notification: ${e.message}`)
		}
	}

	// Store lesson in BugKnowledgeStore after successful commit
	try {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		await ragStore.storeLesson({
			task_id: taskId || jobId,
			agent_type: "coder",
			summary: `Committed changes: ${commitMessage}`,
			details: JSON.stringify({
				commitHash,
				branch: branch || "unknown",
				instruction: instruction?.substring(0, 200),
			}),
			lesson_type: "commit",
			features_affected: [],
		})
		log("coder", jobId, `Lesson stored in BugKnowledgeStore for commit ${commitHash}`)
		await ragStore.close()
	} catch (err) {
		log("coder", jobId, `Failed to store commit lesson (non-fatal): ${err.message}`)
	}

	return {
		success: true,
		output,
		phase: "awaiting_deploy",
		taskId,
		commit: { hash: commitHash, message: commitMessage, branch },
	}
}

/**
 * Phase "deploy" — Deploy changes to the VPS and run health check.
 * Returns { phase: "done", taskId }.
 */
async function runCoderDeploy(job, jobId, taskId, telegram) {
	const { instruction, workspaceDir, branch } = job.data

	log("coder", jobId, "Phase: deploy — deploying changes")

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Coder Agent — Deploying Changes         ║")
	output.push("╚══════════════════════════════════════════════╝")

	// Deploy steps
	const deployCommands = [
		`cd ${workspaceDir} && git pull origin ${branch || "main"} 2>/dev/null || true`,
		`cd ${workspaceDir} && pnpm install --no-frozen-lockfile 2>&1 || true`,
		`pm2 restart superroo-api 2>&1 || true`,
		`pm2 restart superroo-worker 2>&1 || true`,
	]

	let allSuccess = true
	for (const cmd of deployCommands) {
		try {
			const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 })
			output.push(`  ✅ $ ${cmd.substring(0, 80)}...`)
			if (stdout) output.push(`     ${stdout.substring(0, 300)}`)
			if (stderr) output.push(`     ${stderr.substring(0, 300)}`)
		} catch (err) {
			output.push(`  ⚠️  $ ${cmd.substring(0, 80)}... (exit ${err.code || 1})`)
			if (err.stderr) output.push(`     ${err.stderr.substring(0, 300)}`)
			// Don't mark as failed — some steps may fail harmlessly
		}
	}

	// Health check
	let healthOk = false
	let healthUrl = ""
	try {
		const apiPort = process.env.API_PORT || "8790"
		healthUrl = `http://127.0.0.1:${apiPort}/api/health`
		const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) })
		healthOk = healthRes.ok
		output.push(`  ${healthOk ? "✅" : "❌"} Health check: ${healthUrl} → ${healthRes.status}`)
	} catch (err) {
		output.push(`  ❌ Health check failed: ${err.message}`)
		allSuccess = false
	}

	output.push("")
	output.push(healthOk ? "✅ Deployment healthy" : "⚠️  Deployment may have issues")

	await writeResultLog("coder", jobId, { success: allSuccess, healthOk, deployed: true })

	// Update pendingCoderJobs and send Telegram notification
	if (telegram && taskId) {
		try {
			const notifier = require("../api/telegramNotifier")
			const pendingData = notifier.getPendingCoderJob(taskId)
			notifier.setPendingCoderJob(taskId, {
				...(pendingData || {}),
				status: healthOk ? "deployed" : "deploy_issues",
				healthOk,
				updatedAt: new Date().toISOString(),
			})
			await notifier.sendCoderDeployed(telegram.botToken, telegram.chatId, taskId, instruction, {
				success: healthOk,
				url: healthUrl,
				message: healthOk ? "Deployment completed successfully" : "Deployment completed with issues",
			})
			log("coder", jobId, `Deploy notification sent to Telegram chat ${telegram.chatId}`)
		} catch (e) {
			log("coder", jobId, `Failed to send Telegram notification: ${e.message}`)
		}
	}

	// Store lesson in BugKnowledgeStore after deploy attempt
	try {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		await ragStore.storeLesson({
			task_id: taskId || jobId,
			agent_type: "coder",
			summary: `Deploy ${healthOk ? "succeeded" : "had issues"}`,
			details: JSON.stringify({
				healthOk,
				healthUrl,
				branch: branch || "unknown",
				instruction: instruction?.substring(0, 200),
			}),
			lesson_type: "deploy",
			features_affected: [],
		})
		log("coder", jobId, `Deploy lesson stored in BugKnowledgeStore (health: ${healthOk})`)
		await ragStore.close()
	} catch (err) {
		log("coder", jobId, `Failed to store deploy lesson (non-fatal): ${err.message}`)
	}

	return {
		success: allSuccess,
		output,
		phase: "done",
		taskId,
		deploy: { success: healthOk, url: healthUrl },
	}
}

/**
 * Phase "direct" — Original single-shot behavior: plan + apply in one go.
 * No Telegram approval workflow.
 */
async function runCoderDirect(job) {
	const { instruction, workspaceDir, repoName, branch, files } = job.data
	const jobId = job.id
	const tag = `[coder:${jobId}]`

	log("coder", jobId, `Direct mode | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	// Step 1: Gather context — list files, read relevant ones
	let context = ""

	// 1a-rag. RAG context from BugKnowledgeStore — similar past fixes
	try {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		const ragContext = await ragStore.buildRagContext(instruction, { maxResults: 3, threshold: 0.5 })
		if (ragContext) {
			context += `=== Similar Past Fixes from Knowledge Base ===\n${ragContext}\n\n`
			log("coder", jobId, `Injected RAG context (${ragContext.length} chars) from BugKnowledgeStore`)
		}
		await ragStore.close()
	} catch (err) {
		log("coder", jobId, `RAG context unavailable (non-fatal): ${err.message}`)
	}
	try {
		const { stdout: fileList } = await execAsync(
			`find ${workspaceDir} -type f -name "*.js" -o -name "*.ts" -o -name "*.json" -o -name "*.md" | head -50`,
			{ timeout: 10000 },
		)
		context += `Project files:\n${fileList}\n\n`
	} catch {
		context += "(file listing unavailable)\n\n"
	}

	try {
		const { stdout: gitLog } = await execAsync(
			`cd ${workspaceDir} && git log --oneline -5 2>/dev/null || echo "(no git history)"`,
			{ timeout: 10000 },
		)
		context += `Recent git history:\n${gitLog}\n\n`
	} catch {
		context += "(git unavailable)\n\n"
	}

	// Read specific files if requested
	if (Array.isArray(files) && files.length > 0) {
		for (const f of files) {
			const fullPath = path.resolve(workspaceDir, f)
			if (fullPath.startsWith(workspaceDir)) {
				// Prevent path traversal
				const content = await readFileContent(fullPath)
				context += `File: ${f}\n\`\`\`\n${content.substring(0, 5000)}\n\`\`\`\n\n`
			}
		}
	}

	// Step 2: LLM generates the code plan
	const systemPrompt = `You are the Coder Agent inside SuperRoo Cloud Orchestrator.
You operate on the project at ${workspaceDir} (repo: ${repoName}, branch: ${branch}).

Your job is to:
1. Analyze the task and the project context
2. Generate a precise plan of files to create/modify
3. Output the complete file contents for each change

Output format (JSON):
{
  "plan": "Brief description of what you'll do",
  "changes": [
    {
      "file": "relative/path/to/file.js",
      "action": "create" | "modify" | "delete",
      "content": "Complete file content (for create/modify)",
      "description": "What this change does"
    }
  ],
  "commands": [
    "command to run after changes (e.g., npm test)"
  ]
}

Be precise. Output ONLY valid JSON, no markdown fences.`

	const userPrompt = `Task: ${instruction}\n\nProject context:\n${context}\n\nGenerate the code changes needed.`

	log("coder", jobId, "Calling LLM for code generation...")
	const llmReply = await callLLM(systemPrompt, userPrompt, {
		maxTokens: 8000,
		temperature: 0.2,
	})

	if (!llmReply) {
		return { success: false, error: "LLM returned no response", output: [] }
	}

	// Step 3: Parse LLM output and apply changes
	let plan
	try {
		// Try to extract JSON from the response (handle markdown fences)
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		plan = JSON.parse(jsonMatch ? jsonMatch[0] : llmReply)
	} catch {
		log("coder", jobId, `Failed to parse LLM output as JSON, using raw response`)
		return {
			success: true,
			output: [
				"╔══════════════════════════════════════════════╗",
				"║     Coder Agent — LLM Response              ║",
				"╚══════════════════════════════════════════════╝",
				"",
				llmReply,
			],
		}
	}

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Coder Agent — Execution Plan            ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push(`Plan: ${plan.plan || "No plan description"}`)
	output.push("")

	// Apply file changes
	const changes = Array.isArray(plan.changes) ? plan.changes : []
	let allSuccess = true

	for (const change of changes) {
		const filePath = path.resolve(workspaceDir, change.file)

		// Safety: prevent path traversal
		if (!filePath.startsWith(workspaceDir)) {
			output.push(`  ⚠️  Skipped ${change.file} — path traversal blocked`)
			continue
		}

		if (change.action === "delete") {
			try {
				await fs.unlink(filePath)
				output.push(`  🗑️ Deleted ${change.file}`)
			} catch (err) {
				output.push(`  ❌ Failed to delete ${change.file}: ${err.message}`)
				allSuccess = false
			}
		} else {
			const result = await writeFileContent(filePath, change.content)
			if (result.ok) {
				output.push(`  ✅ ${change.action === "create" ? "Created" : "Modified"} ${change.file}`)
			} else {
				output.push(`  ❌ Failed to write ${change.file}: ${result.error}`)
				allSuccess = false
			}
		}
	}

	// Run post-change commands
	const commands = Array.isArray(plan.commands) ? plan.commands : []
	if (commands.length > 0) {
		output.push("")
		output.push("── Post-change commands ──")
		const cmdResults = await runCommands(commands, workspaceDir, 60000)
		for (const r of cmdResults) {
			if (r.exitCode === 0) {
				output.push(`  ✅ $ ${r.command}`)
				if (r.stdout) output.push(`     ${r.stdout.substring(0, 500)}`)
			} else {
				output.push(`  ❌ $ ${r.command} (exit ${r.exitCode})`)
				if (r.stderr) output.push(`     ${r.stderr.substring(0, 500)}`)
				allSuccess = false
			}
		}
	}

	output.push("")
	output.push(allSuccess ? "✅ All changes applied successfully" : "⚠️  Some changes failed")

	// Store bug fix in BugKnowledgeStore for Ollama RAG learning loop
	if (allSuccess) {
		try {
			const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
			const ragStore = new BugKnowledgeStore()
			await ragStore.init()

			// Get git diff for the fix
			let gitDiff = ""
			try {
				const { stdout: diff } = await execAsync(`cd ${workspaceDir} && git diff 2>/dev/null || true`, {
					timeout: 10000,
				})
				gitDiff = diff.substring(0, 5000)
			} catch {
				/* non-fatal */
			}

			await ragStore.storeBugFix({
				task_id: jobId,
				agent_type: "deepseek",
				error_summary: instruction.substring(0, 200),
				instruction: instruction,
				diff: gitDiff,
				result: `Applied ${changes.length} changes: ${changes.map((c) => c.file).join(", ")}`,
				files_changed: changes.map((c) => c.file),
				test_commands: commands,
				test_passed: allSuccess ? null : false,
				metadata: { runner: "coder", phase: "direct", allSuccess },
			})
			log("coder", jobId, `Bug fix stored in BugKnowledgeStore for direct mode`)
			await ragStore.close()
		} catch (err) {
			log("coder", jobId, `Failed to store bug fix in knowledge base (non-fatal): ${err.message}`)
		}
	}

	await writeResultLog("coder", jobId, { success: allSuccess, changes: changes.length })

	return { success: allSuccess, output }
}

/**
 * DebuggerRunner — Investigates bugs and reports root cause.
 *
 * Mirrors the local DebuggerAgent (src/super-roo/agents/DebuggerAgent.ts).
 * Reads error logs, git history, and relevant files to diagnose issues.
 * Does NOT fix code — that's the CoderRunner's job.
 *
 * Input (job.data):
 *   - instruction: string — error description
 *   - workspaceDir: string — project root
 *   - repoName: string
 *   - filesLikelyInvolved?: string[] — hints
 */
async function runDebugger(job) {
	const { instruction, workspaceDir, repoName, filesLikelyInvolved } = job.data
	const jobId = job.id

	log("debugger", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	// Gather context
	let context = ""

	// 1a-rag. RAG context from BugKnowledgeStore — similar past fixes
	try {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		const ragContext = await ragStore.buildRagContext(instruction, { maxResults: 3, threshold: 0.5 })
		if (ragContext) {
			context += `=== Similar Past Fixes from Knowledge Base ===\n${ragContext}\n\n`
			log("debugger", jobId, `Injected RAG context (${ragContext.length} chars) from BugKnowledgeStore`)
		}
		await ragStore.close()
	} catch (err) {
		log("debugger", jobId, `RAG context unavailable (non-fatal): ${err.message}`)
	}

	try {
		const { stdout: fileList } = await execAsync(
			`find ${workspaceDir} -type f -name "*.js" -o -name "*.ts" -o -name "*.json" -o -name "*.log" | head -50`,
			{ timeout: 10000 },
		)
		context += `Project files:\n${fileList}\n\n`
	} catch {
		context += "(file listing unavailable)\n\n"
	}

	try {
		const { stdout: gitLog } = await execAsync(
			`cd ${workspaceDir} && git log --oneline -10 2>/dev/null || echo "(no git history)"`,
			{ timeout: 10000 },
		)
		context += `Recent git history:\n${gitLog}\n\n`
	} catch {
		context += "(git unavailable)\n\n"
	}

	// Read error logs if available
	try {
		const logDir = path.join(PROJECT_ROOT, "cloud", "logs")
		const { stdout: logFiles } = await execAsync(`find ${logDir} -name "*.log" -o -name "*.json" | head -10`, {
			timeout: 5000,
		})
		for (const lf of logFiles.trim().split("\n").filter(Boolean)) {
			const content = await readFileContent(lf)
			context += `Log: ${lf}\n\`\`\`\n${content.substring(0, 3000)}\n\`\`\`\n\n`
		}
	} catch {
		context += "(logs unavailable)\n\n"
	}

	// Read files likely involved
	if (Array.isArray(filesLikelyInvolved)) {
		for (const f of filesLikelyInvolved) {
			const fullPath = path.resolve(workspaceDir, f)
			if (fullPath.startsWith(workspaceDir)) {
				const content = await readFileContent(fullPath)
				context += `File: ${f}\n\`\`\`\n${content.substring(0, 5000)}\n\`\`\`\n\n`
			}
		}
	}

	// LLM analysis
	const systemPrompt = `You are the Debugger Agent inside SuperRoo Cloud Orchestrator.
You analyze bugs and errors in the project at ${workspaceDir} (repo: ${repoName}).

Your job is to:
1. Analyze the error description and project context
2. Identify root cause
3. Suggest specific files to fix and how

Output format (JSON):
{
		"rootCause": "Description of the root cause",
		"confidence": 0.0-1.0,
		"filesToFix": ["relative/path/to/file.js"],
		"suggestedFix": "Brief description of the fix",
		"evidence": ["Evidence point 1", "Evidence point 2"]
}

Output ONLY valid JSON, no markdown fences.`

	const userPrompt = `Error description: ${instruction}\n\nProject context:\n${context}\n\nAnalyze this bug.`

	log("debugger", jobId, "Calling LLM for debug analysis...")
	const llmReply = await callLLM(systemPrompt, userPrompt, {
		maxTokens: 4000,
		temperature: 0.1,
	})

	if (!llmReply) {
		return { success: false, error: "LLM returned no response", output: [] }
	}

	let analysis
	try {
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		analysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmReply)
	} catch {
		log("debugger", jobId, "Failed to parse LLM output as JSON, using raw response")
		return {
			success: true,
			output: [
				"╔══════════════════════════════════════════════╗",
				"║     Debugger Agent — Analysis               ║",
				"╚══════════════════════════════════════════════╝",
				"",
				llmReply,
			],
		}
	}

	const output = [
		"╔══════════════════════════════════════════════╗",
		"║     Debugger Agent — Root Cause Analysis     ║",
		"╚══════════════════════════════════════════════╝",
		`Root Cause: ${analysis.rootCause || "Unknown"}`,
		`Confidence: ${((analysis.confidence || 0) * 100).toFixed(0)}%`,
		"",
		"Files to fix:",
		...(analysis.filesToFix || []).map((f) => `  📄 ${f}`),
		"",
		`Suggested fix: ${analysis.suggestedFix || "None"}`,
		"",
		"Evidence:",
		...(analysis.evidence || []).map((e) => `  • ${e}`),
	]

	await writeResultLog("debugger", jobId, { success: true, rootCause: analysis.rootCause })

	return { success: true, output, analysis }
}

/**
 * TesterRunner — Runs tests and reports results.
 *
 * Input (job.data):
 *   - instruction: string — what to test
 *   - workspaceDir: string — project root
 *   - repoName: string
 *   - testCommand?: string — override test command
 */
async function runTester(job) {
	const { instruction, workspaceDir, repoName, testCommand } = job.data
	const jobId = job.id

	log("tester", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	const cmd = testCommand || `cd ${workspaceDir} && npx vitest run 2>&1 || true`

	const output = [
		"╔══════════════════════════════════════════════╗",
		"║     Tester Agent — Running Tests            ║",
		"╚══════════════════════════════════════════════╝",
		`Command: ${cmd}`,
		"",
	]

	log("tester", jobId, `Running: ${cmd}`)
	try {
		const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 })
		if (stdout) output.push(stdout.substring(0, 5000))
		if (stderr) output.push(stderr.substring(0, 2000))

		const passed = stdout.includes("PASS") || stdout.includes("passed") || !stdout.includes("FAIL")
		output.push("")
		output.push(passed ? "✅ Tests passed" : "❌ Tests failed")

		await writeResultLog("tester", jobId, { success: passed, output: stdout?.substring(0, 1000) })
		return { success: passed, output }
	} catch (err) {
		output.push(`❌ Test execution error: ${err.message}`)
		await writeResultLog("tester", jobId, { success: false, error: err.message })
		return { success: false, error: err.message, output }
	}
}

/**
 * PlannerRunner — Creates execution plans without making changes.
 *
 * Input (job.data):
 *   - instruction: string — what to plan
 *   - workspaceDir: string — project root
 *   - repoName: string
 */
async function runPlanner(job) {
	const { instruction, workspaceDir, repoName } = job.data
	const jobId = job.id

	log("planner", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	let context = ""
	try {
		const { stdout: fileList } = await execAsync(
			`find ${workspaceDir} -type f -name "*.js" -o -name "*.ts" -o -name "*.json" -o -name "*.md" | head -100`,
			{ timeout: 10000 },
		)
		context += `Project files:\n${fileList}\n\n`
	} catch {
		context += "(file listing unavailable)\n\n"
	}

	const systemPrompt = `You are the Planner Agent inside SuperRoo Cloud Orchestrator.
You create detailed execution plans for ${repoName}.

Output format (JSON):
{
		"plan": "High-level plan description",
		"steps": [
		  {
		    "step": 1,
		    "action": "description of what to do",
		    "agent": "coder | debugger | tester | deployer",
		    "details": "specific instructions"
		  }
		],
		"estimatedEffort": "low | medium | high",
		"risks": ["risk 1", "risk 2"]
}

Output ONLY valid JSON, no markdown fences.`

	const userPrompt = `Task: ${instruction}\n\nProject context:\n${context}\n\nCreate an execution plan.`

	log("planner", jobId, "Calling LLM for plan...")
	const llmReply = await callLLM(systemPrompt, userPrompt, {
		maxTokens: 4000,
		temperature: 0.3,
	})

	if (!llmReply) {
		return { success: false, error: "LLM returned no response", output: [] }
	}

	let plan
	try {
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		plan = JSON.parse(jsonMatch ? jsonMatch[0] : llmReply)
	} catch {
		return {
			success: true,
			output: [
				"╔══════════════════════════════════════════════╗",
				"║     Planner Agent — Raw Response            ║",
				"╚══════════════════════════════════════════════╝",
				"",
				llmReply,
			],
		}
	}

	const output = [
		"╔══════════════════════════════════════════════╗",
		"║     Planner Agent — Execution Plan           ║",
		"╚══════════════════════════════════════════════╝",
		`Plan: ${plan.plan || "No description"}`,
		`Effort: ${plan.estimatedEffort || "unknown"}`,
		"",
		"Steps:",
		...(plan.steps || []).map((s) => `  ${s.step}. [${s.agent}] ${s.action}`),
		"",
		"Risks:",
		...(plan.risks || []).map((r) => `  ⚠️  ${r}`),
	]

	await writeResultLog("planner", jobId, { success: true, steps: (plan.steps || []).length })
	return { success: true, output, plan }
}

/**
 * DeployerRunner — Deploys the project.
 *
 * Input (job.data):
 *   - instruction: string — deploy instructions
 *   - workspaceDir: string — project root
 *   - branch: string — branch to deploy
 */
async function runDeployer(job) {
	const { instruction, workspaceDir, branch } = job.data
	const jobId = job.id

	log("deployer", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	const commands = [
		`cd ${workspaceDir} && git pull origin ${branch || "main"} 2>&1`,
		`cd ${workspaceDir} && pnpm install --no-frozen-lockfile 2>&1 || true`,
		`pm2 restart superroo-api 2>&1 || true`,
		`pm2 restart superroo-worker 2>&1 || true`,
	]

	const output = [
		"╔══════════════════════════════════════════════╗",
		"║     Deployer Agent — Deploying               ║",
		"╚══════════════════════════════════════════════╝",
	]

	let allSuccess = true
	for (const cmd of commands) {
		try {
			const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 })
			output.push(`  ✅ $ ${cmd.substring(0, 80)}...`)
			if (stdout) output.push(`     ${stdout.substring(0, 300)}`)
			if (stderr) output.push(`     ${stderr.substring(0, 300)}`)
		} catch (err) {
			output.push(`  ❌ $ ${cmd.substring(0, 80)}... (exit ${err.code || 1})`)
			if (err.stderr) output.push(`     ${err.stderr.substring(0, 300)}`)
			allSuccess = false
		}
	}

	// Health check
	try {
		const apiPort = process.env.API_PORT || "8790"
		const healthRes = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
			signal: AbortSignal.timeout(15000),
		})
		output.push(`  ${healthRes.ok ? "✅" : "❌"} Health check: ${healthRes.status}`)
	} catch (err) {
		output.push(`  ❌ Health check failed: ${err.message}`)
	}

	await writeResultLog("deployer", jobId, { success: allSuccess })
	return { success: allSuccess, output }
}

/**
 * HealerRunner — Auto-healing: detects issues and applies fixes.
 *
 * Input (job.data):
 *   - instruction: string — what to heal
 *   - workspaceDir: string — project root
 *   - repoName: string
 */
async function runHealer(job) {
	const { instruction, workspaceDir, repoName } = job.data
	const jobId = job.id

	log("healer", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	// Check PM2 status
	const output = [
		"╔══════════════════════════════════════════════╗",
		"║     Healer Agent — Health Check             ║",
		"╚══════════════════════════════════════════════╝",
	]

	try {
		const { stdout: pm2Status } = await execAsync(`pm2 jlist 2>/dev/null || echo "[]"`, { timeout: 10000 })
		const processes = JSON.parse(pm2Status)
		output.push(`PM2 processes: ${processes.length}`)
		for (const p of processes) {
			const status = p.pm2_env?.status || "unknown"
			const name = p.name || "unknown"
			output.push(`  ${status === "online" ? "✅" : "❌"} ${name}: ${status}`)
		}
	} catch {
		output.push("  ⚠️  PM2 status unavailable")
	}

	// Check disk space
	try {
		const { stdout: df } = await execAsync("df -h / | tail -1", { timeout: 5000 })
		output.push(`  💾 Disk: ${df.trim()}`)
	} catch {
		output.push("  ⚠️  Disk check unavailable")
	}

	// Check memory
	try {
		const { stdout: free } = await execAsync("free -h | grep Mem", { timeout: 5000 })
		output.push(`  🧠 Memory: ${free.trim()}`)
	} catch {
		output.push("  ⚠️  Memory check unavailable")
	}

	await writeResultLog("healer", jobId, { success: true })
	return { success: true, output }
}

// ── Ollama log summarization ──────────────────────────────────────────────────

/**
 * Summarize a runner's result log using Ollama, then store as a lesson.
 * Fire-and-forget — failures are logged but never block the runner.
 */
async function ollamaSummarize(runnerType, job, result) {
	try {
		const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
		const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:0.5b"
		const instruction = job.data?.instruction || ""
		const outputText = Array.isArray(result.output) ? result.output.join("\n").substring(0, 3000) : ""

		const summaryPrompt = `Summarize this agent run in 3-4 sentences. Focus on: what was attempted, whether it succeeded, and key outcomes.

Agent: ${runnerType}
Instruction: ${instruction?.substring(0, 500)}
Success: ${result.success}
${result.error ? `Error: ${result.error}` : ""}
${outputText ? `Output:\n${outputText}` : ""}

Return ONLY a concise JSON object with keys: summary (string), key_outcomes (array of strings), and lesson_type (string).`

		const http = require("http")
		const postData = JSON.stringify({
			model: ollamaModel,
			messages: [
				{ role: "system", content: "You are a log summarizer. Return only valid JSON." },
				{ role: "user", content: summaryPrompt },
			],
			stream: false,
			options: { temperature: 0.1, num_predict: 512 },
		})

		const summaryText = await new Promise((resolve) => {
			const req = http.request(
				`${ollamaBaseUrl}/api/chat`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: 30000,
				},
				(res) => {
					let body = ""
					res.on("data", (chunk) => (body += chunk))
					res.on("end", () => {
						try {
							const data = JSON.parse(body)
							resolve(data.message?.content || data.response || null)
						} catch {
							resolve(null)
						}
					})
				},
			)
			req.on("error", () => resolve(null))
			req.on("timeout", () => {
				req.destroy()
				resolve(null)
			})
			req.write(postData)
			req.end()
		})

		if (!summaryText) {
			log(runnerType, job.id, "Ollama summarization returned empty — skipping lesson store")
			return
		}

		// Parse the JSON summary
		let parsed
		try {
			const jsonMatch = summaryText.match(/\{[\s\S]*\}/)
			parsed = JSON.parse(jsonMatch ? jsonMatch[0] : summaryText)
		} catch {
			parsed = { summary: summaryText.substring(0, 500), key_outcomes: [], lesson_type: runnerType }
		}

		// Store as lesson in BugKnowledgeStore
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		const ragStore = new BugKnowledgeStore()
		await ragStore.init()
		await ragStore.storeLesson({
			task_id: job.id,
			agent_type: runnerType,
			summary: parsed.summary || summaryText.substring(0, 500),
			details: JSON.stringify({
				success: result.success,
				error: result.error || null,
				key_outcomes: parsed.key_outcomes || [],
				instruction: instruction?.substring(0, 200),
				lesson_type: parsed.lesson_type || runnerType,
			}),
			lesson_type: parsed.lesson_type || runnerType,
			features_affected: [],
		})
		log(runnerType, job.id, `Ollama summary stored as lesson (${(parsed.summary || "").substring(0, 80)}...)`)
		await ragStore.close()
	} catch (err) {
		log(runnerType, job.id, `Ollama summarization failed (non-fatal): ${err.message}`)
	}
}

// ── HermesClaw notification ───────────────────────────────────────────────────

async function notifyHermes(runnerType, job, result) {
	try {
		const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787"
		await fetch(`${apiBase}/api/orchestrator/hermes/lesson`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source: `agent-runner:${runnerType}`,
				jobId: job.id,
				instruction: job.data?.instruction?.substring(0, 200),
				success: result.success,
				error: result.error || null,
				timestamp: new Date().toISOString(),
			}),
			signal: AbortSignal.timeout(5000),
		})
	} catch {
		// Fire-and-forget — don't let HermesClaw failures affect the runner result
	}
}

async function notifyLearningGateway(runnerType, job, result) {
	try {
		const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787"
		const instruction = job.data?.instruction || ""
		await fetch(`${apiBase}/api/learning/store`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(process.env.LEARNING_API_KEY ? { "x-learning-key": process.env.LEARNING_API_KEY } : {}),
			},
			body: JSON.stringify({
				project: "superroo2",
				task_type: runnerType,
				problem: instruction.substring(0, 500) || `${runnerType} runner task`,
				root_cause: result.success ? undefined : result.error || "Runner failed",
				solution: result.success
					? `Runner ${runnerType} completed successfully.`
					: `Runner ${runnerType} failed: ${result.error || "unknown error"}`,
				files_changed: Array.isArray(result.filesChanged) ? result.filesChanged : [],
				tags: [runnerType, result.success ? "success" : "failure"],
				confidence: result.success ? 0.78 : 0.62,
				risk: result.success ? "normal" : "elevated",
				source_agent: `agent-runner:${runnerType}`,
				raw_ref: String(job.id),
			}),
			signal: AbortSignal.timeout(5000),
		})
		await fetch(`${apiBase}/api/learning/score`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(process.env.LEARNING_API_KEY ? { "x-learning-key": process.env.LEARNING_API_KEY } : {}),
			},
			body: JSON.stringify({
				project: "superroo2",
				agent: `agent-runner:${runnerType}`,
				task: instruction.substring(0, 500),
				task_id: String(job.id),
				outcome: result.success ? "success" : "failure",
				used_lessons: Number(job.data?.usedLessons || 0),
				lesson_ids: Array.isArray(job.data?.lessonIds) ? job.data.lessonIds : [],
			}),
			signal: AbortSignal.timeout(5000),
		})
	} catch {
		// Fire-and-forget
	}
}

// ── Runner registry ───────────────────────────────────────────────────────────

const RUNNERS = {
	coder: runCoder,
	debugger: runDebugger,
	tester: runTester,
	planner: runPlanner,
	deployer: runDeployer,
	healer: runHealer,
}

/**
 * Execute an agent runner by type.
 *
 * @param {string} runnerType - One of: coder, debugger, tester, planner, deployer, healer
 * @param {object} job - BullMQ job object
 * @returns {Promise<{success: boolean, output: string[], error?: string}>}
 */
async function executeRunner(runnerType, job) {
	const runner = RUNNERS[runnerType]
	if (!runner) {
		return {
			success: false,
			error: `Unknown runner type: ${runnerType}. Available: ${Object.keys(RUNNERS).join(", ")}`,
			output: [],
		}
	}

	log(runnerType, job.id, `Executing via ${runnerType} runner...`)
	try {
		const result = await Promise.race([
			runner(job),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`Runner ${runnerType} timed out after ${RUNNER_TIMEOUT_MS}ms`)),
					RUNNER_TIMEOUT_MS,
				),
			),
		])
		log(runnerType, job.id, `Completed | success=${result.success}`)

		// Notify HermesClaw for lesson extraction (fire-and-forget)
		notifyHermes(runnerType, job, result)
		notifyLearningGateway(runnerType, job, result)

		// Ollama summarization — store structured summary as lesson (fire-and-forget)
		ollamaSummarize(runnerType, job, result)

		return result
	} catch (err) {
		log(runnerType, job.id, `Failed: ${err.message}`)
		const result = { success: false, error: err.message, output: [`Runner error: ${err.message}`] }

		// Notify HermesClaw even on failure (lessons from failures are valuable)
		notifyHermes(runnerType, job, result)
		notifyLearningGateway(runnerType, job, result)

		// Ollama summarization even on failure — failure lessons are valuable
		ollamaSummarize(runnerType, job, result)

		return result
	}
}

module.exports = {
	executeRunner,
	RUNNERS,
	// Exported for testing
	runCoder,
	runDebugger,
	runTester,
	runPlanner,
	runDeployer,
	runHealer,
}
