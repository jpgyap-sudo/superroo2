#!/usr/bin/env node
/**
 * Verify Blackbox integration with the SuperRoo local ecosystem.
 *
 * This is intentionally read-only. It checks MCP env completeness, local model
 * availability, task sync visibility, lesson mirror lag, and the fragile
 * Blackbox built-in search_files ripgrep bundle patch.
 */

import fs from "node:fs"
import path from "node:path"

const HOME = process.env.USERPROFILE || process.env.HOME || ""
const ROOT = process.env.PROJECT_ROOT || process.cwd()

const paths = {
	mcp: path.join(
		HOME,
		"AppData",
		"Roaming",
		"Code",
		"User",
		"globalStorage",
		"blackboxapp.blackboxagent",
		"settings",
		"blackbox_mcp_settings.json",
	),
	globalTasks: path.join(HOME, ".superroo", "tasks", "global-tasks.json"),
	blackboxTasks: path.join(HOME, "Documents", ".blackbox", "tasks.json"),
	blackboxLessons: path.join(HOME, "Documents", ".blackbox", "memory", "lessons.jsonl"),
	globalLessons: path.join(HOME, ".superroo", "memory", "lesson-index.jsonl"),
	globalRules: path.join(HOME, "Documents", ".blackbox", ".blackboxrules"),
	repoRules: path.join(ROOT, ".blackboxrules"),
	rg: path.join(HOME, ".superroo", "bin", "rg.exe"),
	extensionBundle: path.join(
		HOME,
		".vscode",
		"extensions",
		"blackboxapp.blackboxagent-3.7.0",
		"dist",
		"extension.js",
	),
	extensionBundleBackup: path.join(
		HOME,
		".vscode",
		"extensions",
		"blackboxapp.blackboxagent-3.7.0",
		"dist",
		"extension.js.bak-superroo-ripgrep",
	),
}

const requiredServers = [
	"codex-brain",
	"central-brain",
	"local-brain",
	"ollama",
	"blackbox-attachments",
]

const requiredEnv = [
	"SUPERROO_HOME",
	"SUPERROO_MEMORY_DIR",
	"MEMORY_DIR",
	"CODEX_BRAIN_MEMORY_DIR",
	"SUPERROO_RISK_DIR",
	"GLOBAL_TASK_REGISTRY",
	"SUPERROO_PRODUCT_MEMORY_DIR",
	"SUPERROO_SKILLS_DIR",
	"SUPERROO_RESOURCES_DIR",
	"SUPERROO_GLOBAL_SKILLS_AGENT",
	"SUPERROO_EXTENSION_ECOSYSTEM",
	"PROJECT_ROOT",
	"PROJECT_ID",
	"AGENT_ID",
	"RIPGREP_PATH",
	"RG_PATH",
	"BLACKBOX_DEFAULT_PROVIDER",
	"BLACKBOX_DEFAULT_MODEL",
]

const requiredModels = [
	"hermes3:latest",
	"qwen3:14b",
	"qwen2.5-coder:14b",
	"qwen2.5-coder:7b",
	"llava:7b",
	"nomic-embed-text:latest",
]

let failures = 0
let warnings = 0

function pass(message) {
	console.log(`[ok] ${message}`)
}

function warn(message) {
	warnings += 1
	console.warn(`[warn] ${message}`)
}

function fail(message) {
	failures += 1
	console.error(`[fail] ${message}`)
}

function exists(filePath) {
	try {
		return fs.existsSync(filePath)
	} catch {
		return false
	}
}

function read(filePath) {
	return fs.readFileSync(filePath, "utf8")
}

function loadJson(filePath, fallback = null) {
	try {
		return JSON.parse(read(filePath))
	} catch {
		return fallback
	}
}

function loadJsonl(filePath) {
	if (!exists(filePath)) return []
	return read(filePath)
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => {
			try {
				return JSON.parse(line)
			} catch {
				return null
			}
		})
		.filter(Boolean)
}

function allGlobalTasks(registry) {
	const tasks = []
	for (const [project, projectData] of Object.entries(registry?.projects || {})) {
		for (const [agent, agentTasks] of Object.entries(projectData || {})) {
			if (agent === "updatedAt" || !Array.isArray(agentTasks)) continue
			for (const task of agentTasks) tasks.push({ ...task, project, agent })
		}
	}
	return tasks
}

async function checkHttp(url, label, required = false, timeoutMs = 3000) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		if (res.ok) pass(`${label} reachable`)
		else (required ? fail : warn)(`${label} returned HTTP ${res.status}`)
	} catch (error) {
		(required ? fail : warn)(`${label} unreachable: ${error.message}`)
	}
}

function checkFiles() {
	for (const [name, filePath] of Object.entries(paths)) {
		if (name === "extensionBundle") continue
		if (exists(filePath)) pass(`${name} exists`)
		else fail(`${name} missing: ${filePath}`)
	}
}

function checkMcp() {
	const mcp = loadJson(paths.mcp)
	if (!mcp?.mcpServers) {
		fail("Blackbox MCP settings did not parse")
		return
	}
	pass("Blackbox MCP settings parse")

	for (const server of requiredServers) {
		if (mcp.mcpServers[server]) pass(`MCP server present: ${server}`)
		else fail(`MCP server missing: ${server}`)
	}

	for (const [name, server] of Object.entries(mcp.mcpServers)) {
		const env = server.env || {}
		for (const key of requiredEnv) {
			if (!env[key]) fail(`${name} missing env ${key}`)
		}
		if (env.BLACKBOX_DEFAULT_PROVIDER && env.BLACKBOX_DEFAULT_PROVIDER !== "ollama") {
			fail(`${name} BLACKBOX_DEFAULT_PROVIDER is ${env.BLACKBOX_DEFAULT_PROVIDER}, expected ollama`)
		}
		if (env.BLACKBOX_DEFAULT_MODEL && env.BLACKBOX_DEFAULT_MODEL !== "qwen2.5-coder:14b") {
			fail(`${name} BLACKBOX_DEFAULT_MODEL is ${env.BLACKBOX_DEFAULT_MODEL}, expected qwen2.5-coder:14b`)
		}
	}
}

function checkTasksAndLessons() {
	const globalTasks = allGlobalTasks(loadJson(paths.globalTasks, {}))
	const localTasks = loadJson(paths.blackboxTasks, { tasks: [] }).tasks || []
	const blackboxGlobal = globalTasks.filter((task) => task.agent === "blackbox")

	if (localTasks.length > 0) pass(`Blackbox local tasks: ${localTasks.length}`)
	else warn("Blackbox local task file has no tasks")

	if (blackboxGlobal.length >= localTasks.length) {
		pass(`Blackbox tasks visible globally: ${blackboxGlobal.length}`)
	} else {
		fail(`Blackbox global task count ${blackboxGlobal.length} is behind local count ${localTasks.length}`)
	}

	const localLessons = loadJsonl(paths.blackboxLessons)
	const globalLessons = loadJsonl(paths.globalLessons)
	if (localLessons.length) pass(`Blackbox lessons: ${localLessons.length}`)
	else warn("Blackbox local lessons are empty")

	if (globalLessons.length && localLessons.length < globalLessons.length) {
		warn(`Blackbox lesson mirror trails global memory by ${globalLessons.length - localLessons.length}`)
	} else {
		pass("Blackbox lesson mirror is not behind global memory")
	}
}

function checkRules() {
	for (const filePath of [paths.globalRules, paths.repoRules]) {
		const content = exists(filePath) ? read(filePath) : ""
		if (!content) {
			fail(`Rules file missing or empty: ${filePath}`)
			continue
		}
		if (/[^\x09\x0a\x0d\x20-\x7e]/.test(content)) {
			warn(`Rules file contains non-ASCII text: ${filePath}`)
		} else {
			pass(`Rules file is ASCII-clean: ${filePath}`)
		}
		if (!content.includes("Local Ollama Model Route")) fail(`Rules missing Ollama route: ${filePath}`)
		if (!content.includes("qwen2.5-coder:14b")) fail(`Rules missing main coder model: ${filePath}`)
	}
}

function checkBundlePatch() {
	if (!exists(paths.extensionBundle)) {
		fail(`Blackbox extension bundle missing: ${paths.extensionBundle}`)
		return
	}
	const bundle = read(paths.extensionBundle)
	for (const needle of ["RIPGREP_PATH", "RG_PATH", ".superroo", "rg.exe"]) {
		if (!bundle.includes(needle)) fail(`Blackbox search_files bundle patch missing marker: ${needle}`)
	}
	pass("Blackbox search_files bundle patch markers present")
}

async function checkOllamaModels() {
	try {
		const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })
		if (!res.ok) {
			fail(`Ollama tags returned HTTP ${res.status}`)
			return
		}
		const data = await res.json()
		const names = new Set((data.models || []).map((model) => model.name))
		for (const model of requiredModels) {
			if (names.has(model)) pass(`Ollama model installed: ${model}`)
			else fail(`Ollama model missing: ${model}`)
		}
	} catch (error) {
		fail(`Ollama unavailable: ${error.message}`)
	}
}

async function main() {
	checkFiles()
	checkMcp()
	checkTasksAndLessons()
	checkRules()
	checkBundlePatch()
	await checkOllamaModels()
	await checkHttp("http://127.0.0.1:3419/health", "local Central Brain health", false)
	await checkHttp("https://dev.abcx124.xyz/api/health", "SuperRoo VPS API health", false, 12000)

	console.log(`\nBlackbox ecosystem verification: ${failures} failures, ${warnings} warnings`)
	process.exitCode = failures ? 1 : 0
}

main().catch((error) => {
	fail(error.stack || error.message)
	process.exit(1)
})
