#!/usr/bin/env node
/**
 * superroo-learn — Global CLI for the SuperRoo Cross-Project Learning Layer
 *
 * Query, store, and manage lessons from ANY project directory.
 * Connects to the Central Brain via MCP server (port 3419) with
 * automatic local fallback when the server is unreachable.
 *
 * Usage:
 *   superroo-learn query "<text>" [project]         Search lessons across all projects
 *   superroo-learn store "<topic>" "<content>"      Store a new lesson
 *   superroo-learn recall "<text>"                  Semantic search via Hermes Claw
 *   superroo-learn projects                         List registered projects
 *   superroo-learn register [name]                  Register current directory as a project
 *   superroo-learn scan [--dir <path>] [--dry-run]  Retroactively extract lessons from existing repo
 *   superroo-learn publish [--skill <name>]         Publish structured lessons from a skill to Central Brain
 *   superroo-learn extract-commit <sha> <msg> <author> <files>  Auto-extract from git commit (DeepSeek-summarized)
 *   superroo-learn status                           Show learning layer status
 *   superroo-learn health                           Check Central Brain and local fallback health
 *   superroo-learn sync [--force|--dry-run|--status]  Push local lessons to Central Brain
 *   superroo-learn retry [--flush]                  Process retry queue (failed MCP stores)
 *   superroo-learn report                           Generate cross-project lesson report
 *   superroo-learn trace "<text>"                   Trace a lesson/topic across projects
 *
 * Environment variables:
 *   SUPERROO_MCP_URL       — MCP server URL (default: http://127.0.0.1:3419/mcp)
 *   SUPERROO_PROJECT       — Override project name auto-detection
 *   SUPERROO_DAEMON_TOKEN  — Auth token for the daemon
 *   SUPERROO_NO_FALLBACK   — Set to "1" to disable local fallback
 *   SUPERROO_RETRY_MAX     — Max retry attempts for queued operations (default: 5)
 *   SUPERROO_RETRY_BASE_MS — Base delay for exponential backoff in ms (default: 2000)
 *   SUPERROO_MEMORY_DIR    — Path to a shared cross-project lesson store directory
 *                           (default: ~/superroo/superroo2/memory/)
 */

import { execSync } from "child_process"
import fs from "fs/promises"
import { accessSync, readFileSync } from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Configuration ──

const MCP_URL = process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
const CONFIG_DIR = path.join(os.homedir(), ".superroo")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")
const NO_FALLBACK = process.env.SUPERROO_NO_FALLBACK === "1"

/**
 * Shared cross-project lesson store directory.
 * Can be overridden via SUPERROO_MEMORY_DIR env var.
 * Defaults to ~/superroo/superroo2/memory/ which is the superroo2 repo.
 */
const SHARED_MEMORY_DIR = (() => {
	if (process.env.SUPERROO_MEMORY_DIR) {
		return process.env.SUPERROO_MEMORY_DIR
	}
	// Try common locations
	const candidates = [
		path.join(os.homedir(), "superroo", "superroo2", "memory"),
		path.join(os.homedir(), "superroo2", "memory"),
	]
	for (const dir of candidates) {
		try {
			accessSync(dir)
			return dir
		} catch {}
	}
	// Fall back to the first candidate even if it doesn't exist yet
	return candidates[0]
})()

// ── DeepSeek API Configuration ──

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
const DEEPSEEK_MODEL = "deepseek-chat"
const DEEPSEEK_TIMEOUT_MS = 30000

/**
 * Load environment variables from .env file (lightweight, no dotenv dependency).
 * Checks ROOT/.env, ROOT/cloud/.env, and the superroo2 repo's .env as fallback
 * (for cross-project use where the global hook runs from ~/.superroo/bin/).
 */
function loadEnvFile() {
	if (process.env.DEEPSEEK_API_KEY) return // already set
	const root = path.resolve(__dirname, "..")
	const superroo2Env = path.resolve(os.homedir(), "superroo", "superroo2", ".env")
	const candidates = [
		path.join(root, ".env"),
		path.join(root, "cloud", ".env"),
		superroo2Env,
	]
	for (const envPath of candidates) {
		try {
			accessSync(envPath)
			const text = readFileSync(envPath, "utf-8")
			for (const line of text.split("\n")) {
				const trimmed = line.trim()
				if (!trimmed || trimmed.startsWith("#")) continue
				const eqIdx = trimmed.indexOf("=")
				if (eqIdx === -1) continue
				const key = trimmed.slice(0, eqIdx).trim()
				const val = trimmed.slice(eqIdx + 1).trim()
				if (key === "DEEPSEEK_API_KEY" && !process.env.DEEPSEEK_API_KEY) {
					process.env.DEEPSEEK_API_KEY = val
				}
			}
		} catch {}
	}
}

/**
 * Summarize text using DeepSeek API.
 * Returns a concise summary string, or the original text if summarization fails.
 */
async function deepseekSummarize(text, instruction) {
	loadEnvFile()
	const apiKey = process.env.DEEPSEEK_API_KEY
	if (!apiKey) {
		console.error("⚠️  DEEPSEEK_API_KEY not set. Skipping DeepSeek summarization.")
		return text
	}

	const systemPrompt = "You are a precise engineering lesson summarizer. Summarize the following content concisely, extracting the key engineering insight, root cause, and reusable takeaway. Keep the summary under 200 words."
	const userPrompt = instruction || "Summarize this engineering lesson:"

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)

	try {
		const response = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: DEEPSEEK_MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: `${userPrompt}\n\n${text}` },
				],
				max_tokens: 300,
				temperature: 0.3,
			}),
			signal: controller.signal,
		})

		if (!response.ok) {
			const errText = await response.text().catch(() => "unknown")
			console.error(`⚠️  DeepSeek API error (${response.status}): ${errText}`)
			return text
		}

		const data = await response.json()
		const summary = data?.choices?.[0]?.message?.content?.trim()
		if (!summary) {
			console.error("⚠️  DeepSeek returned empty response")
			return text
		}
		return summary
	} catch (err) {
		if (err.name === "AbortError") {
			console.error("⚠️  DeepSeek API request timed out")
		} else {
			console.error(`⚠️  DeepSeek API request failed: ${err.message}`)
		}
		return text
	} finally {
		clearTimeout(timeout)
	}
}

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

	// Also check the shared cross-project lesson store (SUPERROO_MEMORY_DIR or default)
	const sharedParent = path.dirname(SHARED_MEMORY_DIR)
	if (!searchPaths.includes(sharedParent)) {
		searchPaths.push(sharedParent)
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
 * Searches the nearest project's files first, then falls back to the
 * superroo2 shared cross-project lesson store if no matches found.
 */
async function queryLocalLessons(query, limit = 10) {
	const files = findLocalLessonFiles()
	const results = []

	// Helper: search a single JSONL file
	async function searchJsonl(jsonlPath) {
		const found = []
		try {
			const content = await fs.readFile(jsonlPath, "utf-8")
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
						found.push({
							file: jsonlPath,
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
		return found
	}

	// Helper: search a single markdown file
	async function searchMarkdown(mdPath) {
		const found = []
		try {
			const content = await fs.readFile(mdPath, "utf-8")
			const queryLower = query.toLowerCase()
			const lessonBlocks = content.split(/(?=^### Lesson:)/m)

			for (const block of lessonBlocks) {
				if (block.toLowerCase().includes(queryLower)) {
					found.push({
						file: mdPath,
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
		return found
	}

	// Phase 1: Search the nearest project's files
	if (files.jsonl) {
		const jsonlResults = await searchJsonl(files.jsonl)
		results.push(...jsonlResults)
	}

	if (results.length === 0 && files.md) {
		const mdResults = await searchMarkdown(files.md)
		results.push(...mdResults)
	}

	// Phase 2: If no matches in the local project, also search the shared
	// cross-project lesson store (SUPERROO_MEMORY_DIR or default).
	// This ensures lessons from other projects (e.g., productgenerator)
	// are findable from any project directory.
	if (results.length === 0) {
		const sharedJsonl = path.join(SHARED_MEMORY_DIR, "lesson-index.jsonl")
		if (sharedJsonl !== files.jsonl) {
			try {
				accessSync(sharedJsonl)
				const sharedResults = await searchJsonl(sharedJsonl)
				if (sharedResults.length > 0) {
					results.push(...sharedResults)
				}
			} catch {}
		}

		// If still no matches, try shared markdown
		if (results.length === 0) {
			const sharedMd = path.join(SHARED_MEMORY_DIR, "lessons-learned.md")
			if (sharedMd !== files.md) {
				try {
					accessSync(sharedMd)
					const sharedResults = await searchMarkdown(sharedMd)
					if (sharedResults.length > 0) {
						results.push(...sharedResults)
					}
				} catch {}
			}
		}
	}

	return { results, source: results.length > 0 ? "local-jsonl" : "none" }
}

/**
 * Store a lesson locally (fallback when Central Brain is unreachable).
 * @param {string} topic - Lesson topic/title
 * @param {string} content - Full lesson content (markdown)
 * @param {string} [summary] - Optional DeepSeek-generated summary for JSONL index
 */
async function storeLessonLocally(topic, content, summary) {
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
Model/API used: ${summary ? "deepseek-chat" : "local"}
Confidence: ${summary ? "high" : "medium"}
Related files:
Tags:

#### Task Summary

${content}

#### Lesson Learned

${summary || content}

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
			model: summary ? "deepseek-chat" : "local",
			confidence: summary ? "high" : "medium",
			project: project,
			files: [],
			tags: ["cross-project", "local-fallback"],
			relevance_score: 0.7,
			relevance_factors: {},
			rule_summary: (summary || content).slice(0, 200),
			lesson_summary: (summary || content).slice(0, 300),
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

		// Check if Central Brain returned empty results — if so, try local fallback
		// This handles the case where pgvector/semantic search is offline but the
		// MCP server itself is running (returns 0 results without error)
		if (result && typeof result === "object") {
			const resultsArray = result.results || result.matches || result
			const isEmpty = Array.isArray(resultsArray) && resultsArray.length === 0
			if (isEmpty) {
				console.error(`⚠️  Central Brain returned 0 results for "${operationName}" — trying local fallback...`)
				const fallbackResult = await fallbackFn()
				if (retryContext) {
					await enqueueRetry(
						retryContext.operation,
						retryContext.topic,
						retryContext.content,
						retryContext.project,
					)
				}
				return { success: true, result: fallbackResult, fallbackUsed: true }
			}
		}

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

	// Also register with Central Brain via MCP (best-effort)
	try {
		await withFallback(
			async () => {
				await mcpToolCall("hermes_learn", {
					topic: `[system] Project registered: ${project}`,
					content: JSON.stringify({
						type: "project_registration",
						project,
						directory: process.cwd(),
						registeredAt: new Date().toISOString(),
					}),
				})
				console.error(`   ✅ Also registered "${project}" in Central Brain`)
				return { success: true }
			},
			async () => {
				// Local fallback: just note it in the config (already done above)
				return { success: true, stored: "local-only" }
			},
			`register-${project}`,
			{ operation: "register", project },
		)
	} catch (err) {
		console.error(`   ⚠️  Could not register in Central Brain: ${err.message}`)
		console.error(`   (Project is still registered locally in ${CONFIG_FILE})`)
	}

	console.log(JSON.stringify({ project, configFile: CONFIG_FILE, centralBrain: "best-effort" }, null, 2))
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

	// Build raw lesson content from the commit
	const topic = `[${project}] ${message.split("\n")[0].slice(0, 120)}`
	const rawContent = [
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

	// Generate a concise DeepSeek summary for the lesson
	console.error(`   🤖 Generating DeepSeek summary for commit ${sha}...`)
	const summary = await deepseekSummarize(
		`Commit: ${message}\nFiles: ${files}\nProject: ${project}`,
		"Summarize this engineering commit as a reusable lesson. Extract: what was fixed, why it broke, and the reusable takeaway.",
	)

	// Use the summary as the lesson content (richer than raw commit data)
	const content = summary !== rawContent ? [
		`## DeepSeek-Summarized Lesson from commit ${sha}`,
		``,
		`**Project:** ${project}`,
		`**Author:** ${author}`,
		`**Commit:** ${sha}`,
		`**Files:** ${files}`,
		``,
		`**Summary:**`,
		summary,
		``,
		`---`,
		`*Original commit message: ${message.split("\n")[0]}*`,
	].join("\n") : rawContent

	const { success, result, fallbackUsed } = await withFallback(
		async () => {
			return await mcpToolCall("hermes_learn", { topic, content })
		},
		async () => {
			await storeLessonLocally(topic, content, summary)
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

/**
	* Scan a repository for retroactive lesson extraction.
	* Analyzes git history and source files to find lesson-worthy content.
	*
	* Usage:
	*   superroo-learn scan                    Scan current directory
	*   superroo-learn scan --dir ~/xsjprd55   Scan specific project
	*   superroo-learn scan --dry-run          Preview without storing
	*/
async function cmdScan(options = {}) {
	const { dir = process.cwd(), dryRun = false } = options
	const originalCwd = process.cwd()

	console.error(`🔍 Scanning repository for retroactive lesson extraction...`)
	console.error(`   Directory: ${dir}`)
	console.error(`   Dry run:   ${dryRun ? "✅ Yes (no data will be stored)" : "❌ No"}`)
	console.error("")

	// Change to target directory for git commands
	try {
		process.chdir(dir)
	} catch (err) {
		console.error(`❌ Cannot access directory: ${dir}`)
		process.exit(1)
	}

	const project = detectProjectName()
	console.error(`   Project:   ${project}`)
	console.error("")

	const results = {
		project,
		directory: dir,
		commitsExtracted: 0,
		patternsFound: 0,
		skillsFound: 0,
		totalLessons: 0,
		lessons: [],
	}

	// ── Phase 1: Scan git history for lesson-worthy commits ──
	console.error("── Phase 1: Scanning git history ──────────────────────────")

	let commitCount = 0
	try {
		const logOutput = execSync(
			'git log --all --format="%H||%s||%an||%ai" --diff-filter=ACDMR --name-only',
			{ encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 10 * 1024 * 1024 }
		)

		const commits = logOutput.split("\n").filter(l => l.trim())
		const commitBlocks = []
		let currentBlock = null

		for (const line of commits) {
			if (line.includes("||")) {
				if (currentBlock) commitBlocks.push(currentBlock)
				const [sha, msg, author, date] = line.split("||")
				currentBlock = { sha, msg, author, date: date || "", files: [] }
			} else if (currentBlock && line.trim()) {
				currentBlock.files.push(line.trim())
			}
		}
		if (currentBlock) commitBlocks.push(currentBlock)

		commitCount = commitBlocks.length
		console.error(`   Found ${commitCount} total commits. Scanning for lesson indicators...`)

		const indicators = [
			/fix(e[ds])?:?\s+/i, /bug:?:?\s+/i, /lesson:?:?\s+/i,
			/workaround:?:?\s+/i, /solution:?:?\s+/i, /issue:?:?\s+/i,
			/error:?:?\s+/i, /crash:?:?\s+/i, /race[\s-]?condition:?:?\s+/i,
			/memory[\s-]?leak:?:?\s+/i, /performance:?:?\s+/i,
			/optimize:?:?\s+/i, /refactor:?:?\s+/i, /breaking[\s-]?change:?:?\s+/i,
			/add:?\s+/i, /implement:?\s+/i, /feature:?\s+/i,
		]

		for (const block of commitBlocks) {
			const matched = indicators.filter(p => p.test(block.msg))
			if (matched.length === 0) continue

			const topic = `[${project}] ${block.msg.split("\n")[0].slice(0, 120)}`
			const rawContent = [
				`## Auto-extracted from commit ${block.sha}`,
				``,
				`**Project:** ${project}`,
				`**Author:** ${block.author}`,
				`**Date:** ${block.date}`,
				`**Message:** ${block.msg}`,
				`**Files:** ${block.files.join(", ")}`,
				``,
				`**Indicators matched:** ${matched.join(", ")}`,
				``,
				`**Lesson:** Review this commit for reusable engineering insights.`,
			].join("\n")

			// Generate DeepSeek summary for the commit
			console.error(`   🤖 Generating DeepSeek summary for commit ${block.sha.slice(0, 8)}...`)
			const summary = await deepseekSummarize(
				`Commit: ${block.msg}\nFiles: ${block.files.join(", ")}\nProject: ${project}`,
				"Summarize this engineering commit as a reusable lesson. Extract: what was fixed, why it broke, and the reusable takeaway.",
			)

			const content = summary !== rawContent ? [
				`## DeepSeek-Summarized Lesson from commit ${block.sha}`,
				``,
				`**Project:** ${project}`,
				`**Author:** ${block.author}`,
				`**Date:** ${block.date}`,
				`**Commit:** ${block.sha}`,
				`**Files:** ${block.files.join(", ")}`,
				``,
				`**Summary:**`,
				summary,
				``,
				`---`,
				`*Original commit message: ${block.msg.split("\n")[0]}*`,
			].join("\n") : rawContent

			results.commitsExtracted++
			results.totalLessons++

			if (!dryRun) {
				// Auto-register project if not known
				const config = await getConfig()
				if (!config.projects[project]) {
					config.projects[project] = {
						firstSeen: new Date().toISOString(),
						registered: new Date().toISOString(),
						directory: dir,
					}
					await saveConfig(config)
				}

				await withFallback(
					async () => await mcpToolCall("hermes_learn", { topic, content }),
					async () => { await storeLessonLocally(topic, content, summary); return { success: true, stored: "local" } },
					`scan-commit-${block.sha.slice(0, 8)}`,
					{ operation: "store", topic, content, project },
				)
			}

			results.lessons.push({
				type: "commit",
				sha: block.sha.slice(0, 8),
				topic: topic.slice(0, 80),
				matched: matched.map(m => m.source),
			})
		}
	} catch (err) {
		console.error(`   ⚠️  Git history scan failed: ${err.message}`)
		console.error("   (This is normal if the directory is not a git repository)")
	}

	console.error(`   ✅ Extracted ${results.commitsExtracted} lessons from git history`)
	console.error("")

	// ── Phase 2: Scan for architecture patterns in source files ──
	console.error("── Phase 2: Scanning source files for architecture patterns ─")

	const patternSignatures = [
		{ name: "Brain Pipeline", pattern: /buildSignalContext|brain-router|brain.*pipeline|pipeline.*stage/g, confidence: "high" },
		{ name: "Safety Gates", pattern: /risk.?gate|safety.?gate|gates\.push|gates\.every|verdict.*BLOCKED/g, confidence: "high" },
		{ name: "Weighted Scoring", pattern: /composite.*=.*\*.*0\.\d+|weighted.*score|factor.*\*.*0\./g, confidence: "high" },
		{ name: "Signal TTL Schema", pattern: /valid_until|generated_at|entity_type.*status.*confidence/g, confidence: "medium" },
		{ name: "Learning Pipeline", pattern: /learning.?layer|recordOutcome|discoverPatterns|detectRegime|tuneWeights|generateSkills/g, confidence: "high" },
		{ name: "Multi-Worker PM2", pattern: /ecosystem\.config|exec_mode.*fork|max_memory_restart|kill_timeout/g, confidence: "high" },
		{ name: "Subsystem Bridge", pattern: /mock.*bridge|bridge\.recordOutcome|bridge\.getRegime|bridge\.checkSkills/g, confidence: "medium" },
		{ name: "Multi-Agent Attribution", pattern: /coder.?signature|coder.?changelog|agent.*attribution|signature.*prefix/g, confidence: "medium" },
		{ name: "Deployment Verification", pattern: /deploy.?checker|deploy.?verify|health.*endpoint.*200|deploy.*checklist/g, confidence: "medium" },
		{ name: "Env-Configurable Config", pattern: /process\.env\..*\|.*\d+|FEATURE_ENABLED.*!==.*false/g, confidence: "medium" },
	]

	// Walk through source files (limited depth to avoid huge scans)
	const sourceDirs = ["src", "lib", "workers", "api", "scripts"]
	for (const subdir of sourceDirs) {
		const fullPath = path.join(dir, subdir)
		try {
			await fs.access(fullPath)
			const entries = await fs.readdir(fullPath, { withFileTypes: true, recursive: true })

			for (const entry of entries) {
				if (!entry.isFile()) continue
				const ext = path.extname(entry.name)
				if (![".js", ".ts", ".mjs", ".cjs", ".py", ".jsx", ".tsx"].includes(ext)) continue

				const filePath = path.join(entry.parentPath || fullPath, entry.name)
				try {
					const content = await fs.readFile(filePath, "utf-8")
					const relativePath = path.relative(dir, filePath)

					for (const sig of patternSignatures) {
						sig.pattern.lastIndex = 0
						const match = content.match(sig.pattern)
						if (match) {
							const topic = `[${project}] Architecture Pattern: ${sig.name}`
							const contentStr = [
								`## Architecture Pattern: ${sig.name}`,
								``,
								`**Project:** ${project}`,
								`**File:** ${relativePath}`,
								`**Confidence:** ${sig.confidence}`,
								`**Match:** \`${match[0].slice(0, 100)}\``,
								``,
								`**Pattern Description:**`,
								`This repository contains the ${sig.name} pattern detected in ${relativePath}.`,
								`See the coding-lessons-from-trading-bot skill for the full reusable lesson.`,
							].join("\n")

							results.patternsFound++
							results.totalLessons++

							if (!dryRun) {
								await withFallback(
									async () => await mcpToolCall("hermes_learn", { topic, content: contentStr }),
									async () => { await storeLessonLocally(topic, contentStr); return { success: true, stored: "local" } },
									`scan-pattern-${sig.name.replace(/\s+/g, "-").toLowerCase()}`,
									{ operation: "store", topic, content: contentStr, project },
								)
							}

							results.lessons.push({
								type: "pattern",
								pattern: sig.name,
								file: relativePath,
								confidence: sig.confidence,
							})
							break // One pattern per file
						}
					}
				} catch {
					// Skip unreadable files
				}
			}
		} catch {
			// Directory doesn't exist, skip
		}
	}

	console.error(`   ✅ Found ${results.patternsFound} architecture pattern(s) in source files`)
	console.error("")

	// ── Phase 3: Scan for existing skill files ──
	console.error("── Phase 3: Scanning for existing skill files ─────────────")

	const skillDir = path.join(dir, ".roo", "skills")
	try {
		await fs.access(skillDir)
		const skillEntries = await fs.readdir(skillDir, { withFileTypes: true })

		for (const entry of skillEntries) {
			if (!entry.isDirectory()) continue
			const skillFile = path.join(skillDir, entry.name, "SKILL.md")
			try {
				const skillContent = await fs.readFile(skillFile, "utf-8")
				const lessonBlocks = skillContent.split(/(?=^## Lesson \d+:)/m)

				for (const block of lessonBlocks) {
					if (!block.trim()) continue
					const titleMatch = block.match(/^## Lesson \d+:\s*(.+)$/m)
					const title = titleMatch ? titleMatch[1].trim() : `Skill: ${entry.name}`

					const topic = `[${project}] ${title}`
					const content = [
						`## ${title}`,
						``,
						`**Project:** ${project}`,
						`**Skill:** ${entry.name}`,
						``,
						block.trim().slice(0, 1000),
					].join("\n")

					results.skillsFound++
					results.totalLessons++

					if (!dryRun) {
						await withFallback(
							async () => await mcpToolCall("hermes_learn", { topic, content }),
							async () => { await storeLessonLocally(topic, content); return { success: true, stored: "local" } },
							`scan-skill-${entry.name}-${title.slice(0, 30).replace(/\s+/g, "-")}`,
							{ operation: "store", topic, content, project },
						)
					}

					results.lessons.push({
						type: "skill",
						skill: entry.name,
						title,
					})
				}
			} catch {
				// Skip unreadable skill files
			}
		}
	} catch {
		console.error("   ℹ️  No .roo/skills directory found")
	}

	console.error(`   ✅ Extracted ${results.skillsFound} lesson(s) from skill files`)
	console.error("")

	// ── Summary ──
	console.error("╔══════════════════════════════════════════════════════════╗")
	console.error("║     📊 Scan Complete                                    ║")
	console.error("╚══════════════════════════════════════════════════════════╝")
	console.error("")
	console.error(`   Project:              ${results.project}`)
	console.error(`   Directory:            ${dir}`)
	console.error(`   Git commits scanned:  ${commitCount}`)
	console.error(`   Lessons from commits: ${results.commitsExtracted}`)
	console.error(`   Patterns found:       ${results.patternsFound}`)
	console.error(`   Skill lessons:        ${results.skillsFound}`)
	console.error(`   Total lessons:        ${results.totalLessons}`)
	if (dryRun) {
		console.error(`   Mode:                 🔍 Dry run (nothing stored)`)
	} else {
		console.error(`   Mode:                 ✅ Lessons stored (Central Brain or local fallback)`)
	}
	console.error("")

	// Restore original working directory
	process.chdir(originalCwd)

	console.log(JSON.stringify(results, null, 2))
}

/**
	* Publish structured lessons from a skill to Central Brain.
	* This is the universal replacement for project-specific sync scripts.
	*
	* Usage:
	*   superroo-learn publish --skill coding-lessons-from-trading-bot
	*   superroo-learn publish --dir ~/xsjprd55 --skill my-skill
	*   superroo-learn publish --dry-run
	*/
async function cmdPublish(options = {}) {
	const { skill: skillName, dir = process.cwd(), dryRun = false } = options
	const originalCwd = process.cwd()

	console.error(`📤 Publishing structured lessons to Central Brain...`)
	console.error(`   Skill:       ${skillName || "(auto-detect)"}`)
	console.error(`   Directory:   ${dir}`)
	console.error(`   Dry run:     ${dryRun ? "✅ Yes" : "❌ No"}`)
	console.error("")

	// Change to target directory
	try {
		process.chdir(dir)
	} catch (err) {
		console.error(`❌ Cannot access directory: ${dir}`)
		process.exit(1)
	}

	const project = detectProjectName()
	console.error(`   Project:     ${project}`)
	console.error("")

	const results = {
		project,
		skill: skillName || "auto-detected",
		lessonsPublished: 0,
		lessons: [],
	}

	// Find the skill file
	let skillFilePath = null
	let skillContent = null

	if (skillName) {
		// Check both global and project-local skill directories
		const searchPaths = [
			path.join(os.homedir(), ".roo", "skills", skillName, "SKILL.md"),
			path.join(dir, ".roo", "skills", skillName, "SKILL.md"),
			path.join(dir, "..", ".roo", "skills", skillName, "SKILL.md"),
		]
		for (const sp of searchPaths) {
			try {
				await fs.access(sp)
				skillFilePath = sp
				break
			} catch {}
		}
	} else {
		// Auto-detect: look for skill files in .roo/skills/
		const localSkills = path.join(dir, ".roo", "skills")
		try {
			const entries = await fs.readdir(localSkills, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				const sp = path.join(localSkills, entry.name, "SKILL.md")
				try {
					await fs.access(sp)
					if (!skillFilePath) {
						skillFilePath = sp
						results.skill = entry.name
					}
				} catch {}
			}
		} catch {}
	}

	if (!skillFilePath) {
		console.error(`❌ Skill "${skillName || "auto-detect"}" not found.`)
		console.error(`   Searched: ~/.roo/skills/<name>/SKILL.md and .roo/skills/<name>/SKILL.md`)
		process.chdir(originalCwd)
		process.exit(1)
	}

	console.error(`   Skill file:  ${skillFilePath}`)
	skillContent = await fs.readFile(skillFilePath, "utf-8")
	console.error("")

	// Extract lesson blocks from the skill
	// Supports both formats:
	//   ## Lesson 1: Title  (coding-lessons-from-trading-bot style)
	//   ### Lesson: Title  (lessons-learned.md style)
	const lessonBlocks = skillContent.split(/(?=^#{2,3} Lesson\b)/m)

	for (const block of lessonBlocks) {
		if (!block.trim()) continue

		// Extract title
		const titleMatch = block.match(/^#{2,3} Lesson\b[:\s]\s*(.+)$/m)
		if (!titleMatch) continue

		const title = titleMatch[1].trim()

		// Extract description/summary
		const descMatch = block.match(/^\*\*(.*?)\*\*$/m)
		const description = descMatch ? descMatch[1] : ""

		// Extract source file references
		const sourceFiles = []
		const sourceMatches = block.matchAll(/`([^`]+)`/g)
		for (const m of sourceMatches) {
			if (m[1].includes("/") || m[1].endsWith(".js") || m[1].endsWith(".ts") || m[1].endsWith(".mjs") || m[1].endsWith(".cjs")) {
				sourceFiles.push(m[1])
			}
		}

		// Extract tags
		const tags = []
		const tagSection = block.match(/Tags:\s*(.+)$/m)
		if (tagSection) {
			tags.push(...tagSection[1].split(",").map(t => t.trim()).filter(Boolean))
		}
		// Also extract from "When to use" section
		if (block.toLowerCase().includes("when to use")) {
			tags.push("when-to-use")
		}
		if (block.toLowerCase().includes("key implementation rules")) {
			tags.push("implementation-rules")
		}
		if (block.toLowerCase().includes("validation")) {
			tags.push("validation")
		}

		// Build structured lesson content
		const topic = `[${project}] ${title}`
		const content = [
			`## ${title}`,
			``,
			`**Source:** ${results.skill}`,
			`**Project:** ${project}`,
			`**Files:** ${sourceFiles.join(", ") || "N/A"}`,
			`**Tags:** ${tags.join(", ") || "coding-lessons"}`,
			``,
			block.trim(),
		].join("\n")

		results.lessonsPublished++
		results.lessons.push({
			title,
			sourceFiles,
			tags,
		})

		if (!dryRun) {
			// Auto-register project
			const config = await getConfig()
			if (!config.projects[project]) {
				config.projects[project] = {
					firstSeen: new Date().toISOString(),
					registered: new Date().toISOString(),
					directory: dir,
				}
				await saveConfig(config)
			}

			await withFallback(
				async () => await mcpToolCall("hermes_learn", { topic, content }),
				async () => { await storeLessonLocally(topic, content); return { success: true, stored: "local" } },
				`publish-${title.slice(0, 30).replace(/\s+/g, "-").toLowerCase()}`,
				{ operation: "store", topic, content, project },
			)
		}
	}

	// Restore original working directory
	process.chdir(originalCwd)

	// Summary
	console.error("")
	console.error("╔══════════════════════════════════════════════════════════╗")
	console.error("║     📤 Publish Complete                                ║")
	console.error("╚══════════════════════════════════════════════════════════╝")
	console.error("")
	console.error(`   Skill:              ${results.skill}`)
	console.error(`   Project:            ${results.project}`)
	console.error(`   Lessons published:  ${results.lessonsPublished}`)
	if (dryRun) {
		console.error(`   Mode:               🔍 Dry run (nothing stored)`)
	} else {
		console.error(`   Mode:               ✅ Stored to Central Brain (or local fallback)`)
	}
	console.error("")

	console.log(JSON.stringify(results, null, 2))
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

/**
 * Infer the project name from a lesson object.
 * Checks the `project` field first, then falls back to parsing the `source` field.
 */
function inferProject(lesson) {
	if (lesson.project) return lesson.project
	if (lesson.source) {
		// Try to extract project name from source like "Codex task completion" or "[superroo2] fix: ..."
		const sourceMatch = lesson.source.match(/\[(.+?)\]/)
		if (sourceMatch) return sourceMatch[1]
	}
	return "unknown"
}

/**
 * Generate a comprehensive report of all lessons across projects.
 * Queries Central Brain (with local fallback) and produces rich statistics.
 */
async function cmdReport(options = {}) {
	const { format = "text" } = options
	console.error("📊 Generating cross-project lesson report...")
	console.error("")

	// Collect lessons from Central Brain
	let allLessons = []
	let sourceInfo = ""

	try {
		const result = await mcpToolCall("query_memory", { query: "", maxResults: 1000 })
		allLessons = Array.isArray(result) ? result : (result?.results || result?.lessons || [])
		sourceInfo = "Central Brain"
	} catch (err) {
		console.error(`⚠️  Central Brain unreachable: ${err.message}`)
		console.error("   Falling back to local lesson files...")
		const local = await queryLocalLessons("", 1000)
		allLessons = local?.results?.flatMap(r => r.matches.map(m => {
			try { return JSON.parse(m.text) } catch { return { title: m.text } }
		})) || []
		sourceInfo = "local files"
	}

	// Also load local JSONL directly for richer data
	const localFiles = findLocalLessonFiles()
	let localLessons = []
	if (localFiles.jsonl) {
		try {
			const content = await fs.readFile(localFiles.jsonl, "utf-8")
			localLessons = content.split("\n").filter(l => l.trim()).map(l => {
				try { return JSON.parse(l) } catch { return null }
			}).filter(Boolean)
		} catch {}
	}

	// Merge: prefer local JSONL data (richer structure), fall back to Central Brain results
	const mergedLessons = localLessons.length > 0 ? localLessons : allLessons

	if (mergedLessons.length === 0) {
		console.error("📭 No lessons found.")
		console.log(JSON.stringify({ total: 0, projects: {}, types: {}, tags: {}, confidence: {}, timeline: {} }, null, 2))
		return
	}

	// ── Compute Statistics ──

	// 1. By project
	const byProject = {}
	for (const lesson of mergedLessons) {
		const proj = inferProject(lesson)
		if (!byProject[proj]) byProject[proj] = { count: 0, types: {}, tags: {}, lastDate: null }
		byProject[proj].count++
		const type = lesson.type || "unknown"
		byProject[proj].types[type] = (byProject[proj].types[type] || 0) + 1
		for (const tag of (lesson.tags || [])) {
			byProject[proj].tags[tag] = (byProject[proj].tags[tag] || 0) + 1
		}
		if (lesson.date && (!byProject[proj].lastDate || lesson.date > byProject[proj].lastDate)) {
			byProject[proj].lastDate = lesson.date
		}
	}

	// 2. By type
	const byType = {}
	for (const lesson of mergedLessons) {
		const type = lesson.type || "unknown"
		if (!byType[type]) byType[type] = { count: 0, projects: {} }
		byType[type].count++
		const proj = inferProject(lesson)
		byType[type].projects[proj] = (byType[type].projects[proj] || 0) + 1
	}

	// 3. By confidence
	const byConfidence = {}
	for (const lesson of mergedLessons) {
		const conf = lesson.confidence || "unknown"
		byConfidence[conf] = (byConfidence[conf] || 0) + 1
	}

	// 4. By tag
	const byTag = {}
	for (const lesson of mergedLessons) {
		for (const tag of (lesson.tags || [])) {
			if (!byTag[tag]) byTag[tag] = { count: 0, projects: {} }
			byTag[tag].count++
			const proj = inferProject(lesson)
			byTag[tag].projects[proj] = (byTag[tag].projects[proj] || 0) + 1
		}
	}

	// 5. Timeline (lessons per month)
	const timeline = {}
	for (const lesson of mergedLessons) {
		if (lesson.date) {
			const month = lesson.date.slice(0, 7) // YYYY-MM
			if (!timeline[month]) timeline[month] = { count: 0, projects: {} }
			timeline[month].count++
			const proj = inferProject(lesson)
			timeline[month].projects[proj] = (timeline[month].projects[proj] || 0) + 1
		}
	}

	// 6. Sync status
	const retryQueue = await readRetryQueue()
	const syncState = { retryQueueLength: retryQueue.length }

	// Build report
	const report = {
		generatedAt: new Date().toISOString(),
		source: sourceInfo,
		totalLessons: mergedLessons.length,
		projects: Object.keys(byProject).sort(),
		projectCount: Object.keys(byProject).length,
		byProject,
		byType,
		byConfidence,
		byTag: Object.fromEntries(
			Object.entries(byTag).sort((a, b) => b[1].count - a[1].count)
		),
		timeline: Object.fromEntries(
			Object.entries(timeline).sort((a, b) => a[0].localeCompare(b[0]))
		),
		syncState,
	}

	// ── Text Output ──
	if (format === "text") {
		console.error("")
		console.error("╔══════════════════════════════════════════════════════════╗")
		console.error("║     📊 SuperRoo Cross-Project Lesson Report             ║")
		console.error("╚══════════════════════════════════════════════════════════╝")
		console.error("")
		console.error(`   Generated:     ${report.generatedAt}`)
		console.error(`   Source:        ${report.source}`)
		console.error(`   Total lessons: ${report.totalLessons}`)
		console.error(`   Projects:      ${report.projectCount}`)
		console.error("")
		console.error("── Projects ──────────────────────────────────────────────")
		for (const [proj, data] of Object.entries(byProject).sort((a, b) => b[1].count - a[1].count)) {
			const typesStr = Object.entries(data.types).map(([t, c]) => `${t}:${c}`).join(", ")
			console.error(`   ${proj.padEnd(20)} ${String(data.count).padStart(3)} lessons  [${typesStr}]  last: ${data.lastDate || "?"}`)
		}
		console.error("")
		console.error("── By Type ───────────────────────────────────────────────")
		for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
			const projs = Object.entries(data.projects).map(([p, c]) => `${p}:${c}`).join(", ")
			console.error(`   ${type.padEnd(15)} ${String(data.count).padStart(3)}  (${projs})`)
		}
		console.error("")
		console.error("── By Confidence ─────────────────────────────────────────")
		for (const [conf, count] of Object.entries(byConfidence).sort((a, b) => b[1] - a[1])) {
			console.error(`   ${conf.padEnd(10)} ${String(count).padStart(3)}`)
		}
		console.error("")
		console.error("── Top Tags ──────────────────────────────────────────────")
		const topTags = Object.entries(byTag).sort((a, b) => b[1].count - a[1].count).slice(0, 15)
		for (const [tag, data] of topTags) {
			const projs = Object.keys(data.projects).join(", ")
			console.error(`   #${tag.padEnd(25)} ${String(data.count).padStart(3)}  (${projs})`)
		}
		console.error("")
		console.error("── Timeline ──────────────────────────────────────────────")
		for (const [month, data] of Object.entries(timeline).sort((a, b) => a[0].localeCompare(b[0]))) {
			const projs = Object.entries(data.projects).map(([p, c]) => `${p}:${c}`).join(", ")
			console.error(`   ${month}  ${String(data.count).padStart(3)} lessons  (${projs})`)
		}
		console.error("")
		console.error("── Sync Status ───────────────────────────────────────────")
		console.error(`   Retry queue: ${syncState.retryQueueLength > 0 ? `⚠️  ${syncState.retryQueueLength} pending` : "✅ Empty"}`)
		console.error("")
		console.error("── Cross-Project Activity ────────────────────────────────")
		const activeProjects = Object.entries(byProject).filter(([p]) => p !== "unknown").sort((a, b) => b[1].count - a[1].count)
		if (activeProjects.length > 1) {
			console.error(`   ✅ Cross-project learning is ACTIVE — ${activeProjects.length} projects contributing lessons:`)
			for (const [proj, data] of activeProjects) {
				console.error(`      • ${proj}: ${data.count} lessons (last: ${data.lastDate || "?"})`)
			}
		} else if (activeProjects.length === 1) {
			console.error(`   ⚠️  Only 1 project has contributed lessons so far.`)
			console.error(`      Install the global hook in other projects to enable cross-project learning.`)
		} else {
			console.error(`   ❌ No project-tagged lessons found.`)
		}
		console.error("")
	}

	console.log(JSON.stringify(report, null, 2))
}

/**
 * Trace a specific lesson or topic across projects.
 * Shows where the lesson originated, which files it affects, and which projects reference it.
 */
async function cmdTrace(query) {
	console.error(`🔍 Tracing: "${query}"`)
	console.error("")

	// Search Central Brain
	let results = []
	let sourceInfo = ""

	try {
		const result = await mcpToolCall("query_memory", { query, maxResults: 50 })
		results = Array.isArray(result) ? result : (result?.results || result?.lessons || [])
		sourceInfo = "Central Brain"
	} catch (err) {
		console.error(`⚠️  Central Brain unreachable: ${err.message}`)
		console.error("   Falling back to local lesson files...")
		const local = await queryLocalLessons(query, 50)
		results = local?.results?.flatMap(r => r.matches.map(m => {
			try { return JSON.parse(m.text) } catch { return { title: m.text, summary: m.text } }
		})) || []
		sourceInfo = "local files"
	}

	// Also load local JSONL for richer trace data
	const localFiles = findLocalLessonFiles()
	let localLessons = []
	if (localFiles.jsonl) {
		try {
			const content = await fs.readFile(localFiles.jsonl, "utf-8")
			const queryLower = query.toLowerCase()
			localLessons = content.split("\n").filter(l => l.trim()).map(l => {
				try {
					const lesson = JSON.parse(l)
					const searchText = [lesson.title, lesson.lesson_summary, lesson.rule_summary, ...(lesson.tags || [])].filter(Boolean).join(" ").toLowerCase()
					if (searchText.includes(queryLower)) return lesson
					return null
				} catch { return null }
			}).filter(Boolean)
		} catch {}
	}

	const mergedResults = localLessons.length > 0 ? localLessons : results

	if (mergedResults.length === 0) {
		console.error(`📭 No lessons found matching "${query}".`)
		console.log(JSON.stringify({ query, matches: 0, results: [] }, null, 2))
		return
	}

	// Build trace data
	const trace = {
		query,
		source: sourceInfo,
		totalMatches: mergedResults.length,
		byProject: {},
		byFile: {},
		byAgent: {},
		byTag: {},
		results: [],
	}

	for (const lesson of mergedResults) {
		const proj = inferProject(lesson)
		if (!trace.byProject[proj]) trace.byProject[proj] = { count: 0, lessons: [] }
		trace.byProject[proj].count++
		trace.byProject[proj].lessons.push(lesson.title || "untitled")

		for (const file of (lesson.files || [])) {
			if (!trace.byFile[file]) trace.byFile[file] = { count: 0, projects: {} }
			trace.byFile[file].count++
			trace.byFile[file].projects[proj] = (trace.byFile[file].projects[proj] || 0) + 1
		}

		const agent = lesson.source || lesson.agent || "unknown"
		if (!trace.byAgent[agent]) trace.byAgent[agent] = { count: 0, projects: {} }
		trace.byAgent[agent].count++
		trace.byAgent[agent].projects[proj] = (trace.byAgent[agent].projects[proj] || 0) + 1

		for (const tag of (lesson.tags || [])) {
			if (!trace.byTag[tag]) trace.byTag[tag] = { count: 0, projects: {} }
			trace.byTag[tag].count++
			trace.byTag[tag].projects[proj] = (trace.byTag[tag].projects[proj] || 0) + 1
		}

		trace.results.push({
			id: lesson.id || lesson.title,
			title: lesson.title,
			type: lesson.type || "unknown",
			project: proj,
			confidence: lesson.confidence || "unknown",
			date: lesson.date || "unknown",
			agent: lesson.source || lesson.agent || "unknown",
			files: lesson.files || [],
			tags: lesson.tags || [],
			summary: (lesson.lesson_summary || "").slice(0, 200),
			rule: (lesson.rule_summary || "").slice(0, 200),
		})
	}

	// ── Text Output ──
	console.error("")
	console.error("╔══════════════════════════════════════════════════════════╗")
	console.error("║     🔍 SuperRoo Lesson Trace                            ║")
	console.error("╚══════════════════════════════════════════════════════════╝")
	console.error("")
	console.error(`   Query:         "${query}"`)
	console.error(`   Source:        ${sourceInfo}`)
	console.error(`   Total matches: ${trace.totalMatches}`)
	console.error("")
	console.error("── By Project ────────────────────────────────────────────")
	for (const [proj, data] of Object.entries(trace.byProject).sort((a, b) => b[1].count - a[1].count)) {
		console.error(`   ${proj.padEnd(20)} ${String(data.count).padStart(3)} matches`)
		for (const title of data.lessons.slice(0, 3)) {
			console.error(`      • ${title.slice(0, 80)}`)
		}
		if (data.lessons.length > 3) console.error(`      ... and ${data.lessons.length - 3} more`)
	}
	console.error("")
	console.error("── By Agent ──────────────────────────────────────────────")
	for (const [agent, data] of Object.entries(trace.byAgent).sort((a, b) => b[1].count - a[1].count)) {
		const projs = Object.keys(data.projects).join(", ")
		console.error(`   ${agent.padEnd(25)} ${String(data.count).padStart(3)}  (${projs})`)
	}
	console.error("")
	console.error("── Affected Files ────────────────────────────────────────")
	const topFiles = Object.entries(trace.byFile).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
	for (const [file, data] of topFiles) {
		const projs = Object.keys(data.projects).join(", ")
		console.error(`   ${file.padEnd(50)} ${String(data.count).padStart(2)}  (${projs})`)
	}
	if (topFiles.length === 0) console.error("   (no file data)")
	console.error("")
	console.error("── Tags ──────────────────────────────────────────────────")
	const topTags = Object.entries(trace.byTag).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
	for (const [tag, data] of topTags) {
		const projs = Object.keys(data.projects).join(", ")
		console.error(`   #${tag.padEnd(25)} ${String(data.count).padStart(2)}  (${projs})`)
	}
	console.error("")

	console.log(JSON.stringify(trace, null, 2))
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
		 superroo-learn scan [--dir <path>] [--dry-run]  Retroactively extract lessons from existing repo (git history + source patterns + skills)
		 superroo-learn publish --skill <name> [--dir <path>] [--dry-run]  Publish structured lessons from a skill file to Central Brain
		 superroo-learn status                      Show learning layer status
		 superroo-learn health                      Check Central Brain and local fallback health
		 superroo-learn sync [--force|--dry-run|--status]  Push local lessons to Central Brain
		 superroo-learn retry [--flush]             Process retry queue (failed MCP stores)
		 superroo-learn report                      Generate cross-project lesson report (stats by project, type, tag, confidence, timeline)
		 superroo-learn trace "<text>"              Trace a lesson/topic across projects (origin, files, agents, tags)
		 superroo-learn --help                      Show this help
	
	Scan Command:
		 superroo-learn scan [--dir <path>] [--dry-run]
		   Phase 1: Scans full git history for lesson-worthy commits (fix, bug, lesson, etc.)
		   Phase 2: Scans source files for architecture pattern signatures
		   Phase 3: Scans .roo/skills/ for existing skill files
		   Auto-registers the project if not already known.
	
	Publish Command:
		 superroo-learn publish --skill <name> [--dir <path>] [--dry-run]
		   Parses a skill file (from ~/.roo/skills/<name>/SKILL.md or .roo/skills/<name>/SKILL.md)
		   and publishes each lesson block to Central Brain.
		   This replaces the need for project-specific sync scripts.
	
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

			case "report":
				await cmdReport()
				break

			case "trace": {
				const query = args[1]
				if (!query) throw new Error('Usage: superroo-learn trace "<text>"')
				await cmdTrace(query)
				break
			}

			case "scan": {
				const scanOptions = {
					dir: args.includes("--dir") ? args[args.indexOf("--dir") + 1] : process.cwd(),
					dryRun: args.includes("--dry-run") || args.includes("-n"),
				}
				await cmdScan(scanOptions)
				break
			}

			case "publish": {
				const publishOptions = {
					skill: args.includes("--skill") ? args[args.indexOf("--skill") + 1] : null,
					dir: args.includes("--dir") ? args[args.indexOf("--dir") + 1] : process.cwd(),
					dryRun: args.includes("--dry-run") || args.includes("-n"),
				}
				if (!publishOptions.skill) throw new Error('Usage: superroo-learn publish --skill <name> [--dir <path>] [--dry-run]')
				await cmdPublish(publishOptions)
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
