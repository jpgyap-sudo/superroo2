#!/usr/bin/env node
/**
 * Global post-commit hook for SuperRoo Cross-Project Learning Layer
 *
 * Cross-platform Node.js version (works on Windows, macOS, Linux).
 *
 * Installed by: tools/install-global-hook.mjs
 * Installed to: ~/.superroo/git-hooks/post-commit
 *
 * Auto-extracts lessons from ANY git repo and stores them
 * in the Central Brain via superroo-learn.
 *
 * Fallback behavior:
 *   1. Try Central Brain MCP server (primary)
 *   2. If Central Brain is unreachable, store locally in the repo's
 *      memory/lessons-learned.md and memory/lesson-index.jsonl
 *   3. If neither is available, silently skip (no data loss)
 *
 * Auto-registration:
 *   On first commit from an unknown project, the hook auto-registers
 *   the project with Central Brain (or local config as fallback).
 *
 * This is non-blocking — runs in background so git commit stays fast.
 */

import { execSync, spawn } from "child_process"
import { existsSync } from "fs"
import path from "path"
import os from "os"

// ── Configuration ──

const SUPERROO_HOME = path.join(os.homedir(), ".superroo")
const BIN_DIR = path.join(SUPERROO_HOME, "bin")
const CLI_JS = path.join(BIN_DIR, "superroo-learn.mjs")
const CLI_SH = path.join(BIN_DIR, "superroo-learn")

// ── Helpers ──

function findSuperrooLearn() {
	// 1. Check ~/.superroo/bin/superroo-learn.mjs
	if (existsSync(CLI_JS)) {
		return `node "${CLI_JS}"`
	}
	// 2. Check ~/.superroo/bin/superroo-learn (shell wrapper)
	if (existsSync(CLI_SH)) {
		return `"${CLI_SH}"`
	}
	// 3. Check common repo locations
	const repoPaths = [
		path.join(os.homedir(), "superroo", "superroo2"),
		path.join(os.homedir(), "projects", "superroo2"),
		path.join(os.homedir(), "code", "superroo2"),
		"C:\\Users\\User\\superroo\\superroo2",
	]
	for (const dir of repoPaths) {
		const cliPath = path.join(dir, "tools", "superroo-learn.mjs")
		if (existsSync(cliPath)) {
			return `node "${cliPath}"`
		}
	}
	return null
}

function exec(command) {
	try {
		return execSync(command, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
			timeout: 5000,
		}).trim()
	} catch {
		return ""
	}
}

/**
 * Run a command in the background (detached child process).
 * Works on both Windows and Unix.
 */
function runBackground(command) {
	try {
		const child = spawn(process.execPath, [
			"-e",
			`
				const { execSync } = require("child_process");
				try {
					execSync(${JSON.stringify(command)}, {
						encoding: "utf-8",
						stdio: "ignore",
						timeout: 30000,
						windowsHide: true,
					});
				} catch (e) {
					// Silently fail in background
				}
			`,
		], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		})
		child.unref()
	} catch {
		// Background spawn failure is non-critical
	}
}

// ── Main ──

function main() {
	const superrooLearn = findSuperrooLearn()
	if (!superrooLearn) {
		// superroo-learn not found — silently skip
		process.exit(0)
	}

	// Get commit info
	const sha = exec("git rev-parse HEAD")
	const message = exec('git log -1 --pretty=%B')
	const author = exec('git log -1 --pretty=%an')
	const filesRaw = exec("git diff-tree --no-commit-id --name-only -r HEAD")
	const files = filesRaw.replace(/\n/g, ",")

	if (!sha) {
		// Not a git repo or no commits
		process.exit(0)
	}

	// ── Auto-register unknown projects ──
	const remote = exec("git remote -v")
	let projectName = ""
	if (remote) {
		const match = remote.match(/github\.com[/:](.+?)\/(.+?)\.git/)
		if (match) {
			projectName = `${match[1]}-${match[2]}`
		}
	}
	if (!projectName) {
		projectName = path.basename(process.cwd())
	}
	if (projectName) {
		try {
			execSync(`${superrooLearn} register "${projectName}"`, {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
				timeout: 5000,
			})
		} catch {
			// Registration failure is non-critical
		}
	}

	// Check if commit looks lesson-worthy
	const indicators = [
		/fix(e[ds])?:?\s+/i,
		/bug:?:?\s+/i,
		/lesson:?:?\s+/i,
		/learned:?:?\s+/i,
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
		// No lesson indicators — silently skip
		process.exit(0)
	}

	// Run in background — don't slow down git commit
	const escapedMessage = message.replace(/"/g, '\\"')
	const extractCmd = `${superrooLearn} extract-commit "${sha}" "${escapedMessage}" "${author}" "${files}"`
	runBackground(extractCmd)

	// Also run Ollama summarization in background (graceful if Ollama offline)
	// Try to find the ollama-summarize-lesson.mjs script in the repo
	const repoPaths = [
		path.join(os.homedir(), "superroo", "superroo2"),
		path.join(os.homedir(), "projects", "superroo2"),
		path.join(os.homedir(), "code", "superroo2"),
		"C:\\Users\\User\\superroo\\superroo2",
	]
	for (const dir of repoPaths) {
		const ollamaScript = path.join(dir, "scripts", "ollama-summarize-lesson.mjs")
		if (existsSync(ollamaScript)) {
			const ollamaCmd = `node "${ollamaScript}" --quiet --last-only`
			runBackground(ollamaCmd)
			break
		}
	}
}

main()
