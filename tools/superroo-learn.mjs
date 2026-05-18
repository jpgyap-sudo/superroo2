#!/usr/bin/env node
/**
 * superroo-learn — Global CLI for the SuperRoo Cross-Project Learning Layer
 *
 * Query, store, and manage lessons from ANY project directory.
 * Connects to the Central Brain via MCP server (port 3419) with
 * automatic local fallback when the server is unreachable.
 *
 * Usage:
 *   superroo-learn query "how to fix race conditions"
 *   superroo-learn store "React hooks" "useEffect cleanup pattern..."
 *   superroo-learn projects
 *   superroo-learn recall "deployment best practices"
 *   superroo-learn extract-commit <sha> <msg> <author> <files>
 *   superroo-learn register [project-name]
 *   superroo-learn status
 *   superroo-learn health
 *   superroo-learn sync [--force|--dry-run|--status]
 *   superroo-learn retry [--flush]
 *
 * Environment variables:
 *   SUPERROO_MCP_URL       — MCP server URL (default: http://127.0.0.1:3419/mcp)
 *   SUPERROO_PROJECT       — Override project name auto-detection
 *   SUPERROO_DAEMON_TOKEN  — Auth token for the daemon
 *   SUPERROO_NO_FALLBACK   — Set to "1" to disable local fallback
 *   SUPERROO_RETRY_MAX     — Max retry attempts for queued operations (default: 5)
 *   SUPERROO_RETRY_BASE_MS — Base delay for exponential backoff in ms (default: 2000)
 */

import { execSync } from "child_process"
import fs from "fs/promises"
import { accessSync } from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Configuration ──

const MCP_URL = process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
const CONFIG_DIR = path.join(os.homedir(), ".superroo")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")
const NO_FALLBACK = process.env.SUPERROO_NO_FALLBACK === "1"

// ── Local Fallback Paths ──

/**
 * Find local lesson files in the current or parent directories.
 * Searches for memory/lesson-index.jsonl and memory/lessons-learned.md.
 * Uses synchronous access check to avoid race conditions.
 */
function findLocalLessonFiles() {
	const cwd = process.cwd()
	const searchPaths = [cwd]

	// Also check common parent directories (works on both Windows and Unix)
	const parts = cwd.split(path.sep)
	for (let i = parts.length - 1; i > 0; i--) {
		searchPaths.push(parts.slice(0, i).join(path.sep))
	}

	const results = { jsonl: null, md: null }

	for (const dir of searchPaths) {
		if (!results.jsonl) {
			const jsonlPath = path.join(dir, "memory", "lesson-index.jsonl")
			try {
				accessSync(jsonlPath)
				results.jsonl = jsonlPath
			} catch {}
		}
		if (!results.md) {
			const mdPath = path.join(dir, "memory", "lessons-learned.md")
			try {
				accessSync(mdPath)
				results.md = mdPath
			} catch {}
		}
		if (results.jsonl && results.md) break
	}

	return results
}

/**
 * Query local lesson files for matching content.
 */
async function queryLocalLessons(query, limit = 10) {
	const files = findLocalLessonFiles()
	const results = []

	// Try JSONL first
	if (files.jsonl) {
		try {
			const content = await fs.readFile(files.jsonl, "utf-8")
			const lines = content.split("\n").filter((l) => l.trim())
			const queryLower = query.toLowerCase()

			for (const line of lines) {
				try {
					const lesson = JSON.parse(line)
					const searchText = [
						lesson.title,
						lesson.lesson_summary,
						lesson.rule_summary,
						...(lesson.tags || []),
					]
						.filter(Boolean)
						.join(" ")
						.toLowerCase()

					if (searchText.includes(queryLower)) {
						results.push({
							file: files.jsonl,
							matches: [
								{
									text: `[${lesson.type}] ${lesson.title}\n${lesson.lesson_summary || ""}`,
									relevance: 0.8,
									metadata: { source: "local-jsonl", id: lesson.id },
								},
							],
						})
					}
				} catch {}
			}
		} catch {}
	}

	// Fall back to markdown if JSONL had no matches
	if (results.length === 0 && files.md) {
		try {
			const content = await fs.readFile(files.md, "utf-8")
			const queryLower = query.toLowerCase()
			const lessonBlocks = content.split(/(?=^### Lesson:)/m)

			for (const block of lessonBlocks) {
				if (block.toLowerCase().includes(queryLower)) {
					results.push({
						file: files.md,
						matches: [
							{
								text: block.trim().slice(0, 500),
								relevance: 0.5,
								metadata: { source: "local-markdown" },
							},
						],
					})
				}
			}
		} catch {}
	}

	return { results, source: results.length > 0 ? (files.jsonl ? "local-jsonl" : "local-markdown") : "none" }
}

/**
 * Store a lesson locally (fallback when Central Brain is unreachable).
 */
async function storeLessonLocally(topic, content) {
	const project = detectProjectName()
	const cwd = process.cwd()
	const memoryDir = path.join(cwd, "memory")

	// Ensure memory directory exists
	await fs.mkdir(memoryDir, { recursive: true })

	// Append to lessons-learned.md
	const mdPath = path.join(memoryDir, "lessons-learned.md")
	const date = new Date().toISOString().split("T")[0]
	const lessonEntry = `
### Lesson: ${topic}

Date: ${date}
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files: 
Tags: 

#### Task Summary

${content}

#### Lesson Learned

${content}

#### Tags

cross-project, local-fallback

---
`

	try {
		await fs.appendFile(mdPath, lessonEntry, "utf-8")
		console.error(`✅ Lesson stored locally: ${mdPath}`)
	} catch (err) {
		throw new Error(`Failed to store lesson locally: ${err.message}`)
	}

	// Also append to lesson-index.jsonl if it exists
	const jsonlPath = path.join(memoryDir, "lesson-index.jsonl")
	try {
		const jsonlEntry = JSON.stringify({
			id: `local-fallback-${Date.now()}`,
			title: topic,
			type: "lesson",
			date,
			source: "superroo-learn-cli",
			model: "local",
			confidence: "medium",
			files: [],
			tags: ["cross-project", "local-fallback"],
			relevance_score: 0.7,
			relevance_factors: {},
			rule_summary: content.slice(0, 200),
			lesson_summary: content.slice(0, 300),
		})
		await fs.appendFile(jsonlPath, jsonlEntry + "\n", "utf-8")
	} catch {
		// JSONL may not exist yet — that's fine
	}
}

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
 * Check if Central Brain MCP server is reachable.
 */
async function checkMcpHealth() {
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)

		const response = await fetch(MCP_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now(),
				method: "ping",
				params: {},
			}),
			signal: controller.signal,
		})

		clearTimeout(timeout)
		return response.ok
	} catch {
		return false
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

/**
 * Try an MCP operation with local fallback.
 * Returns { success, result, fallbackUsed }
 */
async function withFallback(mcpFn, fallbackFn, operationName, retryContext) {
	// If fallback is disabled, just try MCP directly
	if (NO_FALLBACK) {
		return { success: true, result: await mcpFn(), fallbackUsed: false }
	}

	try {
		const result = await mcpFn()
		return { success: true, result, fallbackUsed: false }
	} catch (err) {
		console.error(`⚠️  Central Brain unreachable for "${operationName}": ${err.message}`)
		console.error(`   Falling back to local storage...`)

		try {
			const fallbackResult = await fallbackFn()

			// Enqueue retry so the lesson gets pushed to Central Brain later
			if (retryContext) {
				await enqueueRetry(
					retryContext.operation,
					retryContext.topic,
					retryContext.content,
					retryContext.project,
				)
			}

			return { success: true, result: fallbackResult, fallbackUsed: true }
		} catch (fallbackErr) {
			throw new Error(
				`Both Central Brain and local fallback failed for "${operationName}": ${fallbackErr.message}`,
			)
		}
	}
}

// ── Retry Queue ──

const RETRY_MAX = parseInt(process.env.SUPERROO_RETRY_MAX || "5", 10)
const RETRY_BASE_MS = parseInt(process.env.SUPERROO_RETRY_BASE_MS || "2000", 10)
const RETRY_FILE = path.join(CONFIG_DIR, "retry-queue.json")

/**
 * @typedef {{ id: string, operation: string, topic: string, content: string, project: string, attempts: number, lastAttempt: string|null, createdAt: string }} RetryItem
 */

/**
 * Read the retry queue from disk.
 * @returns {Promise<RetryItem[]>}
 */
async function readRetryQueue() {
  try {
    const raw = await fs.readFile(RETRY_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/**
 * Write the retry queue to disk.
 * @param {RetryItem[]} queue
 */
async function writeRetryQueue(queue) {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(RETRY_FILE, JSON.stringify(queue, null, 2), "utf-8")
}

/**
 * Add an item to the retry queue.
 * @param {string} operation
 * @param {string} topic
 * @param {string} content
 * @param {string} project
 */
async function enqueueRetry(operation, topic, content, project) {
  const queue = await readRetryQueue()
  queue.push({
    id: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    topic,
    content,
    project,
    attempts: 0,
    lastAttempt: null,
    createdAt: new Date().toISOString(),
  })
  await writeRetryQueue(queue)
  console.error(`   📋 Queued for retry (${queue.length} pending)`)
}

/**
 * Calculate delay for exponential backoff.
 * @param {number} attempt 0-based attempt number
 * @returns {number} delay in ms
 */
function retryDelay(attempt) {
  return Math.min(RETRY_BASE_MS * Math.pow(2, attempt), 60000) // Cap at 60s
}

/**
 * Process the retry queue — attempt to sync queued items to Central Brain.
 * Items that succeed are removed; items that exceed max attempts are kept with a warning.
 * @param {{ flush?: boolean }} options
 */
async function processRetryQueue(options = {}) {
  const { flush = false } = options
  const queue = await readRetryQueue()

  if (queue.length === 0) {
    console.error("📭 Retry queue is empty.")
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0 }
  }

  console.error(`🔄 Processing retry queue (${queue.length} item(s))...`)
  console.error(`   Max attempts: ${RETRY_MAX}, Base delay: ${RETRY_BASE_MS}ms`)
  console.error("")

  const succeeded = []
  const failed = []
  const skipped = []

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    const progress = `[${i + 1}/${queue.length}]`

    // Skip items that have exceeded max attempts (unless flushing)
    if (item.attempts >= RETRY_MAX && !flush) {
      process.stdout.write(`   ${progress} "${item.topic.slice(0, 50)}" — max attempts reached, skipping. `)
      console.error(`⚠️`)
      skipped.push(item)
      continue
    }

    // Calculate delay with exponential backoff
    const delay = retryDelay(item.attempts)
    if (item.attempts > 0 && delay > 0) {
      process.stdout.write(`   ${progress} Waiting ${delay}ms before retry ${item.attempts + 1}/${RETRY_MAX}... `)
      await new Promise((r) => setTimeout(r, delay))
    }

    // Attempt the MCP call
    process.stdout.write(`   ${progress} Retrying "${item.topic.slice(0, 50)}" (attempt ${item.attempts + 1}/${RETRY_MAX})... `)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.SUPERROO_DAEMON_TOKEN
            ? { Authorization: `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: "hermes_learn",
            arguments: { topic: item.topic, content: item.content },
          },
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.ok) {
        console.error(`✅`)
        succeeded.push(item)
      } else {
        item.attempts++
        item.lastAttempt = new Date().toISOString()
        console.error(`❌ (HTTP ${response.status})`)
        failed.push(item)
      }
    } catch (err) {
      item.attempts++
      item.lastAttempt = new Date().toISOString()
      console.error(`❌ (${err.message.slice(0, 60)})`)
      failed.push(item)
    }
  }

  // Build new queue: keep failed items that haven't exceeded max attempts
  const newQueue = failed.filter((item) => item.attempts < RETRY_MAX || flush)

  // Log items that are being dropped
  const dropped = failed.filter((item) => item.attempts >= RETRY_MAX && !flush)
  for (const item of dropped) {
    console.error(`   ⚠️  Dropping "${item.topic.slice(0, 50)}" after ${item.attempts} failed attempts.`)
    console.error(`      Use 'superroo-learn retry --flush' to force-retry dropped items.`)
  }

  await writeRetryQueue(newQueue)

  // Summary
  console.error("")
  console.error(`📊 Retry Queue Results:`)
  console.error(`   Succeeded: ${succeeded.length}`)
  console.error(`   Still pending: ${newQueue.length}`)
  console.error(`   Dropped: ${dropped.length}`)
  console.error(`   Skipped: ${skipped.length}`)

  return {
    processed: queue.length,
    succeeded: succeeded.length,
    failed: failed.length,
    remaining: newQueue.length,
  }
}

// ── Commands ──

async function cmdQuery(query, project) {
	console.error(`🔍 Querying: "${query}" (project: ${project || "all"})`)

	const { success, result, fallbackUsed } = await withFallback(
		// Primary: Central Brain
		async () => {
			return await mcpToolCall("query_memory", {
				query,
				project: project || undefined,
				maxResults: 10,
			})
		},
		// Fallback: local lesson files
		async () => {
			return await queryLocalLessons(query, 10)
		},
		"query",
	)

	if (fallbackUsed) {
		console.error(`📋 Local results (Central Brain was unreachable):`)
	}
	console.log(JSON.stringify(result, null, 2))
}

async function cmdStore(topic, content) {
	const project = detectProjectName()
	console.error(`📝 Storing lesson: "${topic}" (project: ${project})`)

	const { success, result, fallbackUsed } = await withFallback(
		// Primary: Central Brain
		async () => {
			const r = await mcpToolCall("hermes_learn", { topic, content })
			// Also register the project if not already known
			const config = await getConfig()
			if (!config.projects[project]) {
				config.projects[project] = {
					firstSeen: new Date().toISOString(),
					lastLesson: new Date().toISOString(),
				}
				await saveConfig(config)
			}
			return r
		},
		// Fallback: store locally
		async () => {
			await storeLessonLocally(topic, content)
			return { success: true, stored: "local", topic, project }
		},
		"store",
		// Retry context — enqueue for later sync if MCP fails
		{ operation: "store", topic, content, project },
	)

	if (fallbackUsed) {
		console.error(`✅ Lesson stored locally (Central Brain was unreachable)`)
	} else {
		console.error(`✅ Lesson stored to Central Brain`)
	}
	console.log(JSON.stringify(result, null, 2))
}

async function cmdRecall(query) {
	console.error(`🧠 Recalling Hermes memory: "${query}"`)

	const { success, result, fallbackUsed } = await withFallback(
		async () => {
			return await mcpToolCall("hermes_recall", { query, limit: 5 })
		},
		async () => {
			const local = await queryLocalLessons(query, 5)
			return local
		},
		"recall",
	)

	if (fallbackUsed) {
		console.error(`📋 Local recall results (Central Brain was unreachable):`)
	}
	console.log(JSON.stringify(result, null, 2))
}

async function cmdProjects() {
	console.error("📋 Listing registered projects...")

	try {
		const result = await mcpToolCall("list_projects", {})
		console.log(JSON.stringify(result, null, 2))
	} catch (err) {
		console.error(`⚠️  Central Brain unreachable: ${err.message}`)
		// Show local config as fallback
		const config = await getConfig()
		console.error(`📋 Showing local project registry (${CONFIG_FILE}):`)
		console.log(JSON.stringify({ localProjects: config.projects }, null, 2))
	}
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
	const localFiles = findLocalLessonFiles()

	console.error(`📊 SuperRoo Learning Layer Status`)
	console.error(`   Config dir: ${CONFIG_DIR}`)
	console.error(`   MCP URL:    ${MCP_URL}`)
	console.error(`   Project:    ${project}`)
	console.error(`   Known projects: ${Object.keys(config.projects).length}`)

	// Check Central Brain health
	const healthy = await checkMcpHealth()
	console.error(`   Central Brain: ${healthy ? "✅ Online" : "❌ Offline"}`)

	// Check local files
	if (localFiles.jsonl) console.error(`   Local JSONL:  ✅ ${localFiles.jsonl}`)
	else console.error(`   Local JSONL:  ❌ Not found`)

	if (localFiles.md) console.error(`   Local MD:     ✅ ${localFiles.md}`)
	else console.error(`   Local MD:     ❌ Not found`)

	// Check retry queue
	const retryQueue = await readRetryQueue()
	console.error(`   Retry queue:  ${retryQueue.length > 0 ? `⚠️  ${retryQueue.length} pending` : "✅ Empty"}`)

	console.log(
		JSON.stringify(
			{
				config,
				currentProject: project,
				mcpUrl: MCP_URL,
				centralBrainOnline: healthy,
				localFiles,
				fallbackEnabled: !NO_FALLBACK,
				retryQueueLength: retryQueue.length,
			},
			null,
			2,
		),
	)
}

async function cmdHealth() {
	const healthy = await checkMcpHealth()
	const localFiles = findLocalLessonFiles()

	const status = {
		centralBrain: healthy ? "online" : "offline",
		localJsonl: localFiles.jsonl ? "available" : "not-found",
		localMarkdown: localFiles.md ? "available" : "not-found",
		fallbackEnabled: !NO_FALLBACK,
	}

	console.error(`🏥 SuperRoo Learning Layer Health Check`)
	console.error(`   Central Brain:  ${healthy ? "✅ Online" : "❌ Offline"}`)
	console.error(`   Local JSONL:    ${localFiles.jsonl ? "✅ " + localFiles.jsonl : "❌ Not found"}`)
	console.error(`   Local Markdown: ${localFiles.md ? "✅ " + localFiles.md : "❌ Not found"}`)
	console.error(`   Fallback:       ${NO_FALLBACK ? "❌ Disabled" : "✅ Enabled"}`)

	console.log(JSON.stringify(status, null, 2))
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

	const { success, result, fallbackUsed } = await withFallback(
		async () => {
			return await mcpToolCall("hermes_learn", { topic, content })
		},
		async () => {
			await storeLessonLocally(topic, content)
			return { success: true, stored: "local", sha, project, topic }
		},
		"extract-commit",
	)

	if (fallbackUsed) {
		console.error(`✅ Lesson stored locally from commit ${sha} (Central Brain was unreachable)`)
	} else {
		console.error(`✅ Lesson stored from commit ${sha}`)
	}
	console.log(JSON.stringify({ sha, project, topic, result }, null, 2))
}

async function cmdSync(options = {}) {
	console.error(`🔄 Syncing local lessons to Central Brain...`)

	try {
		// Dynamically import the sync module (it's in scripts/ relative to tools/)
		// Use file:// URL on Windows to satisfy ESM loader
		const syncModulePath = path.resolve(__dirname, "..", "scripts", "sync-lessons-to-central-brain.mjs")
		const syncModuleUrl = syncModulePath.startsWith("/") ? syncModulePath : "file:///" + syncModulePath.replace(/\\/g, "/")
		const { syncLocalLessonsToCentralBrain } = await import(syncModuleUrl)
		const result = await syncLocalLessonsToCentralBrain(options)
		console.log(JSON.stringify(result, null, 2))
	} catch (err) {
		console.error(`❌ Sync failed: ${err.message}`)
		process.exit(1)
	}
}

async function cmdRetry(options = {}) {
	console.error(`🔄 Processing retry queue...`)
	const result = await processRetryQueue(options)
	console.log(JSON.stringify(result, null, 2))
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
		 superroo-learn health                      Check Central Brain and local fallback health
		 superroo-learn sync [--force|--dry-run|--status]  Push local lessons to Central Brain
		 superroo-learn retry [--flush]             Process retry queue (failed MCP stores)
		 superroo-learn --help                      Show this help
	
	Local Fallback:
		 When Central Brain is unreachable, the CLI automatically falls back to
		 local lesson files (memory/lesson-index.jsonl or memory/lessons-learned.md)
		 in the current or parent directories. Set SUPERROO_NO_FALLBACK=1 to disable.
	
	Retry Queue:
		 Failed MCP store operations are automatically queued for retry with
		 exponential backoff. Use 'superroo-learn retry' to process the queue,
		 or 'superroo-learn retry --flush' to force-retry dropped items.
	
	Environment:
		 SUPERROO_MCP_URL         MCP server URL (default: http://127.0.0.1:3419/mcp)
		 SUPERROO_PROJECT         Override project name auto-detection
		 SUPERROO_DAEMON_TOKEN    Auth token for the daemon
		 SUPERROO_NO_FALLBACK     Set to "1" to disable local fallback
		 SUPERROO_RETRY_MAX       Max retry attempts (default: 5)
		 SUPERROO_RETRY_BASE_MS   Base delay for exponential backoff in ms (default: 2000)
	`)
		return
	}

	try {
		switch (command) {
			case "query": {
				const query = args[1]
				if (!query) throw new Error('Usage: superroo-learn query "<text>" [project]')
				await cmdQuery(query, args[2])
				break
			}

			case "store": {
				const topic = args[1]
				const content = args[2]
				if (!topic || !content) throw new Error('Usage: superroo-learn store "<topic>" "<content>"')
				await cmdStore(topic, content)
				break
			}

			case "recall": {
				const query = args[1]
				if (!query) throw new Error('Usage: superroo-learn recall "<text>"')
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

			case "health":
				await cmdHealth()
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

			case "sync": {
				const syncOptions = {
					force: args.includes("--force") || args.includes("-f"),
					dryRun: args.includes("--dry-run") || args.includes("-n"),
					statusOnly: args.includes("--status") || args.includes("-s"),
				}
				await cmdSync(syncOptions)
				break
			}

			case "retry": {
				const retryOptions = {
					flush: args.includes("--flush") || args.includes("-f"),
				}
				await cmdRetry(retryOptions)
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
