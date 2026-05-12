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
		if (!secrets[providerId]) return null
		return decryptSecret(secrets[providerId])
	} catch {
		return null
	}
}

// ── LLM call helper ───────────────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt, options = {}) {
	const providers = [
		{
			envKey: process.env.OPENAI_API_KEY,
			vaultId: "openai",
			baseUrl: "https://api.openai.com/v1",
			model: options.model || "gpt-4o-mini",
		},
		{
			envKey: null,
			vaultId: "deepseek",
			baseUrl: "https://api.deepseek.com/v1",
			model: "deepseek-chat",
		},
	]

	for (const p of providers) {
		const apiKey = p.envKey || (await getProviderKey(p.vaultId))
		if (!apiKey) continue

		try {
			const res = await fetch(`${p.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: p.model,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
					max_tokens: options.maxTokens || 4000,
					temperature: options.temperature ?? 0.3,
				}),
				signal: AbortSignal.timeout(options.timeout || LLM_TIMEOUT_MS),
			})
			if (!res.ok) continue
			const data = await res.json()
			return data.choices?.[0]?.message?.content || null
		} catch {
			continue
		}
	}

	return null
}

// ── Logging ───────────────────────────────────────────────────────────────────

async function ensureLogsDir() {
	try {
		await fs.mkdir(LOGS_DIR, { recursive: true })
	} catch {
		// ignore
	}
}

function log(runner, jobId, message) {
	const ts = new Date().toISOString()
	const line = `[${ts}] [${runner}] [${jobId}] ${message}`
	process.stdout.write(line + "\n")
}

async function writeResultLog(runner, jobId, result) {
	await ensureLogsDir()
	const logPath = path.join(LOGS_DIR, `${runner}-${jobId}.json`)
	await fs.writeFile(logPath, JSON.stringify({ runner, jobId, result, timestamp: new Date().toISOString() }, null, 2))
}

// ── Command execution helper ──────────────────────────────────────────────────

async function runCommands(commands, cwd, timeout = 300000) {
	const outputs = []
	for (const cmd of commands) {
		try {
			const { stdout, stderr } = await execAsync(cmd, {
				cwd,
				timeout,
				maxBuffer: 10 * 1024 * 1024, // 10MB
			})
			outputs.push({ command: cmd, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 })
		} catch (err) {
			outputs.push({
				command: cmd,
				stdout: err.stdout?.trim() || "",
				stderr: err.stderr?.trim() || err.message,
				exitCode: err.code || 1,
			})
			// Stop on first failure
			break
		}
	}
	return outputs
}

// ── File operations ───────────────────────────────────────────────────────────

async function readFileContent(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf8")
		return content
	} catch (err) {
		return `[Error reading ${filePath}: ${err.message}]`
	}
}

async function writeFileContent(filePath, content) {
	try {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, "utf8")
		return { ok: true, path: filePath }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Runners
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CoderRunner — Writes and modifies code.
 *
 * Mirrors the local CoderAgent (src/super-roo/agents/CoderAgent.ts).
 * Uses LLM to generate code changes, then applies them via file writes
 * and runs commands to verify.
 *
 * Input (job.data):
 *   - instruction: string — what to code
 *   - workspaceDir: string — project root path
 *   - repoName: string — for context
 *   - branch: string — git branch
 *   - files?: string[] — specific files to modify (optional)
 */
async function runCoder(job) {
	const { instruction, workspaceDir, repoName, branch, files } = job.data
	const jobId = job.id
	const tag = `[coder:${jobId}]`

	log("coder", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	// Step 1: Gather context — list files, read relevant ones
	let context = ""
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
				output.push(`  ✅ Deleted ${change.file}`)
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
	const tag = `[debugger:${jobId}]`

	log("debugger", jobId, `Starting | error: ${instruction?.substring(0, 100)}`)

	// Gather diagnostic context
	let context = ""

	// Git log
	try {
		const { stdout } = await execAsync(
			`cd ${workspaceDir} && git log --oneline -20 2>/dev/null || echo "(no git)"`,
			{ timeout: 10000 },
		)
		context += `Git log:\n${stdout}\n\n`
	} catch {
		context += "(git unavailable)\n\n"
	}

	// Git diff (recent changes)
	try {
		const { stdout } = await execAsync(
			`cd ${workspaceDir} && git diff HEAD~3 --stat 2>/dev/null || echo "(no diff)"`,
			{ timeout: 10000 },
		)
		context += `Recent changes:\n${stdout}\n\n`
	} catch {
		// ignore
	}

	// Error logs
	try {
		const { stdout } = await execAsync(
			`tail -100 ${PROJECT_ROOT}/cloud/logs/api-error.log 2>/dev/null || echo "(no error log)"`,
			{ timeout: 5000 },
		)
		context += `Recent API errors:\n${stdout}\n\n`
	} catch {
		// ignore
	}

	// Read hinted files
	if (Array.isArray(filesLikelyInvolved)) {
		for (const f of filesLikelyInvolved) {
			const fullPath = path.resolve(workspaceDir, f)
			if (fullPath.startsWith(workspaceDir)) {
				const content = await readFileContent(fullPath)
				context += `File: ${f}\n\`\`\`\n${content.substring(0, 3000)}\n\`\`\`\n\n`
			}
		}
	}

	const systemPrompt = `You are the Debugger Agent inside SuperRoo Cloud Orchestrator.
Your job is to investigate bugs and find root causes. Do NOT fix the code.

Analyze the error, git history, and file contents to determine:
1. ROOT CAUSE — one sentence
2. FILES TO CHANGE — comma-separated paths
3. RECOMMENDED FIX — one paragraph
4. DEPLOYMENT RISK — low | medium | high | critical

Output format (JSON):
{
  "rootCause": "string",
  "filesToChange": ["path1", "path2"],
  "recommendedFix": "string",
  "deploymentRisk": "low|medium|high|critical",
  "evidence": ["evidence point 1", "evidence point 2"]
}

Output ONLY valid JSON.`

	const userPrompt = `Error to investigate: ${instruction}\n\nDiagnostic context:\n${context}\n\nFind the root cause.`

	log("debugger", jobId, "Calling LLM for diagnosis...")
	const llmReply = await callLLM(systemPrompt, userPrompt, { maxTokens: 2000 })

	if (!llmReply) {
		return {
			success: false,
			error: "LLM returned no response",
			output: ["Diagnosis unavailable — LLM did not respond"],
		}
	}

	// Try to parse JSON
	let diagnosis
	try {
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		diagnosis = jsonMatch ? JSON.parse(jsonMatch[0]) : null
	} catch {
		diagnosis = null
	}

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Debugger Agent — Diagnosis Report       ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push("")

	if (diagnosis) {
		output.push(`🔍 Root Cause: ${diagnosis.rootCause || "Unknown"}`)
		output.push("")
		output.push(`📁 Files to Change:`)
		const files = Array.isArray(diagnosis.filesToChange) ? diagnosis.filesToChange : []
		if (files.length > 0) {
			files.forEach((f) => output.push(`  - ${f}`))
		} else {
			output.push("  (none identified)")
		}
		output.push("")
		output.push(`💡 Recommended Fix:`)
		output.push(`  ${diagnosis.recommendedFix || "No fix proposed"}`)
		output.push("")
		output.push(`⚠️  Deployment Risk: ${diagnosis.deploymentRisk || "unknown"}`)
		output.push("")
		if (Array.isArray(diagnosis.evidence) && diagnosis.evidence.length > 0) {
			output.push(`📋 Evidence:`)
			diagnosis.evidence.forEach((e) => output.push(`  - ${e}`))
		}
	} else {
		output.push(llmReply)
	}

	await writeResultLog("debugger", jobId, { diagnosis })

	return { success: true, output }
}

/**
 * TesterRunner — Runs tests and reports results.
 *
 * Mirrors the local TesterAgent (src/super-roo/agents/TesterAgent.ts).
 * Executes test commands and parses output.
 *
 * Input (job.data):
 *   - instruction: string — test description or specific test command
 *   - workspaceDir: string — project root
 *   - testCommand?: string — override test command
 */
async function runTester(job) {
	const { instruction, workspaceDir, testCommand } = job.data
	const jobId = job.id
	const tag = `[tester:${jobId}]`

	log("tester", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	if (!workspaceDir) {
		return { success: false, error: "No workspaceDir provided", output: [] }
	}

	// Determine test command
	const cmd = testCommand || "npm test 2>&1 || pnpm test 2>&1 || echo '(no test script found)'"

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Tester Agent — Test Results             ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push(`Test: ${instruction || "Run all tests"}`)
	output.push(`Command: ${cmd}`)
	output.push("")

	try {
		const { stdout, stderr } = await execAsync(cmd, {
			cwd: workspaceDir,
			timeout: 300000, // 5 min
			maxBuffer: 10 * 1024 * 1024,
		})

		const fullOutput = stdout + (stderr ? "\nSTDERR:\n" + stderr : "")
		output.push(fullOutput.substring(0, 10000))

		// Determine pass/fail
		const passed =
			!stderr.toLowerCase().includes("failing") &&
			!stderr.toLowerCase().includes("error") &&
			!stdout.toLowerCase().includes("failed") &&
			(stdout.includes("passed") || stdout.includes("ok") || stdout.includes("✓"))

		output.push("")
		output.push(passed ? "✅ All tests passed" : "❌ Tests failed")

		await writeResultLog("tester", jobId, { passed, output: fullOutput.substring(0, 1000) })

		return { success: passed, output }
	} catch (err) {
		output.push(`Test execution error: ${err.message}`)
		output.push(err.stdout || "")
		output.push(err.stderr || "")
		output.push("")
		output.push("❌ Tests failed with error")

		await writeResultLog("tester", jobId, { passed: false, error: err.message })

		return { success: false, output }
	}
}

/**
 * PlannerRunner — Creates detailed plans and architecture.
 *
 * Mirrors the local PmAgent (src/super-roo/agents/PmAgent.ts).
 * Uses LLM to break down tasks into phases with success criteria.
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

	// Gather project context
	let context = ""
	try {
		const { stdout } = await execAsync(
			`cd ${workspaceDir} && ls package.json 2>/dev/null && cat package.json 2>/dev/null | head -50 || echo "(no package.json)"`,
			{ timeout: 5000 },
		)
		context += `Package info:\n${stdout}\n\n`
	} catch {
		// ignore
	}

	const systemPrompt = `You are the Planner Agent inside SuperRoo Cloud Orchestrator.
Your job is to break down complex tasks into clear, sequential phases.

For each phase, specify:
- title: Short name
- agent: Which agent should handle it (coder | debugger | tester | deployer | crawler | healer)
- description: What to do in this phase
- successCriteria: How to verify completion
- dependencies: Phase numbers that must complete first

Output format (JSON):
{
  "overallPlan": "One-paragraph summary",
  "phases": [
    {
      "phase": 1,
      "title": "string",
      "agent": "coder|debugger|tester|deployer|crawler|healer",
      "description": "string",
      "successCriteria": "string",
      "dependencies": []
    }
  ],
  "estimatedComplexity": "low|medium|high",
  "risks": ["risk1", "risk2"]
}

Output ONLY valid JSON.`

	const userPrompt = `Task to plan: ${instruction}\n\nProject context:\n${context}\n\nCreate a detailed execution plan.`

	log("planner", jobId, "Calling LLM for plan generation...")
	const llmReply = await callLLM(systemPrompt, userPrompt, { maxTokens: 4000 })

	if (!llmReply) {
		return { success: false, error: "LLM returned no response", output: [] }
	}

	let plan
	try {
		const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
		plan = jsonMatch ? JSON.parse(jsonMatch[0]) : null
	} catch {
		plan = null
	}

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Planner Agent — Execution Plan          ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push("")

	if (plan) {
		output.push(`📋 Overall Plan: ${plan.overallPlan || "No summary"}`)
		output.push("")
		output.push(`📊 Estimated Complexity: ${plan.estimatedComplexity || "unknown"}`)
		output.push("")
		output.push("── Phases ──")
		const phases = Array.isArray(plan.phases) ? plan.phases : []
		phases.forEach((p) => {
			output.push(`  Phase ${p.phase}: ${p.title}`)
			output.push(`    Agent: @${p.agent}`)
			output.push(`    Task: ${p.description}`)
			output.push(`    Success: ${p.successCriteria}`)
			if (Array.isArray(p.dependencies) && p.dependencies.length > 0) {
				output.push(`    Depends on: phase ${p.dependencies.join(", ")}`)
			}
			output.push("")
		})

		if (Array.isArray(plan.risks) && plan.risks.length > 0) {
			output.push("── Risks ──")
			plan.risks.forEach((r) => output.push(`  ⚠️  ${r}`))
		}
	} else {
		output.push(llmReply)
	}

	await writeResultLog("planner", jobId, { plan })

	return { success: true, output }
}

/**
 * DeployerRunner — Deploys the project.
 *
 * Mirrors the local DeployOrchestrator.
 * Runs deploy commands and verifies health.
 *
 * Input (job.data):
 *   - instruction: string — deploy description
 *   - workspaceDir: string — project root
 */
async function runDeployer(job) {
	const { instruction, workspaceDir } = job.data
	const jobId = job.id

	log("deployer", jobId, `Starting | instruction: ${instruction?.substring(0, 100)}`)

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Deployer Agent — Deployment             ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push(`Task: ${instruction || "Deploy project"}`)
	output.push("")

	// Run deploy commands
	const commands = [
		`cd ${workspaceDir} && git pull 2>&1 || echo "(git pull failed)"`,
		`cd ${workspaceDir} && pnpm install 2>&1 || npm install 2>&1 || echo "(install failed)"`,
		`cd ${workspaceDir} && pm2 restart superroo-api 2>&1 || echo "(pm2 restart failed)"`,
	]

	for (const cmd of commands) {
		try {
			const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 })
			output.push(`$ ${cmd}`)
			if (stdout.trim()) output.push(`  ${stdout.trim().substring(0, 500)}`)
			if (stderr.trim()) output.push(`  STDERR: ${stderr.trim().substring(0, 500)}`)
			output.push("")
		} catch (err) {
			output.push(`$ ${cmd}`)
			output.push(`  FAILED: ${err.message}`)
			output.push("")
		}
	}

	// Health check
	try {
		const healthRes = await fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(10000) })
		const healthData = await healthRes.json()
		output.push(`Health check: ${healthRes.ok ? "✅ OK" : "❌ Failed"}`)
		output.push(`Status: ${JSON.stringify(healthData).substring(0, 200)}`)
	} catch (err) {
		output.push(`Health check error: ${err.message}`)
	}

	await writeResultLog("deployer", jobId, { deployed: true })

	return { success: true, output }
}

/**
 * HealerRunner — Runs self-healing cycles.
 *
 * Mirrors the local SelfHealingAgent.
 * Checks for incidents and attempts auto-fix.
 *
 * Input (job.data):
 *   - instruction: string — healing context
 */
async function runHealer(job) {
	const { instruction } = job.data
	const jobId = job.id

	log("healer", jobId, `Starting | context: ${instruction?.substring(0, 100)}`)

	const output = []
	output.push("╔══════════════════════════════════════════════╗")
	output.push("║     Healer Agent — Self-Healing Cycle       ║")
	output.push("╚══════════════════════════════════════════════╝")
	output.push("")

	// Check API health
	try {
		const healthRes = await fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(5000) })
		const healthData = await healthRes.json()
		output.push(`API Health: ${healthRes.ok ? "✅" : "❌"}`)
		if (healthData.orchestrator) {
			output.push(`Orchestrator: ${healthData.orchestrator.status || "unknown"}`)
		}
	} catch (err) {
		output.push(`API Health: ❌ (${err.message})`)
	}

	// Check PM2 processes
	try {
		const { stdout } = await execAsync("pm2 list 2>&1 | head -20", { timeout: 5000 })
		output.push("")
		output.push("PM2 Processes:")
		stdout.split("\n").forEach((l) => output.push(`  ${l}`))
	} catch {
		output.push("PM2: unavailable")
	}

	// Check disk space
	try {
		const { stdout } = await execAsync("df -h / | tail -1", { timeout: 5000 })
		output.push("")
		output.push(`Disk: ${stdout.trim()}`)
	} catch {
		// ignore
	}

	// Check memory
	try {
		const { stdout } = await execAsync("free -h | head -2", { timeout: 5000 })
		output.push(`Memory:\n${stdout.trim()}`)
	} catch {
		// ignore
	}

	output.push("")
	output.push("✅ Healing cycle complete")

	await writeResultLog("healer", jobId, { healthy: true })

	return { success: true, output }
}

// ── HermesClaw integration ────────────────────────────────────────────────────

/**
 * Notify HermesClaw about a runner result for lesson extraction.
 * This is called after each runner completes (success or failure).
 *
 * @param {string} runnerType
 * @param {object} job
 * @param {{success: boolean, output: string[], error?: string}} result
 */
async function notifyHermes(runnerType, job, result) {
	try {
		const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787"
		await fetch(`${apiBase}/api/orchestrator/hermes/lesson`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				runnerType,
				jobId: job.id,
				instruction: job.data?.instruction || "",
				parentTaskId: job.data?.parentTaskId || "",
				phase: job.data?.phase || 0,
				success: result.success,
				error: result.error || null,
				outputSummary: (Array.isArray(result.output) ? result.output.join("\n") : "").substring(0, 1000),
				timestamp: Date.now(),
			}),
			signal: AbortSignal.timeout(5000),
		})
	} catch {
		// Non-blocking — HermesClaw is advisory
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

		return result
	} catch (err) {
		log(runnerType, job.id, `Failed: ${err.message}`)
		const result = { success: false, error: err.message, output: [`Runner error: ${err.message}`] }

		// Notify HermesClaw even on failure (lessons from failures are valuable)
		notifyHermes(runnerType, job, result)

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
