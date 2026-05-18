#!/usr/bin/env node
/**
 * Claude Code PostToolUse Hook — Auto Lesson Sync
 *
 * Fires after every Bash tool call. If the command was a git commit,
 * extracts a lesson from that commit and syncs it to the Central Brain.
 * Runs entirely in the background — never blocks Claude's response.
 *
 * Registered in ~/.claude/settings.json:
 *   "hooks": { "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /path/to/claude-hook-lesson-sync.mjs" }] }] }
 *
 * stdin: JSON event from Claude Code with keys tool_name, tool_input, tool_response
 */

import { execSync, spawn } from "child_process"
import { existsSync } from "fs"
import { readFile, appendFile, mkdir } from "fs/promises"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SUPERROO_ROOT = path.resolve(__dirname, "..")
const LOG_FILE = path.join(os.homedir(), ".superroo", "claude-hook.log")
const SYNC_STATE = path.join(SUPERROO_ROOT, "memory", ".sync-state.json")

async function log(msg) {
	try {
		await mkdir(path.dirname(LOG_FILE), { recursive: true })
		const ts = new Date().toISOString()
		await appendFile(LOG_FILE, `[${ts}] ${msg}\n`)
	} catch {
		// logging failure is non-fatal
	}
}

function isGitCommitCommand(cmd) {
	if (!cmd || typeof cmd !== "string") return false
	// match: git commit, git commit -m, git cm, etc.
	return /git\s+commit\b/.test(cmd)
}

function getRecentCommit(cwd) {
	try {
		const sha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()
		const message = execSync("git log -1 --pretty=%B", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()
		const author = execSync("git log -1 --pretty=%an", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()
		const files = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] })
			.trim()
			.replace(/\n/g, ",")
		return { sha, message, author, files }
	} catch {
		return null
	}
}

function runBackground(scriptPath, args) {
	const child = spawn(process.execPath, [scriptPath, ...args], {
		detached: true,
		stdio: "ignore",
		cwd: SUPERROO_ROOT,
		windowsHide: true,
		env: { ...process.env, SUPERROO_SYNC_TIMEOUT: "8000" },
	})
	child.unref()
	return child.pid
}

async function main() {
	// Read event JSON from stdin
	let event = {}
	try {
		const chunks = []
		for await (const chunk of process.stdin) chunks.push(chunk)
		const raw = Buffer.concat(chunks).toString("utf-8").trim()
		if (raw) event = JSON.parse(raw)
	} catch {
		// malformed or empty stdin — not a Claude hook event, exit silently
		process.exit(0)
	}

	// Only act on Bash tool calls
	if (event.tool_name !== "Bash") process.exit(0)

	const cmd = event.tool_input?.command || ""
	if (!isGitCommitCommand(cmd)) process.exit(0)

	// Determine the working directory (cwd from tool_input or SUPERROO_ROOT)
	const cwd = SUPERROO_ROOT

	// Get the commit that was just made
	const commit = getRecentCommit(cwd)
	if (!commit || !commit.sha) {
		await log("git commit detected but could not read HEAD commit")
		process.exit(0)
	}

	await log(`git commit detected: ${commit.sha.slice(0, 8)} — "${commit.message.split("\n")[0]}"`)

	// Check extract script exists
	const extractScript = path.join(SUPERROO_ROOT, "scripts", "extract-lesson-from-commit.mjs")
	const syncScript = path.join(SUPERROO_ROOT, "scripts", "sync-lessons-to-central-brain.mjs")

	if (!existsSync(extractScript) || !existsSync(syncScript)) {
		await log("ERROR: extract or sync script not found")
		process.exit(0)
	}

	// Detect project name from git remote for retry queue fallback
	let projectName = "superroo2"
	try {
		const remoteUrl = execSync("git remote get-url origin", { cwd: SUPERROO_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim()
		// Extract repo name from git URL: git@github.com:user/repo.git or https://github.com/user/repo.git
		const match = remoteUrl.match(/[\/:]([^\/]+?)(?:\.git)?$/)
		if (match) projectName = match[1]
	} catch {
		// fallback to default
	}

	// Run extract + sync in background (non-blocking)
	// We spawn a single Node process that runs both steps sequentially
	// If sync fails, we fall back to the retry queue so superroo-learn retry can pick it up
	const runner = `
import { execSync } from "child_process"
import { appendFile, mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import os from "os"

const LOG = path.join(os.homedir(), ".superroo", "claude-hook.log")
const RETRY_FILE = path.join(os.homedir(), ".superroo", "retry-queue.json")
const ts = () => new Date().toISOString()
const log = async (m) => { try { await mkdir(path.dirname(LOG), {recursive:true}); await appendFile(LOG, "["+ts()+"] "+m+"\\n") } catch {} }

// Helper: enqueue a retry item so superroo-learn retry can pick it up later
async function enqueueRetry(operation, topic, content, project) {
	 try {
	   await mkdir(path.dirname(RETRY_FILE), { recursive: true })
	   let queue = []
	   try {
	     const raw = await readFile(RETRY_FILE, "utf-8")
	     queue = JSON.parse(raw)
	   } catch {}
	   queue.push({
	     id: "retry-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
	     operation,
	     topic,
	     content,
	     project,
	     attempts: 0,
	     lastAttempt: null,
	     createdAt: new Date().toISOString(),
	   })
	   await writeFile(RETRY_FILE, JSON.stringify(queue, null, 2), "utf-8")
	   await log("retry-queue: enqueued (" + queue.length + " pending)")
	 } catch (e) {
	   await log("retry-queue: failed to enqueue — " + e.message)
	 }
}

// Step 1: Extract lesson locally
let extractOk = false
try {
	 execSync(
	   "node scripts/extract-lesson-from-commit.mjs " +
	   ${JSON.stringify(JSON.stringify(commit.sha))} + " " +
	   ${JSON.stringify(JSON.stringify(commit.message))} + " " +
	   ${JSON.stringify(JSON.stringify(commit.author))} + " " +
	   ${JSON.stringify(JSON.stringify(commit.files))},
	   { cwd: ${JSON.stringify(SUPERROO_ROOT)}, encoding: "utf-8", stdio: "ignore", timeout: 15000 }
	 )
	 await log("extract: done for ${commit.sha.slice(0, 8)}")
	 extractOk = true
} catch (e) {
	 await log("extract: failed — " + e.message)
}

// Step 2: Sync to Central Brain (with fallback to retry queue)
try {
	 execSync(
	   "node scripts/sync-lessons-to-central-brain.mjs",
	   { cwd: ${JSON.stringify(SUPERROO_ROOT)}, encoding: "utf-8", stdio: "ignore", timeout: 60000 }
	 )
	 await log("sync: complete")
} catch (e) {
	 await log("sync: failed — " + e.message)
	 // Fallback: enqueue retry so superroo-learn retry picks it up later
	 if (extractOk) {
	   const project = "${JSON.stringify(projectName)}"
	   const topic = "${JSON.stringify(commit.message.split("\\n")[0].slice(0, 120))}"
	   const content = [
	     "## Auto-extracted from commit ${commit.sha.slice(0, 8)}",
	     "",
	     "**Project:** " + project,
	     "**Author:** ${JSON.stringify(commit.author)}",
	     "**Message:** ${JSON.stringify(commit.message)}",
	     "**Files:** ${JSON.stringify(commit.files)}",
	     "",
	     "**Lesson:** Review this commit for reusable engineering insights.",
	   ].join("\\n")
	   await enqueueRetry("hermes_learn", topic, content, project)
	 }
}
`

	try {
		const child = spawn(process.execPath, ["--input-type=module", "-e", runner], {
			detached: true,
			stdio: "ignore",
			cwd: SUPERROO_ROOT,
			windowsHide: true,
		})
		child.unref()
		await log(`background worker spawned (pid ${child.pid}) for ${commit.sha.slice(0, 8)}`)
	} catch (e) {
		await log(`ERROR spawning background worker: ${e.message}`)
	}

	// Exit immediately — never block Claude
	process.exit(0)
}

main()
