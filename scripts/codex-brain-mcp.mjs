#!/usr/bin/env node
/**
 * Codex Brain MCP Server
 *
 * Exposes the repo-local Codex Brain CLI as MCP tools so MCP-aware agents can
 * use the same RAG, context collection, local Ollama coders, and append-only
 * memory path that Codex uses.
 */

import readline from "node:readline"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// PROJECT_ROOT lets this MCP server run from any project, not just superroo2
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
// CODEX_BRAIN_SCRIPT lets the CLI live anywhere (default: sibling scripts/ dir)
const CODEX_BRAIN = process.env.CODEX_BRAIN_SCRIPT || path.join(ROOT, "scripts", "codex-brain.mjs")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const OLLAMA_MODE_FILE = process.env.SUPERROO_OLLAMA_MODE_FILE || path.join(SUPERROO_HOME, "ollama-mode.json")

function applyEnvDefault(name, value) {
	if (value && !process.env[name]) process.env[name] = String(value)
}

function applyOllamaMode() {
	try {
		const config = JSON.parse(fs.readFileSync(OLLAMA_MODE_FILE, "utf8"))
		const modeName = process.env.SUPERROO_AGENT_MODE || config.activeMode || "hybrid-local"
		const mode = config.modes?.[modeName] || config.modes?.["hybrid-local"]
		if (!mode) return
		applyEnvDefault("SUPERROO_AGENT_MODE", modeName)
		applyEnvDefault("OLLAMA_HOST", mode.ollamaHost)
		applyEnvDefault("OLLAMA_URL", mode.ollamaHost)
		applyEnvDefault("OLLAMA_FALLBACK_URL", mode.ollamaFallbackUrl)
		applyEnvDefault("CODEX_BRAIN_HERMES_MODEL", mode.thinkerModel)
		applyEnvDefault("CODEX_BRAIN_FAST_CODER_MODEL", mode.fastCoderModel)
		applyEnvDefault("CODEX_BRAIN_PRO_CODER_MODEL", mode.proCoderModel)
		applyEnvDefault("CODEX_BRAIN_EMBED_MODEL", mode.embedModel)
		applyEnvDefault("OLLAMA_MODEL", mode.thinkerModel)
		applyEnvDefault("OLLAMA_EMBED_MODEL", mode.embedModel)
	} catch {}
}

applyOllamaMode()

const GLOBAL_MEMORY_DIR = process.env.SUPERROO_MEMORY_DIR || path.join(SUPERROO_HOME, "memory")
const CODEX_BRAIN_MEMORY_DIR = process.env.CODEX_BRAIN_MEMORY_DIR || path.join(GLOBAL_MEMORY_DIR, "codex-brain")
const OUTCOMES = path.join(CODEX_BRAIN_MEMORY_DIR, "outcomes.jsonl")
const HELPFULNESS_LEDGER = path.join(GLOBAL_MEMORY_DIR, "lesson-helpfulness.jsonl")
const ENFORCEMENT_LEDGER = path.join(SUPERROO_HOME, "tasks", "enforcement-ledger.json")
const GLOBAL_TASK_REGISTRY = process.env.GLOBAL_TASK_REGISTRY
	|| path.join(SUPERROO_HOME, "tasks", "global-tasks.json")
const PROJECT_ID = process.env.PROJECT_ID || path.basename(ROOT)

// ── Cross-Process Coordination ────────────────────────────────────────────────

const TASK_LOCK_PATH = path.join(SUPERROO_HOME, "tasks", ".registry.lock")
const FILE_LOCK_DIR  = path.join(SUPERROO_HOME, "tasks", "file-locks")
const OLLAMA_SEM_PATH = path.join(SUPERROO_HOME, "tasks", ".ollama.sem")
// 64GB RAM: hermes3(5GB) + qwen3:14b(9GB) + qwen2.5-coder(4.5GB) + nomic(0.3GB) = 18.8GB base
// Each concurrent call adds ~4-9GB KV cache — 4 parallel is safe (leaves ~13GB for OS/VS Code)
const MAX_CONCURRENT_OLLAMA = parseInt(process.env.OLLAMA_MAX_PARALLEL || "4")

/** Atomic cross-process lock using "wx" (exclusive create). Returns unlock fn. */
async function acquireLock(lockPath, timeoutMs = 15000) {
	fs.mkdirSync(path.dirname(lockPath), { recursive: true })
	const started = Date.now()
	while (true) {
		try {
			const fd = fs.openSync(lockPath, "wx")
			fs.writeFileSync(fd, `${process.pid}:${AGENT_ID}:${Date.now()}`)
			fs.closeSync(fd)
			return () => { try { fs.unlinkSync(lockPath) } catch {} }
		} catch (e) {
			if (e.code !== "EEXIST") throw e
			if (Date.now() - started > timeoutMs) {
				// Stale lock? Check if pid is still alive
				try {
					const info = fs.readFileSync(lockPath, "utf8")
					const pid = parseInt(info.split(":")[0])
					try { process.kill(pid, 0) } catch { fs.unlinkSync(lockPath); continue }
				} catch {}
				throw new Error(`Lock timeout after ${timeoutMs}ms: ${lockPath}`)
			}
			await new Promise(r => setTimeout(r, 50))
		}
	}
}

/** Wrap a task registry read-modify-write in an atomic cross-process lock */
async function withTaskLock(fn) {
	const unlock = await acquireLock(TASK_LOCK_PATH)
	try { return await fn() } finally { unlock() }
}

/** Claim exclusive edit rights on a file. Returns null if another agent has it. */
function claimFileLock(filePath, agentId = AGENT_ID) {
	fs.mkdirSync(FILE_LOCK_DIR, { recursive: true })
	const key = filePath.replace(/[:/\\]/g, "_")
	const lockFile = path.join(FILE_LOCK_DIR, `${key}.lock`)
	try {
		const fd = fs.openSync(lockFile, "wx")
		fs.writeFileSync(fd, JSON.stringify({ agent: agentId, file: filePath, pid: process.pid, at: new Date().toISOString() }))
		fs.closeSync(fd)
		return () => { try { fs.unlinkSync(lockFile) } catch {} }
	} catch {
		try {
			const existing = JSON.parse(fs.readFileSync(lockFile, "utf8"))
			return { conflict: true, agent: existing.agent, file: filePath }
		} catch { return null }
	}
}

/** Check which files are currently locked by other agents */
function checkFileLocks(files = []) {
	fs.mkdirSync(FILE_LOCK_DIR, { recursive: true })
	const conflicts = []
	for (const f of files) {
		const key = f.replace(/[:/\\]/g, "_")
		const lockFile = path.join(FILE_LOCK_DIR, `${key}.lock`)
		if (fs.existsSync(lockFile)) {
			try {
				const info = JSON.parse(fs.readFileSync(lockFile, "utf8"))
				if (info.agent !== AGENT_ID) {
					// Check if the locking process is still alive
					try { process.kill(info.pid, 0); conflicts.push(info) }
					catch { fs.unlinkSync(lockFile) }  // stale lock, clean up
				}
			} catch {}
		}
	}
	return conflicts
}

/** Ollama concurrency semaphore — prevents GPU/CPU saturation */
async function withOllamaSemaphore(fn) {
	fs.mkdirSync(path.dirname(OLLAMA_SEM_PATH), { recursive: true })
	const started = Date.now()
	while (true) {
		// Count active Ollama slots
		let slots = []
		try {
			slots = JSON.parse(fs.readFileSync(OLLAMA_SEM_PATH, "utf8"))
				.filter(s => {
					// Clean up stale slots (process dead or >5min old)
					try { process.kill(s.pid, 0) } catch { return false }
					return Date.now() - s.at < 300000
				})
		} catch { slots = [] }

		if (slots.length < MAX_CONCURRENT_OLLAMA) {
			const slot = { pid: process.pid, agent: AGENT_ID, at: Date.now() }
			const unlock = await acquireLock(OLLAMA_SEM_PATH + ".lock", 5000)
			try {
				// Re-read after getting lock
				let current = []
				try { current = JSON.parse(fs.readFileSync(OLLAMA_SEM_PATH, "utf8")).filter(s => { try { process.kill(s.pid, 0); return Date.now()-s.at<300000 } catch { return false } }) }
				catch {}
				if (current.length < MAX_CONCURRENT_OLLAMA) {
					current.push(slot)
					fs.writeFileSync(OLLAMA_SEM_PATH, JSON.stringify(current), "utf8")
					unlock()
					try { return await fn() }
					finally {
						const rl = await acquireLock(OLLAMA_SEM_PATH + ".lock", 5000)
						try {
							let upd = []
							try { upd = JSON.parse(fs.readFileSync(OLLAMA_SEM_PATH, "utf8")) } catch {}
							fs.writeFileSync(OLLAMA_SEM_PATH, JSON.stringify(upd.filter(s => s.pid !== process.pid || s.at !== slot.at)), "utf8")
						} finally { rl() }
					}
				}
				unlock()
			} catch { unlock(); }
		}

		if (Date.now() - started > 120000) throw new Error("Ollama semaphore timeout — too many concurrent agents")
		await new Promise(r => setTimeout(r, 500))
	}
}

// Per-agent outcome files — all feed the shared ML model
const AGENT_OUTCOME_FILES = {
	"blackbox":  path.join(GLOBAL_MEMORY_DIR, "blackbox-outcomes.jsonl"),
	"kilo-code": path.join(os.homedir(), ".kilo", "outcomes.jsonl"),
	"claude":    OUTCOMES,
	"codex":     path.join(ROOT, "memory", "codex-brain", "outcomes.jsonl"),
	"copilot":   path.join(GLOBAL_MEMORY_DIR, "copilot-outcomes.jsonl"),
}
const AGENT_ID = process.env.AGENT_ID || process.env.PROJECT_ID || "claude"

const TOOLS = [
	tool("brain_status", "Check Codex Brain health, Ollama models, and memory counts.", {}),
	tool("warmup", "Preload Codex Brain Ollama models.", {}),
	tool("retrieve_context", "Retrieve ranked RAG memory for a task. Use at task start.", {
		task: string("Task description"),
		collection: string("Memory collection", false),
		limit: number("Max memories", false),
	}, ["task"]),
	tool("collect_context", "Build a pre-coding brief with RAG memory and optional web research.", {
		task: string("Task description"),
		code_context: string("Relevant code context", false),
		research_topic: string("Optional web research topic", false),
		web_search: boolean("Enable web search", false),
		collection: string("Memory collection", false),
		memory_limit: number("Max memories", false),
	}, ["task"]),
	tool("research", "Research a topic with web search and RAG memory.", {
		topic: string("Research topic"),
		collection: string("Memory collection", false),
		limit: number("Max memories", false),
	}, ["topic"]),
	tool("analyze_task", "Analyze a task against project memory and optional code context.", {
		task: string("Task description"),
		code_context: string("Relevant code context", false),
		collection: string("Memory collection", false),
		limit: number("Max memories", false),
	}, ["task"]),
	tool("code", "Fast local coder using qwen2.5-coder:7b.", {
		prompt: string("Coding prompt"),
		context: string("Optional context", false),
	}, ["prompt"]),
	tool("code_pro", "Complex local coder using qwen3:14b or fallback pro model.", {
		prompt: string("Coding prompt"),
		context: string("Optional context", false),
	}, ["prompt"]),
	tool("code_pro_verified", "Complex coder with syntax self-correction loop.", {
		prompt: string("Coding prompt"),
		context: string("Optional context", false),
		retries: number("Max correction retries", false),
	}, ["prompt"]),
	tool("code_with_memory", "Coder with automatic RAG memory injection.", {
		prompt: string("Coding prompt"),
		collection: string("Memory collection", false),
		limit: number("Max memories", false),
		fast: boolean("Use fast coder", false),
	}, ["prompt"]),
	tool("remember", "Append a memory to Codex Brain. This never deletes or rewrites existing lessons.", {
		content: string("Memory content"),
		collection: string("Collection", false),
		tags: array("Tags", false),
	}, ["content"]),
	tool("recall", "Hybrid BM25 + vector RAG search over Codex Brain memory.", {
		query: string("Search query"),
		collection: string("Collection", false),
		limit: number("Max memories", false),
	}, ["query"]),
	tool("list_collections", "List Codex Brain memory collections.", {}),
	tool("smart_code", "ML-guided coder: heuristic routing picks code / code_pro / code_pro_verified automatically based on prompt complexity.", {
		prompt: string("Coding prompt"),
		context: string("Optional context", false),
	}, ["prompt"]),
	tool("risk_assess", "Predict implementation, deploy, config, and command risk before coding or operating. Shared across Codex, Kilo, and Claude.", {
		task: string("Task or operation description"),
		action_type: string("Optional action type: code, config_change, db_migration, deploy, delete, restart", false),
		files: array("Files expected to change", false),
		logs: string("Relevant logs or errors", false),
		context: string("Additional context", false),
		commands: array("Commands planned for the task", false),
		persist: boolean("Persist assessment to shared JSONL risk memory", false),
		project_id: string("Project ID override", false),
	}, ["task"]),
	tool("risk_record_pattern", "Append a reusable predictive-risk pattern to the shared risk memory.", {
		signature: string("Short searchable risk signature"),
		description: string("What tends to fail and why"),
		severity: string("low | medium | high | critical", false),
		pattern_type: string("Pattern type such as deploy, auth, migration, dependency", false),
		suggested_fix: string("Reusable mitigation", false),
		project_id: string("Project ID override", false),
	}, ["signature", "description"]),
	tool("risk_stats", "Summarize shared predictive-risk assessments and learned patterns.", {
		project_id: string("Project ID filter", false),
	}, []),
	tool("record_outcome", "Append a local outcome sample for routing feedback. Append-only.", {
		success: number("1 success, 0 failure"),
		prompt: string("Original prompt", false),
		tool_used: string("Tool used", false),
		quality: number("Quality 0-1", false),
		bug_risk: number("Bug risk 0 low, 1 medium, 2 high", false),
		task_id: string("Task id", false),
	}, ["success"]),
	tool("rate_lesson", "Rate a retrieved lesson as helpful or not. Feeds the helpfulness ledger to improve future retrieval ranking.", {
		lesson_id: string("Lesson ID from retrieve_context results"),
		helpful: number("1 = helpful, 0 = not helpful"),
		context_task: string("What task you were working on", false),
		note: string("Optional note (better alternative, why it didn't apply)", false),
	}, ["lesson_id", "helpful"]),
	tool("task_upsert", "Create or update a task in the global task registry. Use to track work across all agents.", {
		id: string("Unique task ID (e.g. kilo_fix_auth_20260601)"),
		title: string("Short task title"),
		status: string("active | completed | blocked | cancelled"),
		agent: string("Agent name: kilo-code | codex | claude", false),
		summary: string("What this task does", false),
		files: array("Files being changed", false),
		features: array("Features affected", false),
	}, ["id", "title", "status"]),
	tool("task_list", "List tasks from the global registry, optionally filtered by project or status.", {
		project: string("Project ID filter (default: current project)", false),
		status: string("Filter by status: active | completed | blocked | all", false),
		agent: string("Filter by agent", false),
		limit: number("Max tasks to return (default 20)", false),
	}, []),

	// ── Hermes 3 Direct Query (for Blackbox LLM fallback) ───────────────────────
	tool("ask_hermes3", "Ask Hermes 3 a question directly via Ollama. Use this to get LLM responses without tool call formatting issues. Returns plain text response.", {
		prompt: string("Question or prompt for Hermes 3"),
	}, ["prompt"]),
	tool("ask_hermes3_with_memory", "Ask Hermes 3 with automatic RAG context retrieval. Use this for informed questions that should consider past lessons.", {
		prompt: string("Question or prompt for Hermes 3"),
		collection: string("Memory collection to search", false),
		limit: number("Max memories to inject", false),
	}, ["prompt"]),

	// ── Multi-Agent Orchestration (used by Blackbox + any agent) ──────────────
	tool("orchestrate_task", "Run the full multi-agent pipeline: thinker→architect→coder→reviewer using local Ollama models. Returns structured plan, implementation, and review. Use for complex tasks that need design thinking before coding.", {
		task: string("Full task description"),
		context: string("Optional project context or relevant code", false),
		files: array("Files that will be changed (for product memory risk check)", false),
		max_review_loops: number("Max coder↔reviewer iterations (default: 2)", false),
	}, ["task"]),
	tool("architect_plan", "Run only the architect phase: analyze the task, design the solution, break into subtasks with acceptance criteria. Returns a structured implementation plan.", {
		task: string("Task description to architect"),
		context: string("Optional context or relevant code", false),
	}, ["task"]),
	tool("review_code", "Run the reviewer agent on code output. Checks for bugs, security issues, type errors, and best practices. Returns structured feedback with severity levels.", {
		code: string("Code to review"),
		task: string("Original task the code was written for"),
		context: string("Additional context", false),
	}, ["code", "task"]),
	tool("check_conflicts", "Check if any other agent (Codex, Kilo, Claude, Blackbox) is currently editing the same files. Call this before starting any coding task. Returns conflict warnings and active agent list.", {
		files: array("Files you plan to edit", false),
	}, []),
	tool("coordinate_before_code", "AUTOMATIC COORDINATOR — call this before any coding task. Uses Ollama (hermes3) to intelligently assess conflicts, Ollama load, and active agent work. Returns PROCEED with context injection, or WAIT with a suggested delay and reason. Wired automatically via hooks — agents should also call this explicitly for best results.", {
		task: string("What you are about to do"),
		files: array("Files you plan to edit", false),
		agent: string("Your agent ID (blackbox|codex|kilo-code|claude)", false),
		priority: string("low|normal|high — high skips the wait queue", false),
	}, ["task"]),

	// ── File Editor Tools (Blackbox + any agent) ──────────────────────────────
	tool("write_file", "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Use after smart_code or orchestrate_task returns code to apply.", {
		path: string("Absolute or workspace-relative file path"),
		content: string("Full file content to write"),
		create_dirs: boolean("Create parent directories if missing (default: true)", false),
	}, ["path", "content"]),
	tool("edit_file", "Apply a targeted edit to a file: find old_text and replace with new_text. Safer than write_file for partial changes.", {
		path: string("File path to edit"),
		old_text: string("Exact text to find and replace"),
		new_text: string("Replacement text"),
	}, ["path", "old_text", "new_text"]),
	tool("read_file", "Read a file's content. Use to inspect code before editing.", {
		path: string("File path to read"),
		max_lines: number("Max lines to return (default: 200)", false),
	}, ["path"]),

	// ── Auto-Skill Generation ─────────────────────────────────────────────────
	tool("enforcement_status", "Check ML outcome recording compliance across all agents. Shows which agents are recording outcomes (record_outcome) and which are not. Essential for knowing if the learning loop is working.", {}),
	// ── Deployment Tools ────────────────────────────────────────────────────────
	tool("deploy_to_vps", "Deploy the SuperRoo dashboard/API to VPS at 100.64.175.88 via Tailscale SSH. Runs pre-deploy checks (tests + build), then executes the deploy script with retries. Rolls back automatically on failure.", {
		target: string("What to deploy: dashboard | api | worker | docker | all (default: dashboard)", false),
		skip_tests: boolean("Skip pre-deploy tests (default: false)", false),
		max_retries: number("Max deploy retries (default: 3)", false),
		service: string("PM2 service name to restart after deploy (optional)", false),
	}, []),
	tool("deploy_status", "Check the status of the current or last VPS deployment — shows what was deployed, when, whether it succeeded, and current PM2/Docker container status.", {}),
	tool("rollback_deploy", "Rollback the last VPS deployment — git revert + PM2 restart. Use when a deploy breaks something.", {
		service: string("PM2 service to restart after rollback (default: all)", false),
	}, []),
	tool("debug_loop", "Start an autonomous persistent-bug debugging loop: analyze → patch → container-test → vision-verify (llava:7b) → VPS-test → commit. Loops up to max_attempts times. Auto-rolls back on failure, refines hypothesis each iteration. Perfect for bugs that need repeated debugging.", {
		bug: string("Describe the bug clearly — what breaks, where, what you expect"),
		max_attempts: number("Max retry iterations (default: 8)", false),
		vision: boolean("Use llava:7b to visually verify fix in screenshots (default: true)", false),
		vps: boolean("Run final test on VPS via Tailscale (default: true)", false),
		docker: boolean("Run in Docker sandbox container (default: true)", false),
		dry_run: boolean("Plan only, don't make actual changes (default: false)", false),
	}, ["bug"]),
	tool("debug_loop_status", "Check the status of the current or last debug loop — shows attempts, hypotheses tried, current phase, and whether bug was fixed.", {}),
	tool("generate_skill", "Automatically generate a new global Kilo/Claude skill from a pattern description. Creates SKILL.md in ~/.kilo/skill/<name>/. Use when you've learned a reusable workflow worth encoding.", {
		name: string("Skill name (kebab-case, e.g. react-component-pattern)"),
		description: string("One-line description of what the skill does"),
		content: string("Full skill content — what the agent should do when this skill is active"),
		category: string("Category: coding|debugging|deployment|testing|architecture", false),
	}, ["name", "description", "content"]),
]

function string(description, required = true) {
	return { type: "string", description, ...(required ? {} : { nullable: true }) }
}

function number(description, required = true) {
	return { type: "number", description, ...(required ? {} : { nullable: true }) }
}

function boolean(description, required = true) {
	return { type: "boolean", description, ...(required ? {} : { nullable: true }) }
}

function array(description, required = true) {
	return { type: "array", items: { type: "string" }, description, ...(required ? {} : { nullable: true }) }
}

function tool(name, description, properties, required = []) {
	return { name, description, inputSchema: { type: "object", properties, required } }
}

function textResult(text) {
	return { content: [{ type: "text", text: String(text) }] }
}

function errorResult(message) {
	return { content: [{ type: "text", text: String(message) }], isError: true }
}

const MAX_STDOUT_BYTES = 2 * 1024 * 1024  // 2MB cap — prevents unbounded buffer on large generations

function killProcess(child) {
	try {
		if (process.platform === "win32") {
			// Windows: taskkill /F /T kills the full process tree
			try { require("child_process").execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" }) } catch {}
		} else {
			child.kill("SIGKILL")
		}
	} catch {}
}

function runCodexBrainRaw(args, timeoutMs = 180000) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CODEX_BRAIN, ...args], {
			cwd: process.env.PROJECT_ROOT || ROOT,
			windowsHide: true,
			env: { ...process.env, PROJECT_ROOT: process.env.PROJECT_ROOT || ROOT },
		})
		let stdout = ""
		let stderr = ""
		let stdoutBytes = 0
		let settled = false

		function settle(fn) {
			if (settled) return
			settled = true
			clearTimeout(timer)
			killProcess(child)
			fn()
		}

		const timer = setTimeout(() => {
			settle(() => reject(new Error(`Codex Brain timed out after ${timeoutMs}ms: ${args[0]}`)))
		}, timeoutMs)

		child.stdout.on("data", (chunk) => {
			stdoutBytes += chunk.length
			if (stdoutBytes > MAX_STDOUT_BYTES) {
				settle(() => reject(new Error(`Codex Brain output exceeded ${MAX_STDOUT_BYTES/1024}KB limit for: ${args[0]}`)))
				return
			}
			stdout += chunk.toString()
		})
		child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 4096) })
		child.on("error", (error) => { settle(() => reject(error)) })
		child.on("close", (code) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			if (code !== 0) {
				reject(new Error(stderr.trim() || `Codex Brain exited with code ${code}`))
				return
			}
			resolve(stdout.trim())
		})
	})
}

// Wrap with Ollama semaphore for model-heavy commands (coding, collect, retrieve)
const OLLAMA_HEAVY_CMDS = new Set(["smart","code","code-pro","code-verified","code-with-memory","collect","retrieve"])
function runCodexBrain(args, timeoutMs = 180000) {
	const cmd = args[0]
	if (OLLAMA_HEAVY_CMDS.has(cmd)) {
		return withOllamaSemaphore(() => runCodexBrainRaw(args, timeoutMs))
	}
	return runCodexBrainRaw(args, timeoutMs)
}

function handleCheckConflicts({ files = [] } = {}) {
	// File-level conflicts
	const fileConflicts = files.length ? checkFileLocks(files) : []

	// Ollama load — how many agents are currently running models
	let ollamaSlots = []
	try {
		ollamaSlots = JSON.parse(fs.readFileSync(OLLAMA_SEM_PATH, "utf8"))
			.filter(s => { try { process.kill(s.pid, 0); return Date.now()-s.at<300000 } catch { return false } })
	} catch {}

	// Active tasks from registry
	const registry = loadTaskRegistry()
	const activeTasks = []
	for (const [proj, projData] of Object.entries(registry.projects || {})) {
		for (const [agent, tasks] of Object.entries(projData)) {
			if (agent === "updatedAt" || !Array.isArray(tasks)) continue
			for (const t of tasks) {
				if (t.status === "active") activeTasks.push({ ...t, project: proj })
			}
		}
	}

	const lines = ["## Agent Conflict Check\n"]

	if (fileConflicts.length > 0) {
		lines.push("### ⚠️ File Conflicts")
		fileConflicts.forEach(c => lines.push(`- **${c.agent}** is editing \`${c.file}\``))
		lines.push("\n**STOP** — coordinate with the conflicting agent before proceeding.\n")
	} else if (files.length) {
		lines.push("### ✅ No File Conflicts\nFiles are free to edit.\n")
	}

	lines.push(`### Ollama Load: ${ollamaSlots.length}/${MAX_CONCURRENT_OLLAMA} slots used`)
	if (ollamaSlots.length > 0) {
		ollamaSlots.forEach(s => lines.push(`- ${s.agent} (pid ${s.pid})`))
	}

	if (activeTasks.length > 0) {
		lines.push(`\n### Active Tasks (${activeTasks.length})`)
		activeTasks.forEach(t => lines.push(`- [${t.agent}] ${t.title} (${t.project})`))
	} else {
		lines.push("\n### Active Tasks\nNone — workspace is free.")
	}

	return lines.join("\n")
}

// ── Ollama Coordinator Agent ──────────────────────────────────────────────────

const COORD_LOG_PATH = path.join(SUPERROO_HOME, "tasks", "coordinator.log")

function coordLog(msg) {
	try { fs.appendFileSync(COORD_LOG_PATH, `[${new Date().toISOString()}] [${AGENT_ID}] ${msg}\n`) } catch {}
}

async function callOllamaCoordinator(prompt) {
	// Try localhost first, then VPS fallback
	const hosts = ["http://127.0.0.1:11434", "http://100.64.175.88:11434"]
	for (const host of hosts) {
		try {
			const res = await fetch(`${host}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "hermes3",
					prompt,
					stream: false,
					options: { temperature: 0.1, num_predict: 300 },
				}),
				signal: AbortSignal.timeout(20000),
			})
			if (res.ok) {
				const data = await res.json()
				return data.response?.trim() || ""
			}
		} catch {}
	}
	return null  // Ollama unreachable — fall back to rule-based
}

async function coordinateBeforeCode({ task, files = [], agent, priority = "normal" } = {}) {
	const callerAgent = agent || AGENT_ID
	const conflictReport = handleCheckConflicts({ files })
	const hasConflicts = conflictReport.includes("⚠️ FILE CONFLICT")

	// Gather Ollama slot state
	let ollamaSlots = []
	try {
		ollamaSlots = JSON.parse(fs.readFileSync(OLLAMA_SEM_PATH, "utf8"))
			.filter(s => { try { process.kill(s.pid, 0); return Date.now()-s.at<300000 } catch { return false } })
	} catch {}
	const ollamaFull = ollamaSlots.length >= MAX_CONCURRENT_OLLAMA

	// Active tasks
	const registry = loadTaskRegistry()
	const activeTasks = []
	for (const [proj, pd] of Object.entries(registry.projects || {})) {
		for (const [ag, tasks] of Object.entries(pd)) {
			if (ag === "updatedAt" || !Array.isArray(tasks)) continue
			tasks.filter(t => t.status === "active").forEach(t => activeTasks.push({ ...t, project: proj, agent: ag }))
		}
	}

	coordLog(`Coordination request: agent=${callerAgent} task="${task.slice(0,80)}" files=${files.join(",")} conflicts=${hasConflicts} ollamaFull=${ollamaFull}`)

	// Fast-path: no conflicts and Ollama has capacity — skip LLM call
	if (!hasConflicts && !ollamaFull) {
		coordLog("PROCEED (no conflicts, Ollama has capacity)")
		return [
			"## ✅ PROCEED",
			`**Agent**: ${callerAgent}`,
			`**Task**: ${task}`,
			`**Files**: ${files.length > 0 ? files.join(", ") : "not specified"}`,
			`**Ollama**: ${ollamaSlots.length}/${MAX_CONCURRENT_OLLAMA} slots used`,
			`**Active agents**: ${activeTasks.length > 0 ? activeTasks.map(t => t.agent).join(", ") : "none"}`,
			"",
			"No conflicts detected. Proceed with your task.",
		].join("\n")
	}

	// High priority: skip wait queue regardless of load
	if (priority === "high" && !hasConflicts) {
		coordLog("PROCEED (high priority override)")
		return `## ✅ PROCEED (High Priority)\n\n**Warning**: Ollama at capacity (${ollamaSlots.length}/${MAX_CONCURRENT_OLLAMA}) but high priority override active. Expect slower responses.\n\nProceed with task: ${task}`
	}

	// Use Ollama hermes3 to make an intelligent decision
	const situationSummary = [
		`You are a multi-agent coordinator. Make a quick PROCEED or WAIT decision.`,
		``,
		`REQUESTING AGENT: ${callerAgent}`,
		`TASK: ${task.slice(0, 200)}`,
		`FILES WANTED: ${files.join(", ") || "none specified"}`,
		``,
		`CURRENT SITUATION:`,
		hasConflicts ? conflictReport.split("\n").slice(0, 8).join("\n") : "No file conflicts.",
		`Ollama load: ${ollamaSlots.length}/${MAX_CONCURRENT_OLLAMA} slots used.`,
		activeTasks.length > 0
			? `Active agents: ${activeTasks.map(t => `${t.agent} working on "${t.title.slice(0,40)}"`).join("; ")}`
			: "No other agents active.",
		``,
		`RULES:`,
		`- If file conflict: decide who should wait based on who started first`,
		`- If Ollama full: suggest the requester waits 30-60 seconds`,
		`- If no issues: approve immediately`,
		``,
		`Reply in exactly this format:`,
		`DECISION: [PROCEED|WAIT]`,
		`REASON: [one sentence]`,
		`ACTION: [what the requesting agent should do next]`,
		`WAIT_SECONDS: [0 if PROCEED, otherwise number of seconds to wait]`,
	].join("\n")

	let decision = "PROCEED"
	let reason = "Coordinator unavailable — defaulting to proceed"
	let action = "Continue with your task"
	let waitSeconds = 0

	const ollamaResponse = await callOllamaCoordinator(situationSummary)

	if (ollamaResponse) {
		const lines = ollamaResponse.split("\n")
		for (const line of lines) {
			if (line.startsWith("DECISION:")) decision = line.replace("DECISION:", "").trim()
			if (line.startsWith("REASON:")) reason = line.replace("REASON:", "").trim()
			if (line.startsWith("ACTION:")) action = line.replace("ACTION:", "").trim()
			if (line.startsWith("WAIT_SECONDS:")) waitSeconds = parseInt(line.replace("WAIT_SECONDS:", "").trim()) || 0
		}
		coordLog(`Ollama decided: ${decision} — ${reason} (wait=${waitSeconds}s)`)
	} else {
		// Rule-based fallback when Ollama is unavailable
		if (hasConflicts) { decision = "WAIT"; reason = "File conflict with another agent"; waitSeconds = 60; action = "Wait 60s and try again, or work on a different file" }
		else if (ollamaFull) { decision = "WAIT"; reason = "Ollama at max capacity"; waitSeconds = 30; action = "Wait 30s for current model calls to finish" }
		coordLog(`Rule-based fallback: ${decision}`)
	}

	const icon = decision === "PROCEED" ? "✅" : "⏳"
	return [
		`## ${icon} ${decision}`,
		``,
		`**Agent**: ${callerAgent}  |  **Priority**: ${priority}`,
		`**Task**: ${task.slice(0, 120)}`,
		`**Reason**: ${reason}`,
		`**Action**: ${action}`,
		waitSeconds > 0 ? `**Wait**: ${waitSeconds} seconds before retrying` : "",
		``,
		`### Situation`,
		hasConflicts ? conflictReport : `✅ No file conflicts`,
		`Ollama: ${ollamaSlots.length}/${MAX_CONCURRENT_OLLAMA} slots`,
		activeTasks.length > 0 ? `Active: ${activeTasks.map(t => `${t.agent}→${t.title.slice(0,30)}`).join(" | ")}` : "No other agents active",
	].filter(Boolean).join("\n")
}

function optionalArg(args, flag, value) {
	if (value === undefined || value === null || value === false || value === "") return
	args.push(flag)
	if (value !== true) args.push(String(value))
}

async function handleToolCall(name, input = {}) {
	switch (name) {
		case "brain_status":
			return textResult(await runCodexBrain(["status"], 30000))
		case "warmup":
			return textResult(await runCodexBrain(["warmup"], 240000))
		case "retrieve_context": {
			const args = ["retrieve", input.task]
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.limit)
			return textResult(await runCodexBrain(args))
		}
		case "collect_context": {
			const args = ["collect", input.task]
			optionalArg(args, "--code-context", input.code_context)
			optionalArg(args, "--research-topic", input.research_topic)
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.memory_limit)
			if (input.web_search === false) args.push("--no-web")
			return textResult(await runCodexBrain(args, 240000))
		}
		case "research": {
			const args = ["research", input.topic]
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.limit)
			return textResult(await runCodexBrain(args, 240000))
		}
		case "analyze_task": {
			const args = ["analyze", input.task]
			optionalArg(args, "--code-context", input.code_context)
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.limit)
			return textResult(await runCodexBrain(args))
		}
		case "code":
			return textResult(await withAutoEnforce("code", input.prompt, () => runCodeTool("code", input, 180000)))
		case "code_pro":
			return textResult(await withAutoEnforce("code_pro", input.prompt, () => runCodeTool("code-pro", input, 240000)))
		case "code_pro_verified": {
			const args = ["code-verified", input.prompt]
			optionalArg(args, "--context", input.context)
			optionalArg(args, "--retries", input.retries)
			return textResult(await withAutoEnforce("code_pro_verified", input.prompt, () => runCodexBrain(args, 300000)))
		}
		case "code_with_memory": {
			const args = ["code-with-memory", input.prompt]
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.limit)
			if (input.fast) args.push("--fast")
			return textResult(await withAutoEnforce("code_with_memory", input.prompt, () => runCodexBrain(args, 240000)))
		}
		case "remember": {
			const args = ["remember", input.content]
			optionalArg(args, "--collection", input.collection || "general")
			if (Array.isArray(input.tags) && input.tags.length) optionalArg(args, "--tags", input.tags.join(","))
			return textResult(await runCodexBrain(args, 60000))
		}
		case "recall": {
			const args = ["recall", input.query]
			optionalArg(args, "--collection", input.collection)
			optionalArg(args, "--limit", input.limit)
			return textResult(await runCodexBrain(args, 60000))
		}
		case "list_collections":
			return textResult(await runCodexBrain(["collections"], 30000))
		case "smart_code": {
			// Outcome prediction gate: check ML model before routing
			const gate = predictComplexity(input.prompt, input.context)
			const args = ["smart", input.prompt]
			optionalArg(args, "--context", input.context)
			const result = await withAutoEnforce("smart_code", input.prompt, () => runCodexBrain(args, 300000))
			return textResult(gate.note ? `[routing: ${gate.note}]\n\n${result}` : result)
		}
		case "risk_assess": {
			const args = ["risk-assess", input.task]
			optionalArg(args, "--action", input.action_type)
			if (Array.isArray(input.files) && input.files.length) optionalArg(args, "--files", input.files.join(","))
			optionalArg(args, "--logs", input.logs)
			optionalArg(args, "--context", input.context)
			if (Array.isArray(input.commands) && input.commands.length) optionalArg(args, "--commands", input.commands.join(","))
			optionalArg(args, "--project", input.project_id)
			if (input.persist === false) args.push("--no-persist")
			return textResult(await runCodexBrain(args, 60000))
		}
		case "risk_record_pattern": {
			const args = ["risk-record-pattern", input.signature]
			optionalArg(args, "--description", input.description)
			optionalArg(args, "--severity", input.severity)
			optionalArg(args, "--pattern-type", input.pattern_type)
			optionalArg(args, "--suggested-fix", input.suggested_fix)
			optionalArg(args, "--project", input.project_id)
			return textResult(await runCodexBrain(args, 60000))
		}
		case "risk_stats": {
			const args = ["risk-stats"]
			optionalArg(args, "--project", input.project_id)
			return textResult(await runCodexBrain(args, 30000))
		}
		case "rate_lesson":
			return textResult(ratelesson(input))
		case "record_outcome":
			return textResult(recordOutcome(input))
		case "task_upsert":
			return textResult(taskUpsert(input))
		case "task_list":
			return textResult(taskList(input))
		case "ask_hermes3": {
			// Direct Hermes 3 query via Ollama - bypasses tool call formatting issues
			const hermesModel = process.env.CODEX_BRAIN_HERMES_MODEL || "hermes3:latest"
			const prompt = input.prompt
			const ollamaUrl = process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
			try {
				const res = await fetch(`${ollamaUrl}/api/generate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: hermesModel,
						prompt,
						stream: false,
						options: { temperature: 0.3, num_predict: 2000 },
					}),
					signal: AbortSignal.timeout(60000),
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const data = await res.json()
				return textResult(data.response?.trim() || "No response from Hermes 3")
			} catch (e) {
				return errorResult(`Hermes 3 query failed: ${e.message}`)
			}
		}
		case "ask_hermes3_with_memory": {
			// Hermes 3 with RAG context - gets memories then queries Hermes
			const hermesModel = process.env.CODEX_BRAIN_HERMES_MODEL || "hermes3:latest"
			const prompt = input.prompt
			const collection = input.collection || null
			const limit = input.limit || 5
			const ollamaUrl = process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
			try {
				// First get relevant memories
				const memories = await runCodexBrain(["recall", prompt], 60000)
				const memoryContext = memories && memories.trim() ? `\n\nRelevant context:\n${memories}` : ""
				// Then query Hermes with context
				const res = await fetch(`${ollamaUrl}/api/generate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: hermesModel,
						prompt: prompt + memoryContext,
						stream: false,
						options: { temperature: 0.3, num_predict: 2000 },
					}),
					signal: AbortSignal.timeout(60000),
				})
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const data = await res.json()
				const note = memories && memories.trim() ? `\n\n*[Used ${limit} memories from context]*` : ""
				return textResult((data.response?.trim() || "No response from Hermes 3") + note)
			} catch (e) {
				return errorResult(`Hermes 3 with memory failed: ${e.message}`)
			}
		}
		case "orchestrate_task":
			return textResult(await withAutoEnforce("orchestrate_task", input.task, () => orchestrateTask(input)))
		case "architect_plan":
			return textResult(await withAutoEnforce("architect_plan", input.task, () => architectPlan(input)))
		case "review_code":
			return textResult(await withAutoEnforce("review_code", input.code?.slice(0,100), () => reviewCode(input)))
		case "check_conflicts":
			return textResult(handleCheckConflicts(input))
		case "coordinate_before_code":
			return textResult(await coordinateBeforeCode(input))
		case "write_file":
			return textResult(handleWriteFile(input))
		case "edit_file":
			return textResult(handleEditFile(input))
		case "read_file":
			return textResult(handleReadFile(input))
		case "generate_skill":
			return textResult(await handleGenerateSkill(input))
		case "enforcement_status":
			return textResult(getEnforcementStatus())
		case "deploy_to_vps":
			return textResult(await handleDeployToVps(input))
		case "deploy_status":
			return textResult(getDeployStatus())
		case "rollback_deploy":
			return textResult(await handleRollbackDeploy(input))
		case "debug_loop":
			return textResult(await startDebugLoop(input))
		case "debug_loop_status":
			return textResult(getDebugLoopStatus())
		default:
			return errorResult(`Unknown tool: ${name}`)
	}
}

function runCodeTool(command, input, timeoutMs) {
	const args = [command, input.prompt]
	optionalArg(args, "--context", input.context)
	return runCodexBrain(args, timeoutMs)
}

function extractFeaturesForOutcome(prompt = "") {
	const text = prompt.toLowerCase()
	const complexKw = ["refactor", "architecture", "migration", "redesign", "multi-file", "integration", "module", "service", "pipeline", "system", "implement"]
	const criticalKw = ["production", "critical", "security", "auth", "payment", "deploy", "database", "schema", "race condition", "memory leak"]
	const simpleKw = ["fix typo", "rename", "add comment", "format", "lint", "small"]
	const fileCount  = (text.match(/\.(ts|tsx|js|jsx|mjs|py|go|rs|java|cs)\b/g) || []).length
	const lineCount  = prompt.split("\n").length
	const codeBlocks = (prompt.match(/```/g) || []).length / 2
	const complexScore  = complexKw.filter(k => text.includes(k)).length
	const criticalScore = criticalKw.filter(k => text.includes(k)).length
	const simpleScore   = simpleKw.filter(k => text.includes(k)).length
	return [
		Math.min(fileCount / 10, 1),
		Math.min(lineCount / 300, 1),
		Math.min(complexScore / 5, 1),
		criticalScore > 0 ? 1 : 0,
		Math.min(prompt.length / 3000, 1),
		codeBlocks > 0 ? 1 : 0,
		fileCount > 2 ? 1 : 0,
		simpleScore > 0 ? 0 : 1,
	]
}

function recordOutcome(input) {
	fs.mkdirSync(path.dirname(OUTCOMES), { recursive: true })
	const now = new Date()
	const entry = {
		...input,
		features: input.features?.length === 8 ? input.features : extractFeaturesForOutcome(input.prompt || ""),
		date: now.toISOString().split("T")[0],
		source: "codex-brain-mcp",
		agent: AGENT_ID,
		createdAt: now.toISOString(),
	}
	// Write to the shared codex-brain store (always)
	fs.appendFileSync(OUTCOMES, `${JSON.stringify(entry)}\n`, "utf8")

	// Auto-rate the lessons retrieved for this task: the task outcome is a
	// proxy for how helpful those lessons were. Explicit rate_lesson calls
	// can still override (they append later entries to the same ledger).
	try {
		const lastRetrievalPath = path.join(GLOBAL_MEMORY_DIR, `last-retrieval-${AGENT_ID}.json`)
		if (fs.existsSync(lastRetrievalPath)) {
			const lr = JSON.parse(fs.readFileSync(lastRetrievalPath, "utf8"))
			const ageMs = now.getTime() - new Date(lr.timestamp || 0).getTime()
			if (Array.isArray(lr.ids) && lr.ids.length && ageMs < 2 * 3600 * 1000) {
				const lines = lr.ids.map(id => JSON.stringify({
					lesson_id: id,
					helpful: input.success ? 1 : 0,
					context_task: lr.task || input.prompt || "",
					note: "auto-rated from record_outcome",
					agent: AGENT_ID,
					timestamp: now.toISOString(),
				}))
				fs.appendFileSync(HELPFULNESS_LEDGER, lines.join("\n") + "\n", "utf8")
			}
			fs.unlinkSync(lastRetrievalPath)
		}
	} catch {}

	// Also write to the agent-specific outcomes file so ML training can specialise per agent
	const agentOutcomePath = AGENT_OUTCOME_FILES[AGENT_ID]
	if (agentOutcomePath && agentOutcomePath !== OUTCOMES) {
		try {
			fs.mkdirSync(path.dirname(agentOutcomePath), { recursive: true })
			fs.appendFileSync(agentOutcomePath, `${JSON.stringify(entry)}\n`, "utf8")
		} catch {}
	}

	// Also merge into brain MCP ml-outcomes.json so the ML router learns from Kilo/Codex outcomes too
	const BRAIN_OUTCOMES = process.env.BRAIN_OUTCOMES_PATH
		|| path.join(os.homedir(), "brain", "data", "ml-outcomes.json")
	try {
		let existing = []
		if (fs.existsSync(BRAIN_OUTCOMES)) {
			existing = JSON.parse(fs.readFileSync(BRAIN_OUTCOMES, "utf8"))
		}
		existing.push(entry)
		if (existing.length > 500) existing.splice(0, existing.length - 500)
		fs.mkdirSync(path.dirname(BRAIN_OUTCOMES), { recursive: true })
		fs.writeFileSync(BRAIN_OUTCOMES, JSON.stringify(existing, null, 2), "utf8")
	} catch {
		// Brain MCP store unavailable — codex-brain local store is sufficient
	}

	return `Outcome recorded in ${path.relative(ROOT, OUTCOMES).replaceAll("\\", "/")} + brain MCP store`
}

// ── Lesson Helpfulness Ledger ─────────────────────────────────────────────────

function ratelesson(input) {
	fs.mkdirSync(path.dirname(HELPFULNESS_LEDGER), { recursive: true })
	const entry = {
		lesson_id: input.lesson_id,
		helpful: input.helpful,
		context_task: input.context_task || "",
		note: input.note || "",
		agent: PROJECT_ID,
		timestamp: new Date().toISOString(),
	}
	fs.appendFileSync(HELPFULNESS_LEDGER, JSON.stringify(entry) + "\n", "utf8")
	return `Lesson ${input.lesson_id} rated ${input.helpful ? "👍 helpful" : "👎 not helpful"}. Ledger updated.`
}

// ── Outcome Prediction Gate ───────────────────────────────────────────────────

function predictComplexity(prompt, context = "") {
	const text = ((prompt || "") + " " + (context || "")).toLowerCase()
	const criticalKw = ["production", "critical", "security", "auth", "payment", "deploy",
		"database", "schema", "race condition", "memory leak", "breaking", "urgent", "hotfix"]
	const complexKw = ["refactor", "architecture", "migration", "multi-file", "integration",
		"feature", "implement", "redesign", "system", "pipeline", "module", "service"]
	const fileCount = (text.match(/\.(ts|tsx|js|jsx|mjs|py|go|rs|css|json)\b/g) || []).length
	const critScore = criticalKw.filter(k => text.includes(k)).length
	const compScore = complexKw.filter(k => text.includes(k)).length
	const lineCount = (prompt || "").split("\n").length

	// Try ML model prediction
	try {
		const modelPath = path.join(SUPERROO_HOME, "models", "code-learner.json")
		if (fs.existsSync(modelPath)) {
			const model = JSON.parse(fs.readFileSync(modelPath, "utf8"))
			const features = [
				Math.min(fileCount / 5, 1), Math.min(lineCount / 50, 1),
				Math.min(compScore / 4, 1), critScore > 0 ? 1 : 0,
				Math.min((prompt || "").split(/\s+/).length / 200, 1), 0.5, 0.5, 0.5,
			]
			const enc = model.encoder
			if (enc?.W1?.length === 8) {
				const b1 = enc.b1 || new Array(enc.W1[0]?.length || 128).fill(0)
				const hidden = b1.map((bias, j) => {
					let s = bias
					for (let i = 0; i < features.length; i++) s += features[i] * (enc.W1[i]?.[j] || 0)
					return Math.max(0, s)
				})
				const bugH = model.heads?.bugRisk
				if (bugH?.W1) {
					const bugScore = bugH.b1.map((b, j) => {
						let s = b
						for (let i = 0; i < hidden.length; i++) s += hidden[i] * (bugH.W1[i]?.[j] || 0)
						return Math.exp(s)
					})
					const total = bugScore.reduce((a, b) => a + b, 0) + 1e-10
					const highRisk = bugScore[2] / total  // index 2 = high risk
					if (highRisk > 0.5 || critScore > 0) {
						return { forcedTool: "code-pro-verified", note: `ML: high bug risk (${(highRisk*100).toFixed(0)}%) → forced code_pro_verified` }
					}
					if (highRisk > 0.25 || compScore > 1 || fileCount > 2) {
						return { forcedTool: "code-pro", note: `ML: medium complexity → code_pro` }
					}
				}
			}
		}
	} catch { /* fall through */ }

	// Heuristic fallback
	if (critScore > 0) return { forcedTool: "code-pro-verified", note: "heuristic: critical keywords → code_pro_verified" }
	if (compScore > 1 || fileCount > 2 || lineCount > 30) return { forcedTool: "code-pro", note: "heuristic: complex → code_pro" }
	return { forcedTool: null, note: null }
}

function loadTaskRegistry() {
	fs.mkdirSync(path.dirname(GLOBAL_TASK_REGISTRY), { recursive: true })
	try { return JSON.parse(fs.readFileSync(GLOBAL_TASK_REGISTRY, "utf8")) }
	catch { return { version: 1, projects: {} } }
}

function saveTaskRegistry(registry) {
	fs.mkdirSync(path.dirname(GLOBAL_TASK_REGISTRY), { recursive: true })
	fs.writeFileSync(GLOBAL_TASK_REGISTRY, JSON.stringify(registry, null, 2), "utf8")
}

function taskUpsert(input) {
	// Check for file-level conflicts when starting a task
	let conflictWarning = ""
	if (input.status === "active" && input.files?.length) {
		const conflicts = checkFileLocks(input.files)
		if (conflicts.length > 0) {
			conflictWarning = `\n⚠️ FILE CONFLICT: ${conflicts.map(c => `${c.agent} is editing ${c.file}`).join(", ")}. Coordinate before proceeding.`
		}
		// Claim file locks for active tasks
		input.files.forEach(f => claimFileLock(f))
	}

	// Release file locks when task completes/cancels
	if ((input.status === "completed" || input.status === "cancelled") && input.files?.length) {
		input.files.forEach(f => {
			const key = f.replace(/[:/\\]/g, "_")
			try { fs.unlinkSync(path.join(FILE_LOCK_DIR, `${key}.lock`)) } catch {}
		})
	}

	// Atomic read-modify-write with cross-process lock
	let result = ""
	const doUpsert = () => {
		const registry = loadTaskRegistry()
		if (!registry.projects[PROJECT_ID]) registry.projects[PROJECT_ID] = {}
		const project = registry.projects[PROJECT_ID]
		const agent = input.agent || AGENT_ID || "unknown"
		if (!project[agent]) project[agent] = []

		const tasks = project[agent]
		const now = new Date().toISOString()
		const existing = tasks.findIndex(t => t.id === input.id)
		const task = {
			id: input.id, title: input.title, status: input.status, agent,
			summary: input.summary || "", files: input.files || [],
			features: input.features || [], updatedAt: now,
			createdAt: existing >= 0 ? tasks[existing].createdAt : now,
		}
		if (existing >= 0) tasks[existing] = task
		else tasks.push(task)
		if (tasks.length > 100) tasks.splice(0, tasks.length - 100)
		project.updatedAt = now
		saveTaskRegistry(registry)
		result = `Task ${existing >= 0 ? "updated" : "created"}: [${input.status}] ${input.title} (${input.id})`
	}

	// Try atomic lock, fall back to direct write if lock times out
	withTaskLock(doUpsert).catch(() => doUpsert())

	return result + conflictWarning
}

function taskList(input) {
	const registry = loadTaskRegistry()
	const projectFilter = input.project || PROJECT_ID
	const statusFilter = input.status || "all"
	const agentFilter = input.agent
	const limit = input.limit || 20

	const results = []
	const projects = projectFilter === "all"
		? Object.keys(registry.projects)
		: [projectFilter]

	for (const proj of projects) {
		const projData = registry.projects[proj] || {}
		for (const [agent, tasks] of Object.entries(projData)) {
			if (agent === "updatedAt") continue
			if (agentFilter && agent !== agentFilter) continue
			for (const task of (Array.isArray(tasks) ? tasks : [])) {
				if (statusFilter !== "all" && task.status !== statusFilter) continue
				results.push({ project: proj, ...task })
			}
		}
	}

	results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
	const slice = results.slice(0, limit)

	if (slice.length === 0) return `No tasks found (project=${projectFilter} status=${statusFilter})`
	return slice.map(t =>
		`[${t.status}] ${t.title}\n  id=${t.id} agent=${t.agent} project=${t.project} updated=${t.updatedAt?.slice(0, 10)}`
	).join("\n\n")
}

// ── Multi-Agent Orchestration ─────────────────────────────────────────────────

async function architectPlan(input) {
	const { task, context } = input
	const prompt = `You are a senior software architect. Analyze this task and produce a structured implementation plan.

TASK: ${task}
${context ? `\nCONTEXT:\n${context}` : ""}

Produce:
## Complexity
[low/medium/high] — one sentence reason

## Architecture Decision
What approach and why

## Task Breakdown
For each subtask:
- **Subtask N**: [title]
  - Files: [files to change]
  - What: [what to implement]
  - Acceptance: [done criteria]

## Risk Flags
Any gotchas, edge cases, or things that could break

## Model Hint
[fast|pro|verified] — which coder tier to use and why`

	const result = await runCodexBrain(["collect", prompt], 120000)
	return `## Architect Phase\n\n${result}`
}

async function reviewCode(input) {
	const { code, task, context } = input
	const prompt = `You are a senior code reviewer. Review this code for correctness, security, and quality.

ORIGINAL TASK: ${task}
${context ? `\nCONTEXT:\n${context}` : ""}

CODE TO REVIEW:
\`\`\`
${code}
\`\`\`

Produce structured review:
## Status
[PASS | NEEDS_CHANGES | FAIL]

## Issues Found
For each issue:
- **[CRITICAL|WARNING|INFO]** File:line — description and fix

## Security Check
Any security concerns

## Verdict
One sentence. If NEEDS_CHANGES: list exact changes coder must make.`

	const result = await runCodexBrain(["collect", prompt], 90000)
	return `## Reviewer Phase\n\n${result}`
}

const ORCH_PROGRESS_DIR = path.join(SUPERROO_HOME, "tasks", "orchestration")

function writeOrchestraProgress(taskId, phase, status, detail = "") {
	try {
		fs.mkdirSync(ORCH_PROGRESS_DIR, { recursive: true })
		const prog = { taskId, phase, status, detail: detail.slice(0, 200), updatedAt: new Date().toISOString() }
		fs.writeFileSync(path.join(ORCH_PROGRESS_DIR, `${taskId}.json`), JSON.stringify(prog, null, 2), "utf8")
		coordLog(`Orchestration ${taskId}: Phase ${phase} → ${status}`)
	} catch {}
}

const ORCHESTRATE_GLOBAL_TIMEOUT_MS = 10 * 60 * 1000  // 10 min hard cap — prevents infinite hangs

async function orchestrateTask(input) {
	const { task, context, files, max_review_loops = 2 } = input
	const phases = []
	const startTime = Date.now()
	const taskId = `orch-${Date.now().toString(36)}`

	// Global hard timeout — kills the entire orchestration if it exceeds limit
	let globalTimeoutFired = false
	const globalTimer = setTimeout(() => {
		globalTimeoutFired = true
		coordLog(`orchestrateTask HARD TIMEOUT after ${ORCHESTRATE_GLOBAL_TIMEOUT_MS/60000}min: ${task.slice(0,80)}`)
		writeOrchestraProgress(taskId, 99, "timeout", `Hard timeout after ${ORCHESTRATE_GLOBAL_TIMEOUT_MS/60000}min`)
	}, ORCHESTRATE_GLOBAL_TIMEOUT_MS)

	function checkTimeout() {
		if (globalTimeoutFired) throw new Error(`Orchestration exceeded ${ORCHESTRATE_GLOBAL_TIMEOUT_MS/60000} minute limit. Cancel and retry with a smaller task.`)
	}

	try {
	writeOrchestraProgress(taskId, 0, "starting", task.slice(0, 100))

	// ── Phase 0: Product Memory Risk Check ──
	let riskLevel = "low"
	let routingHint = "smart_code"
	if (files?.length) {
		try {
			const productCtx = await runCodexBrain(
				["collect", `Get product memory context for files: ${files.join(", ")}`],
				30000
			)
			if (productCtx.toLowerCase().includes("high")) riskLevel = "high"
			else if (productCtx.toLowerCase().includes("medium")) riskLevel = "medium"
			routingHint = riskLevel === "high" ? "code_pro_verified"
				: riskLevel === "medium" ? "code_pro" : "smart_code"
		} catch {}
	}
	phases.push(`## Phase 0: Risk Assessment\nRisk: ${riskLevel} → Using: ${routingHint}\n`)
	writeOrchestraProgress(taskId, 0, "done", `risk=${riskLevel} model=${routingHint}`)

	// ── Phase 1: Memory Retrieval (Thinker) ──
	let memoryContext = ""
	try {
		memoryContext = await runCodexBrain(["retrieve", task], 60000)
		phases.push(`## Phase 1: Memory Context Retrieved\n${memoryContext.slice(0, 800)}\n`)
	} catch {
		phases.push("## Phase 1: Memory Retrieval\nNo prior context found.\n")
	}

	checkTimeout()
	// ── Phase 2: Architect ──
	writeOrchestraProgress(taskId, 2, "running", "designing solution")
	let plan = ""
	try {
		const archInput = { task, context: [context, memoryContext].filter(Boolean).join("\n\n---\n\n") }
		plan = await architectPlan(archInput)
		phases.push(plan)
	} catch (e) {
		phases.push(`## Phase 2: Architect\nFailed: ${e.message}`)
	}

	checkTimeout()
	// ── Phase 3: Coder ──
	writeOrchestraProgress(taskId, 3, "running", "implementing...")
	const coderPrompt = `${task}\n\nArchitect Plan:\n${plan}\n\n${context ? `Context:\n${context}` : ""}`
	let implementation = ""
	try {
		const coderCmd = riskLevel === "high"
			? ["code-verified", coderPrompt]
			: riskLevel === "medium"
				? ["code-pro", coderPrompt]
				: ["smart", coderPrompt]
		implementation = await runCodexBrain(coderCmd, 300000)
		phases.push(`## Phase 3: Implementation\n\n${implementation}`)
	} catch (e) {
		phases.push(`## Phase 3: Coder\nFailed: ${e.message}`)
		return phases.join("\n\n---\n\n")
	}

	checkTimeout()
	// ── Phase 4: Reviewer (with feedback loop) ──
	writeOrchestraProgress(taskId, 4, "running", "reviewing code...")
	let finalImplementation = implementation
	for (let loop = 0; loop < max_review_loops; loop++) {
		try {
			const review = await reviewCode({ code: finalImplementation, task, context })
			phases.push(`## Phase 4: Review (iteration ${loop + 1})\n\n${review}`)
			if (review.toUpperCase().includes("## STATUS\nPASS") || review.toUpperCase().includes("STATUS\nPASS")) {
				break
			}
			// Extract fix requests and re-run coder
			const fixPrompt = `Fix the following review issues:\n\n${review}\n\nOriginal code:\n${finalImplementation}\n\nTask: ${task}`
			finalImplementation = await runCodexBrain(["code-pro", fixPrompt], 240000)
			phases.push(`## Phase 4: Fix Applied (iteration ${loop + 1})\n\n${finalImplementation}`)
		} catch { break }
	}

	writeOrchestraProgress(taskId, 5, "done", `complete in ${((Date.now()-startTime)/1000).toFixed(1)}s`)
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

	// ── Phase 5: Store lesson ──
	try {
		await runCodexBrain(["remember", `Multi-agent task completed: ${task.slice(0, 100)}. Risk: ${riskLevel}. Used: ${routingHint}.`, "--collection", "code"], 30000)
	} catch {}

	return [
		`# Orchestration Complete (${elapsed}s)`,
		`**Task**: ${task}`,
		`**Risk**: ${riskLevel} → **Model**: ${routingHint}`,
		`**Loops**: ${max_review_loops}`,
		"",
		...phases,
		"---",
		"## Final Implementation",
		finalImplementation,
	].join("\n\n")

	} catch (err) {
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
		return `## ❌ Orchestration Failed (${elapsed}s)\n\n**Task**: ${task}\n**Error**: ${err.message}\n\nTry breaking the task into smaller pieces.`
	} finally {
		clearTimeout(globalTimer)
	}
}

// ── File Editor (Blackbox + all agents) ──────────────────────────────────────

function resolveFilePath(filePath) {
	if (path.isAbsolute(filePath)) return filePath
	return path.resolve(process.env.PROJECT_ROOT || ROOT, filePath)
}

function handleWriteFile({ path: filePath, content, create_dirs = true }) {
	const abs = resolveFilePath(filePath)
	if (create_dirs) fs.mkdirSync(path.dirname(abs), { recursive: true })
	fs.writeFileSync(abs, content, "utf8")
	const lines = content.split("\n").length
	return `✅ Written: ${abs} (${lines} lines, ${content.length} bytes)`
}

function handleEditFile({ path: filePath, old_text, new_text }) {
	const abs = resolveFilePath(filePath)
	if (!fs.existsSync(abs)) return `❌ File not found: ${abs}`
	const original = fs.readFileSync(abs, "utf8")
	if (!original.includes(old_text)) {
		return `❌ Text not found in ${abs}.\n\nSearched for:\n${old_text.slice(0, 200)}\n\nFile starts with:\n${original.slice(0, 200)}`
	}
	const updated = original.replace(old_text, new_text)
	fs.writeFileSync(abs, updated, "utf8")
	return `✅ Edited: ${abs}\n  Replaced ${old_text.length} chars with ${new_text.length} chars`
}

function handleReadFile({ path: filePath, max_lines = 200 }) {
	const abs = resolveFilePath(filePath)
	if (!fs.existsSync(abs)) return `❌ File not found: ${abs}`
	const content = fs.readFileSync(abs, "utf8")
	const lines = content.split("\n")
	const truncated = lines.length > max_lines
	return `// FILE: ${abs} (${lines.length} lines${truncated ? `, showing first ${max_lines}` : ""})\n\n` +
		lines.slice(0, max_lines).join("\n") +
		(truncated ? `\n\n... (${lines.length - max_lines} more lines)` : "")
}

// ── Auto-Skill Generation ─────────────────────────────────────────────────────

async function handleGenerateSkill({ name, description, content, category = "coding" }) {
	const skillName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
	const H = os.homedir()

	// ── 1. Canonical location: ~/.superroo/skills/<name>/ ────────────────────
	const canonicalDir = path.join(H, ".superroo", "skills", skillName)
	fs.mkdirSync(canonicalDir, { recursive: true })

	const frontmatter = `---\nname: ${skillName}\ndescription: ${description}\ncategory: ${category}\n---\n\n`
	const skillContent = frontmatter + content
	fs.writeFileSync(path.join(canonicalDir, "SKILL.md"), skillContent, "utf8")

	// ── 2. Shims in all 4 extension skill directories ─────────────────────────
	const shimContent = `---\nname: ${skillName}\ndescription: ${description}\n---\n\nCanonical skill:\n  ${canonicalDir}/SKILL.md\n`
	const shimDirs = [
		path.join(H, ".kilo", "skill", skillName),
		path.join(H, ".claude", "skills", skillName),
		path.join(H, ".codex", "skills", skillName),
		path.join(H, "Documents", ".blackbox", "skills", skillName),
	]
	const shimResults = []
	for (const dir of shimDirs) {
		try {
			fs.mkdirSync(dir, { recursive: true })
			// Only write shim if canonical file doesn't already exist at this path
			if (dir !== canonicalDir) {
				fs.writeFileSync(path.join(dir, "SKILL.md"), shimContent, "utf8")
				shimResults.push(dir.replace(H, "~"))
			}
		} catch (e) { shimResults.push(`SKIP ${dir}: ${e.message.slice(0,40)}`) }
	}

	// ── 3. Store as a lesson ──────────────────────────────────────────────────
	const lesson = {
		id: `skill-${skillName}-${Date.now()}`,
		title: `Skill Created: ${skillName}`,
		type: "skill",
		date: new Date().toISOString().split("T")[0],
		source: "global-skills-agent",
		agent: AGENT_ID,
		tags: ["skill", category, skillName],
		lesson_summary: description,
		rule_summary: `Use the ${skillName} skill when: ${description}`,
		project: PROJECT_ID,
	}
	try { fs.appendFileSync(path.join(GLOBAL_MEMORY_DIR, "lesson-index.jsonl"), JSON.stringify(lesson) + "\n", "utf8") } catch {}

	coordLog(`Generated skill: ${skillName} (${category}) → ${canonicalDir}`)

	return [
		`✅ Skill "${skillName}" created`,
		`📁 CANONICAL: ~/.superroo/skills/${skillName}/SKILL.md`,
		`🔗 Shims: ${shimResults.join(", ")}`,
		`📁 ~/.claude/skills/${skillName}/SKILL.md`,
		`📝 Added to global lesson index`,
		``,
		`**Description**: ${description}`,
		`**Category**: ${category}`,
		`**Reload VS Code** to pick up the new skill in Kilo + Claude.`,
	].join("\n")
}

// ── Enforcement Layer ─────────────────────────────────────────────────────────
// Auto-records outcomes for every coding tool. Agents cannot bypass this.

const CODING_TOOLS_ENFORCED = new Set([
	"smart_code","code","code_pro","code_pro_verified","code_with_memory",
	"orchestrate_task","architect_plan","review_code"
])

function loadEnforcementLedger() {
	try { return JSON.parse(fs.readFileSync(ENFORCEMENT_LEDGER, "utf8")) }
	catch { return { agents: {}, totalAutoRecorded: 0, lastUpdated: null } }
}

function updateEnforcementLedger(toolName, agentId, success) {
	try {
		fs.mkdirSync(path.dirname(ENFORCEMENT_LEDGER), { recursive: true })
		const ledger = loadEnforcementLedger()
		if (!ledger.agents[agentId]) ledger.agents[agentId] = { total: 0, autoRecorded: 0, manualRecorded: 0, lastTool: null, lastAt: null }
		const a = ledger.agents[agentId]
		a.total++
		a.autoRecorded++
		a.lastTool = toolName
		a.lastAt = new Date().toISOString()
		a.compliance = (a.autoRecorded + a.manualRecorded) / a.total
		ledger.totalAutoRecorded = (ledger.totalAutoRecorded || 0) + 1
		ledger.lastUpdated = new Date().toISOString()
		fs.writeFileSync(ENFORCEMENT_LEDGER, JSON.stringify(ledger, null, 2), "utf8")
	} catch {}
}

function detectSuccess(result) {
	if (!result || typeof result !== "string") return 1
	const lower = result.toLowerCase()
	// Explicit failure signals
	if (lower.includes("error:") || lower.includes("timed out") || lower.includes("failed:") ||
		lower.includes("cannot find") || lower.includes("enoent")) return 0
	// Orchestration failure
	if (lower.includes("orchestration failed")) return 0
	return 1
}

async function withAutoEnforce(toolName, prompt, fn) {
	const startTime = Date.now()
	let success = 1
	let result = ""
	try {
		result = await fn()
		success = detectSuccess(result)
	} catch (e) {
		success = 0
		result = `❌ ${e.message}`
		throw e
	} finally {
		// Auto-record outcome regardless of success/failure
		const entry = {
			success,
			prompt: (prompt || "").slice(0, 300),
			tool_used: toolName,
			quality: success ? 0.75 : 0.2,
			duration_ms: Date.now() - startTime,
			agent: AGENT_ID,
			auto_recorded: true,
			source: "enforcement-hook",
			createdAt: new Date().toISOString(),
		}
		try {
			// Write to shared outcomes (all agents read this)
			fs.mkdirSync(path.dirname(OUTCOMES), { recursive: true })
			fs.appendFileSync(OUTCOMES, JSON.stringify(entry) + "\n", "utf8")
			// Write to agent-specific file
			const agentFile = AGENT_OUTCOME_FILES[AGENT_ID]
			if (agentFile && agentFile !== OUTCOMES) {
				try { fs.mkdirSync(path.dirname(agentFile), { recursive: true }); fs.appendFileSync(agentFile, JSON.stringify(entry) + "\n", "utf8") } catch {}
			}
			// Update enforcement ledger
			updateEnforcementLedger(toolName, AGENT_ID, success)
		} catch {}
	}
	return result
}

// ── Enforcement Status Tool ───────────────────────────────────────────────────

function getEnforcementStatus() {
	const ledger = loadEnforcementLedger()
	const totalOutcomes = (() => {
		let n = 0
		try { n += fs.readFileSync(OUTCOMES,"utf8").trim().split("\n").filter(Boolean).length } catch {}
		return n
	})()

	const agentRows = Object.entries(ledger.agents || {}).map(([id, a]) => {
		const pct = Math.round((a.compliance || 0) * 100)
		const icon = pct >= 80 ? "✅" : pct >= 40 ? "⚠️" : "🔴"
		return `  ${icon} ${id.padEnd(12)} ${pct}% compliance | ${a.total} calls | last: ${a.lastTool || "none"} (${(a.lastAt||"never").slice(0,10)})`
	}).join("\n")

	return [
		"## Enforcement Status\n",
		`Auto-recorded outcomes: ${ledger.totalAutoRecorded || 0}`,
		`Total in outcomes.jsonl: ${totalOutcomes}`,
		`Last updated: ${ledger.lastUpdated || "never"}`,
		"",
		"### Per-Agent Compliance",
		agentRows || "  No agents have used coding tools yet",
		"",
		"### How it works",
		"Every coding tool call (smart_code, code_pro, orchestrate_task, etc.)",
		"auto-records an outcome via the enforcement hook BEFORE returning.",
		"Agents cannot bypass this. Manual record_outcome() adds richer quality data.",
	].join("\n")
}

// ── Debug Loop MCP Handlers ───────────────────────────────────────────────────

const DEBUG_LOOP_SCRIPT = path.join(ROOT, "scripts", "debug-loop.mjs")
const DEBUG_LOOP_STATE  = path.join(SUPERROO_HOME, "tasks", "debug-loop-state.json")

async function startDebugLoop({ bug, max_attempts = 8, vision = true, vps = true, docker = true, dry_run = false }) {
	if (!fs.existsSync(DEBUG_LOOP_SCRIPT)) {
		return `❌ debug-loop.mjs not found at ${DEBUG_LOOP_SCRIPT}`
	}

	const flags = [
		`--max=${max_attempts}`,
		...(vision ? [] : ["--no-vision"]),
		...(vps ? [] : ["--no-vps"]),
		...(docker ? [] : ["--no-docker"]),
		...(dry_run ? ["--dry-run"] : []),
	]

	coordLog(`Starting debug loop: "${bug.slice(0,80)}" max=${max_attempts}`)

	// Run in background — return immediately with status
	const logFile = path.join(SUPERROO_HOME, "tasks", "debug-loop.log")
	const { spawn } = await import("node:child_process")
	const child = spawn(
		process.execPath,
		[DEBUG_LOOP_SCRIPT, bug, ...flags],
		{
			cwd: ROOT,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
		}
	)
	child.stdout?.on("data", d => { try { fs.appendFileSync(logFile, d) } catch {} })
	child.stderr?.on("data", d => { try { fs.appendFileSync(logFile, d) } catch {} })
	child.unref()

	return [
		`## 🔁 Debug Loop Started`,
		``,
		`**Bug**: ${bug}`,
		`**Max attempts**: ${max_attempts}`,
		`**Vision (llava:7b)**: ${vision ? "✅ enabled" : "❌ disabled"}`,
		`**Docker sandbox**: ${docker ? "✅ enabled" : "❌ disabled"}`,
		`**VPS test**: ${vps ? "✅ enabled (100.64.175.88)" : "❌ disabled"}`,
		`**Dry run**: ${dry_run ? "yes (no code changes)" : "no (real changes)"}`,
		``,
		`Loop is running in background. Each iteration:`,
		`  1. hermes3 generates hypothesis`,
		`  2. qwen3:14b implements fix`,
		`  3. Docker sandbox tests it`,
		`  4. llava:7b vision-verifies screenshots`,
		`  5. VPS final environment test`,
		`  → Pass: commit + lesson stored`,
		`  → Fail: rollback + refine + retry`,
		``,
		`Monitor: \`debug_loop_status()\` | Log: ${logFile}`,
		`Stop: kill the node process running debug-loop.mjs`,
	].join("\n")
}

function getDebugLoopStatus() {
	try {
		const state = JSON.parse(fs.readFileSync(DEBUG_LOOP_STATE, "utf8"))
		const logTail = (() => {
			try {
				const lines = fs.readFileSync(path.join(SUPERROO_HOME,"tasks","debug-loop.log"),"utf8").trim().split("\n")
				return lines.slice(-10).join("\n")
			} catch { return "No log yet" }
		})()

		const statusIcon = { running:"🔄", fixed:"✅", exhausted:"❌", unknown:"❓" }[state.status] || "❓"

		return [
			`## ${statusIcon} Debug Loop Status`,
			``,
			`**Bug**: ${state.bug}`,
			`**Status**: ${state.status}`,
			`**Attempts**: ${state.attempts}/${state.maxAttempts}`,
			`**Started**: ${state.startedAt?.slice(0,19)}`,
			state.fixedAt ? `**Fixed at**: ${state.fixedAt?.slice(0,19)}` : "",
			state.currentHypothesis ? `**Current hypothesis**: ${state.currentHypothesis.hypothesis}` : "",
			``,
			`### Failed attempts (${state.failures?.length || 0})`,
			...(state.failures || []).map((f, i) => `  ${i+1}. ${f.hypothesis} → ${f.result?.slice(0,80)}`),
			``,
			`### Recent log`,
			"```",
			logTail,
			"```",
		].filter(Boolean).join("\n")
	} catch {
		return "No debug loop state found. Start one with debug_loop(bug_description)."
	}
}

// ── Deployment MCP Handlers ───────────────────────────────────────────────────

const VPS_SSH   = `root@100.64.175.88`
const VPS_KEY   = path.join(os.homedir(), ".ssh", "id_superroo_vps")
const VPS_SSH_OPTS = `-i "${VPS_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3`
const DEPLOY_STATE_FILE = path.join(SUPERROO_HOME, "tasks", "deploy-state.json")

function sshCmd(cmd, timeoutSec = 60) {
	return execSync(`ssh ${VPS_SSH_OPTS} ${VPS_SSH} "${cmd}"`, {
		encoding: "utf8", timeout: timeoutSec * 1000, stdio: ["pipe","pipe","pipe"]
	}).trim()
}

function saveDeployState(state) {
	fs.mkdirSync(path.dirname(DEPLOY_STATE_FILE), { recursive: true })
	fs.writeFileSync(DEPLOY_STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}

function loadDeployState() {
	try { return JSON.parse(fs.readFileSync(DEPLOY_STATE_FILE, "utf8")) }
	catch { return null }
}

async function handleDeployToVps({ target = "dashboard", skip_tests = false, max_retries = 3, service } = {}) {
	const startTime = Date.now()
	const log = []
	const addLog = (msg) => { log.push(`[${new Date().toISOString().slice(11,19)}] ${msg}`); coordLog(`DEPLOY: ${msg}`) }

	addLog(`Starting deploy: target=${target} skip_tests=${skip_tests} max_retries=${max_retries}`)
	saveDeployState({ status: "running", target, startedAt: new Date().toISOString(), log })

	// ── Pre-deploy checks ──
	if (!skip_tests) {
		addLog("Running pre-deploy checks...")
		try {
			const { execSync: exec } = await import("node:child_process")
			exec(`cd "${ROOT}" && node scripts/sync-daemon.mjs --once`, { timeout: 60000, stdio: "pipe" })
			addLog("✅ Pre-deploy sync OK")
		} catch { addLog("⚠️  Pre-deploy sync skipped (non-fatal)") }
	}

	// ── Check VPS reachable ──
	addLog("Checking VPS connectivity...")
	try { sshCmd("echo ok", 10); addLog("✅ VPS reachable") }
	catch { return `❌ VPS unreachable at ${VPS_SSH}\nCheck Tailscale: tailscale status` }

	// ── Execute deploy with retries ──
	let success = false
	let lastError = ""
	for (let attempt = 1; attempt <= max_retries; attempt++) {
		addLog(`Deploy attempt ${attempt}/${max_retries}...`)
		try {
			if (target === "docker") {
				sshCmd("cd /opt/superroo2 && docker compose up -d --build", 300)
				addLog("✅ Docker compose restarted")
			} else if (target === "worker" || target === "api" || (service && target !== "all")) {
				const svc = service || (target === "worker" ? "superroo-worker" : "superroo-api")
				sshCmd(`pm2 restart ${svc}`, 60)
				addLog(`✅ PM2 service ${svc} restarted`)
			} else {
				// Full dashboard deploy via deploy script
				const deployScript = path.join(ROOT, "cloud", "remote-deploy-dashboard.sh")
				if (fs.existsSync(deployScript)) {
					execSync(`bash "${deployScript}"`, { cwd: ROOT, timeout: 300000, stdio: "pipe", encoding: "utf8" })
				} else {
					// Fallback: manual deploy steps
					sshCmd("cd /opt/superroo2 && git pull origin main", 60)
					sshCmd("cd /opt/superroo2 && pnpm install --frozen-lockfile", 180)
					sshCmd("cd /opt/superroo2/cloud/dashboard && pnpm build", 300)
					sshCmd("pm2 restart superroo-dashboard", 60)
				}
				addLog("✅ Dashboard deployed")
			}
			success = true
			break
		} catch (e) {
			lastError = e.message?.slice(0, 200)
			addLog(`❌ Attempt ${attempt} failed: ${lastError}`)
			if (attempt < max_retries) { await new Promise(r => setTimeout(r, 5000 * attempt)) }
		}
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
	const state = { status: success ? "success" : "failed", target, elapsed, lastError, completedAt: new Date().toISOString(), log }
	saveDeployState(state)

	if (!success) {
		return [
			`## ❌ Deploy Failed (${elapsed}s)`,
			`Target: ${target} | Attempts: ${max_retries}`,
			`Last error: ${lastError}`,
			``,
			`To retry with loop: \`deploy_to_vps\` again or \`debug_loop({ bug: "deploy failing: ${lastError.slice(0,80)}" })\``,
			`To rollback: \`rollback_deploy()\``,
		].join("\n")
	}

	// Verify PM2 status after deploy
	let pm2Status = ""
	try { pm2Status = sshCmd("pm2 list --no-color | grep -E 'online|stopped|errored'", 20) } catch {}

	return [
		`## ✅ Deploy Successful (${elapsed}s)`,
		`Target: ${target} | Attempts used: ${max_retries - (max_retries - 1)}`,
		``,
		`### PM2 Status`,
		pm2Status || "No PM2 status available",
		``,
		`### Deploy Log`,
		log.slice(-8).join("\n"),
	].join("\n")
}

function getDeployStatus() {
	const state = loadDeployState()
	if (!state) return "No deployment history found. Run deploy_to_vps() to start."

	const statusIcon = { success: "✅", failed: "❌", running: "🔄" }[state.status] || "❓"

	let vpsStatus = ""
	try { vpsStatus = sshCmd("pm2 list --no-color | grep -E 'name|online|stopped'", 10) } catch { vpsStatus = "VPS not reachable" }

	return [
		`## ${statusIcon} Last Deployment`,
		`Status: ${state.status} | Target: ${state.target}`,
		`Started: ${state.startedAt?.slice(0,19)} | Elapsed: ${state.elapsed}s`,
		state.lastError ? `Error: ${state.lastError}` : "",
		``,
		`### Live VPS Status`,
		vpsStatus || "unavailable",
		``,
		`### Last Deploy Log`,
		(state.log || []).slice(-5).join("\n"),
	].filter(Boolean).join("\n")
}

async function handleRollbackDeploy({ service = "all" } = {}) {
	coordLog(`ROLLBACK: service=${service}`)
	const log = []
	try {
		log.push(sshCmd("cd /opt/superroo2 && git log --oneline -3", 15))
		log.push(sshCmd("cd /opt/superroo2 && git revert HEAD --no-edit", 30))
		log.push(sshCmd(`pm2 restart ${service}`, 60))
		const pm2 = sshCmd("pm2 list --no-color | grep -E 'online|stopped'", 15)
		saveDeployState({ status: "rolled_back", rolledBackAt: new Date().toISOString(), log })
		return [
			`## ✅ Rollback Complete`,
			`Service: ${service}`,
			``,
			`### PM2 Status After Rollback`,
			pm2,
		].join("\n")
	} catch (e) {
		return `❌ Rollback failed: ${e.message?.slice(0, 200)}\n\nManual rollback:\n  ssh root@100.64.175.88 "cd /opt/superroo2 && git revert HEAD --no-edit && pm2 restart all"`
	}
}

function respond(id, result) {
	console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
}

function respondError(id, message, code = -32000) {
	console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: String(message) } }))
}

const reader = readline.createInterface({ input: process.stdin })
reader.on("line", async (line) => {
	let request
	try {
		request = JSON.parse(line)
	} catch {
		return
	}
	const { id, method, params } = request
	try {
		if (method === "initialize") {
			respond(id, {
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "codex-brain", version: "1.0.0" },
				workflowRules: {
					version: "1.0",
					defaultMemory: "codex-brain-local-hybrid-rag",
					defaultCoder: "ollama/qwen2.5-coder:7b,qwen3:14b",
					appendOnlyLessons: true,
				},
			})
		} else if (method === "tools/list") {
			respond(id, { tools: TOOLS })
		} else if (method === "tools/call") {
			respond(id, await handleToolCall(params.name, params.arguments || {}))
		} else if (method === "notifications/initialized") {
			// no response required
		} else {
			respondError(id, `Method not found: ${method}`, -32601)
		}
	} catch (error) {
		respond(id, errorResult(error.message))
	}
})
