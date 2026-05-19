#!/usr/bin/env node
/**
 * Verify SuperRoo global post-commit hook activity.
 *
 * Read-only helper for Codex closeout after it runs git commit.
 * It checks the global hook log and retry queue so Codex can report whether
 * lesson extraction/storage appears complete, queued, failed, or unknown.
 *
 * Usage:
 *   node tools/verify-global-hook.mjs [--sha <commit>] [--json] [--tail <n>]
 */

import fs from "fs"
import path from "path"
import os from "os"
import { execSync } from "child_process"

const SUPERROO_DIR = path.join(os.homedir(), ".superroo")
const LOG_PATH = path.join(SUPERROO_DIR, "claude-hook.log")
const QUEUE_PATH = path.join(SUPERROO_DIR, "retry-queue.json")
const GLOBAL_HOOKS_PATH = path.join(SUPERROO_DIR, "git-hooks")

function parseArgs() {
	const args = process.argv.slice(2)
	const options = { sha: "", json: false, tail: 40 }

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === "--sha" && args[i + 1]) {
			options.sha = args[++i].trim()
		} else if (arg === "--json") {
			options.json = true
		} else if (arg === "--tail" && args[i + 1]) {
			const value = Number.parseInt(args[++i], 10)
			if (Number.isFinite(value) && value > 0) {
				options.tail = value
			}
		}
	}

	return options
}

function readText(filePath) {
	try {
		return fs.readFileSync(filePath, "utf8")
	} catch {
		return ""
	}
}

function readQueue() {
	const raw = readText(QUEUE_PATH)
	if (!raw.trim()) {
		return { items: [], parseError: "" }
	}

	try {
		const parsed = JSON.parse(raw)
		return {
			items: Array.isArray(parsed) ? parsed : [],
			parseError: Array.isArray(parsed) ? "" : "retry queue is not an array",
		}
	} catch (error) {
		return { items: [], parseError: error.message }
	}
}

function gitConfigValue(args) {
	try {
		return execSync(`git config ${args}`, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
	} catch {
		return ""
	}
}

function analyzeLog(lines, sha) {
	const lowerSha = sha.toLowerCase()
	const relevant = lowerSha
		? lines.filter((line) => line.toLowerCase().includes(lowerSha))
		: lines

	return {
		relevant,
		hasCommitDetected: relevant.some((line) => line.includes("git commit detected")),
		hasWorker: relevant.some((line) => line.includes("worker spawned")),
		hasExtractDone: relevant.some((line) => line.includes("extract: done")),
		hasSyncComplete: relevant.some((line) => line.includes("sync: complete")),
		hasFailure: relevant.some((line) => /fail|error|exception/i.test(line)),
	}
}

function analyze(options) {
	const rawLog = readText(LOG_PATH)
	const lines = rawLog.trim() ? rawLog.trim().split(/\r?\n/) : []
	const queue = readQueue()
	const log = analyzeLog(lines, options.sha)
	const reasons = []
	const localHooksPath = gitConfigValue("--local core.hooksPath")
	const globalHooksPath = gitConfigValue("--global core.hooksPath")
	const localHooksBlocksGlobal = !!localHooksPath && path.resolve(localHooksPath) !== path.resolve(GLOBAL_HOOKS_PATH)

	let status = "unknown"

	if (localHooksBlocksGlobal) {
		status = "blocked"
		reasons.push(`Local core.hooksPath is set to ${localHooksPath}; this blocks the global SuperRoo hook`)
	} else if (!rawLog.trim()) {
		reasons.push(`No hook log found at ${LOG_PATH}`)
	} else if (options.sha && log.relevant.length === 0) {
		reasons.push(`No hook log lines found for commit ${options.sha}`)
	}

	if (status === "blocked") {
		// Keep blocked as the primary status, but still report queue/log signals below.
	} else if (queue.parseError) {
		status = "failure"
		reasons.push(`Retry queue parse error: ${queue.parseError}`)
	} else if (log.hasFailure) {
		status = "failure"
		reasons.push("Recent relevant hook log contains failure/error text")
	} else if (log.hasSyncComplete || log.hasExtractDone) {
		status = "stored"
		reasons.push(log.hasSyncComplete ? "Hook log reports sync complete" : "Hook log reports lesson extraction done")
	} else if (log.hasWorker || log.hasCommitDetected) {
		status = "triggered"
		reasons.push(log.hasWorker ? "Hook worker was spawned" : "Hook detected the commit")
	}

	const matchingQueueItems = options.sha
		? queue.items.filter((item) => JSON.stringify(item).toLowerCase().includes(options.sha.toLowerCase()))
		: []

	if (matchingQueueItems.length > 0) {
		status = status === "failure" ? status : "queued"
		reasons.push(`Retry queue has ${matchingQueueItems.length} item(s) matching the commit`)
	} else if (queue.items.length > 0) {
		reasons.push(`Retry queue has ${queue.items.length} existing item(s) total`)
	}

	return {
		status,
		sha: options.sha || null,
		logPath: LOG_PATH,
		queuePath: QUEUE_PATH,
		localHooksPath,
		globalHooksPath,
		reasons,
		recentLines: (options.sha ? log.relevant : lines).slice(-options.tail),
		queueCount: queue.items.length,
		matchingQueueCount: matchingQueueItems.length,
	}
}

function printHuman(result) {
	console.log("SuperRoo global hook verification")
	console.log(`Status: ${result.status}`)
	if (result.sha) {
		console.log(`Commit: ${result.sha}`)
	}
	console.log(`Log: ${result.logPath}`)
	console.log(`Retry queue: ${result.queuePath}`)

	if (result.reasons.length > 0) {
		console.log("\nSignals:")
		for (const reason of result.reasons) {
			console.log(`- ${reason}`)
		}
	}

	if (result.recentLines.length > 0) {
		console.log("\nRecent relevant hook lines:")
		for (const line of result.recentLines) {
			console.log(line)
		}
	}
}

const options = parseArgs()
const result = analyze(options)

if (options.json) {
	console.log(JSON.stringify(result, null, 2))
} else {
	printHuman(result)
}
