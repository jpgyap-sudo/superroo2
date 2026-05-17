#!/usr/bin/env node
/**
 * superroo-learn — Global CLI for the SuperRoo Cross-Project Learning Layer
 *
 * Query, store, and manage lessons from ANY project directory.
 * Connects to the Central Brain via MCP server (port 3419).
 *
 * Usage:
 *   superroo-learn query "how to fix race conditions"
 *   superroo-learn store "React hooks" "useEffect cleanup pattern..."
 *   superroo-learn projects
 *   superroo-learn recall "deployment best practices"
 *   superroo-learn extract-commit <sha> <msg> <author> <files>
 *   superroo-learn register [project-name]
 *   superroo-learn status
 *
 * Environment variables:
 *   SUPERROO_MCP_URL     — MCP server URL (default: http://127.0.0.1:3419/mcp)
 *   SUPERROO_PROJECT     — Override project name auto-detection
 *   SUPERROO_DAEMON_TOKEN — Auth token for the daemon
 */

import { execSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

// ── Configuration ──

const MCP_URL = process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
const CONFIG_DIR = path.join(os.homedir(), ".superroo")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")

// ── Helpers ──

async function getConfig() {
	try {
		const raw = await fs.readFile(CONFIG_FILE, "utf-8")
		return JSON.parse(raw)
	} catch {
		return { projects: {} }
	}
}

async function saveConfig(config) {
	await fs.mkdir(CONFIG_DIR, { recursive: true })
	await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8")
}

/**
 * Auto-detect project name from git remote or directory basename.
 */
function detectProjectName() {
	if (process.env.SUPERROO_PROJECT) return process.env.SUPERROO_PROJECT

	try {
		const remote = execSync("git remote -v", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] })
		const match = remote.match(/github\.com[/:](.+?)\/(.+?)\.git/)
		if (match) return match[2]
	} catch {
		// Not a git repo or no remote
	}

	// Use process.cwd() basename as fallback (works on all platforms)
	try {
		const cwd = process.cwd()
		const parts = cwd.replace(/\\/g, "/").split("/")
		return parts[parts.length - 1] || "unknown-project"
	} catch {
		return "unknown-project"
	}
}

/**
 * Send a JSON-RPC 2.0 request to the MCP server.
 */
async function mcpCall(method, params = {}) {
	const body = {
		jsonrpc: "2.0",
		id: Date.now(),
		method,
		params,
	}

	const headers = {
		"Content-Type": "application/json",
	}
	if (process.env.SUPERROO_DAEMON_TOKEN) {
		headers["Authorization"] = `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}`
	}

	const response = await fetch(MCP_URL, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`MCP server error ${response.status}: ${text}`)
	}

	const result = await response.json()
	if (result.error) {
		throw new Error(`MCP error: ${result.error.message || JSON.stringify(result.error)}`)
	}
	return result.result
}

/**
 * Call a tool on the MCP server.
 */
async function mcpToolCall(name, args = {}) {
	return mcpCall("tools/call", { name, arguments: args })
}

// ── Commands ──

async function cmdQuery(query, project) {
	console.error(`🔍 Querying Central Brain: "${query}" (project: ${project || "all"})`)
	const result = await mcpToolCall("query_memory", {
		query,
		project: project || undefined,
		maxResults: 10,
	})
	console.log(JSON.stringify(result, null, 2))
}

async function cmdStore(topic, content) {
	const project = detectProjectName()
	console.error(`📝 Storing lesson to Central Brain: "${topic}" (project: ${project})`)
	const result = await mcpToolCall("hermes_learn", { topic, content })
	console.log(JSON.stringify(result, null, 2))

	// Also register the project if not already known
	const config = await getConfig()
	if (!config.projects[project]) {
		config.projects[project] = {
			firstSeen: new Date().toISOString(),
			lastLesson: new Date().toISOString(),
		}
		await saveConfig(config)
	}
}

async function cmdRecall(query) {
	console.error(`🧠 Recalling Hermes memory: "${query}"`)
	const result = await mcpToolCall("hermes_recall", { query, limit: 5 })
	console.log(JSON.stringify(result, null, 2))
}

async function cmdProjects() {
	console.error("📋 Listing registered projects...")
	const result = await mcpToolCall("list_projects", {})
	console.log(JSON.stringify(result, null, 2))
}

async function cmdRegister(projectName) {
	const project = projectName || detectProjectName()
	const config = await getConfig()
	config.projects[project] = {
		...config.projects[project],
		registered: new Date().toISOString(),
		directory: process.cwd(),
	}
	await saveConfig(config)
	console.error(`✅ Registered project "${project}" in ${CONFIG_FILE}`)
	console.log(JSON.stringify({ project, configFile: CONFIG_FILE }, null, 2))
}

async function cmdStatus() {
	const config = await getConfig()
	const project = detectProjectName()
	console.error(`📊 SuperRoo Learning Layer Status`)
	console.error(`   Config dir: ${CONFIG_DIR}`)
	console.error(`   MCP URL:    ${MCP_URL}`)
	console.error(`   Project:    ${project}`)
	console.error(`   Known projects: ${Object.keys(config.projects).length}`)
	console.log(JSON.stringify({ config, currentProject: project, mcpUrl: MCP_URL }, null, 2))
}

async function cmdExtractCommit(sha, message, author, files) {
	const project = detectProjectName()
	console.error(`📝 Extracting lesson from commit ${sha} (project: ${project})`)

	// Check if commit is lesson-worthy
	const indicators = [
		/fix(e[ds])?:?\s+/i,
		/bug:?:?\s+/i,
		/lesson:?:?\s+/i,
		/workaround:?:?\s+/i,
		/solution:?:?\s+/i,
		/issue:?:?\s+/i,
		/error:?:?\s+/i,
		/crash:?:?\s+/i,
		/race[\s-]?condition:?:?\s+/i,
		/memory[\s-]?leak:?:?\s+/i,
		/performance:?:?\s+/i,
		/optimize:?:?\s+/i,
		/refactor:?:?\s+/i,
		/breaking[\s-]?change:?:?\s+/i,
	]

	const matched = indicators.filter((p) => p.test(message))
	if (matched.length === 0) {
		console.error("ℹ️  No lesson indicators found in commit message. Skipping.")
		return { success: true, skipped: true, reason: "no_lesson_indicators" }
	}

	// Build a lesson from the commit
	const topic = `[${project}] ${message.split("\n")[0].slice(0, 120)}`
	const content = [
		`## Auto-extracted from commit ${sha}`,
		``,
		`**Project:** ${project}`,
		`**Author:** ${author}`,
		`**Message:** ${message}`,
		`**Files:** ${files}`,
		``,
		`**Indicators matched:** ${matched.join(", ")}`,
		``,
		`**Lesson:** Review this commit for reusable engineering insights.`,
	].join("\n")

	const result = await mcpToolCall("hermes_learn", { topic, content })
	console.error(`✅ Lesson stored from commit ${sha}`)
	console.log(JSON.stringify({ sha, project, topic, result }, null, 2))
}

// ── Main ──

async function main() {
	const args = process.argv.slice(2)
	const command = args[0]

	if (!command || command === "--help" || command === "-h") {
		console.log(`
superroo-learn — Cross-Project Learning Layer CLI

Usage:
  superroo-learn query "<text>" [project]    Search lessons across all projects
  superroo-learn store "<topic>" "<content>" Store a new lesson
  superroo-learn recall "<text>"             Semantic search via Hermes Claw
  superroo-learn projects                    List registered projects
  superroo-learn register [name]             Register current directory as a project
  superroo-learn extract-commit <sha> <msg> <author> <files>  Auto-extract from git commit
  superroo-learn status                      Show learning layer status
  superroo-learn --help                      Show this help

Environment:
  SUPERROO_MCP_URL       MCP server URL (default: http://127.0.0.1:3419/mcp)
  SUPERROO_PROJECT       Override project name auto-detection
  SUPERROO_DAEMON_TOKEN  Auth token for the daemon
`)
		return
	}

	try {
		switch (command) {
			case "query": {
				const query = args[1]
				if (!query) throw new Error("Usage: superroo-learn query \"<text>\" [project]")
				await cmdQuery(query, args[2])
				break
			}

			case "store": {
				const topic = args[1]
				const content = args[2]
				if (!topic || !content) throw new Error("Usage: superroo-learn store \"<topic>\" \"<content>\"")
				await cmdStore(topic, content)
				break
			}

			case "recall": {
				const query = args[1]
				if (!query) throw new Error("Usage: superroo-learn recall \"<text>\"")
				await cmdRecall(query)
				break
			}

			case "projects":
				await cmdProjects()
				break

			case "register":
				await cmdRegister(args[1])
				break

			case "status":
				await cmdStatus()
				break

			case "extract-commit": {
				const sha = args[1]
				const msg = args[2]
				const author = args[3]
				const files = args[4]
				if (!sha || !msg) throw new Error("Usage: superroo-learn extract-commit <sha> <msg> [author] [files]")
				await cmdExtractCommit(sha, msg, author || "unknown", files || "")
				break
			}

			default:
				console.error(`Unknown command: ${command}`)
				console.error("Run 'superroo-learn --help' for usage.")
				process.exit(1)
		}
	} catch (err) {
		console.error(`❌ Error: ${err.message}`)
		process.exit(1)
	}
}

main()
