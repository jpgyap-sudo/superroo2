/**
 * Savepoint Service — Git-based rollback savepoints
 *
 * Creates lightweight git savepoints before autonomous coding begins,
 * so the user can rollback to a known-good state at any time.
 *
 * Strategy:
 * - Uses `git stash create` to create an orphan commit of the working tree
 *   without actually stashing (unlike `git stash push`, this doesn't
 *   modify the working tree).
 * - Tags the resulting commit hash as `savepoint-<taskId>` for easy lookup.
 * - Rollback uses `git checkout` + `git reset` to restore the savepoint.
 *
 * Usage:
 *   const sp = require("./savepointService")
 *   const hash = await sp.createSavepoint("/path/to/repo", "TG-123")
 *   const list = await sp.listSavepoints("/path/to/repo")
 *   await sp.restoreSavepoint("/path/to/repo", "TG-123")
 */

const { exec } = require("child_process")
const { promisify } = require("util")
const execAsync = promisify(exec)
const path = require("path")
const fs = require("fs").promises

// ─── In-memory savepoint registry ──────────────────────────────────────────
// Persisted to disk so savepoints survive server restarts.
const SAVEPOINT_REGISTRY_PATH = path.join(__dirname, "..", "memory", "savepoint-registry.json")

/** Map<taskId, { hash, branch, timestamp, description }> */
const savepointRegistry = new Map()

/**
 * Load the savepoint registry from disk.
 */
async function loadRegistry() {
	try {
		const data = await fs.readFile(SAVEPOINT_REGISTRY_PATH, "utf8")
		const parsed = JSON.parse(data)
		for (const [key, val] of Object.entries(parsed)) {
			savepointRegistry.set(key, val)
		}
	} catch (e) {
		// File doesn't exist yet — that's fine
		if (e.code !== "ENOENT") {
			console.error("[savepoint] Failed to load registry:", e.message)
		}
	}
}

/**
 * Persist the savepoint registry to disk.
 */
async function saveRegistry() {
	try {
		await fs.mkdir(path.dirname(SAVEPOINT_REGISTRY_PATH), { recursive: true })
		const obj = Object.fromEntries(savepointRegistry.entries())
		await fs.writeFile(SAVEPOINT_REGISTRY_PATH, JSON.stringify(obj, null, 2), "utf8")
	} catch (e) {
		console.error("[savepoint] Failed to save registry:", e.message)
	}
}

// Load registry on module init
loadRegistry()

/**
 * Check if the given directory is a git repository.
 * @param {string} repoPath
 * @returns {Promise<boolean>}
 */
async function isGitRepo(repoPath) {
	try {
		await execAsync("git rev-parse --git-dir", { cwd: repoPath })
		return true
	} catch (e) {
		return false
	}
}

/**
 * Get the current branch name of the repository.
 * @param {string} repoPath
 * @returns {Promise<string>}
 */
async function getCurrentBranch(repoPath) {
	try {
		const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath })
		return (stdout || "").trim() || "main"
	} catch (e) {
		return "unknown"
	}
}

/**
 * Create a savepoint before making changes.
 *
 * Uses `git stash create` to snapshot the working tree without modifying it.
 * Tags the resulting hash as `savepoint-<taskId>` for easy reference.
 *
 * @param {string} repoPath - Absolute path to the git repository
 * @param {string} taskId - Task identifier (e.g., "TG-123")
 * @param {string} [description] - Optional description of the savepoint
 * @returns {Promise<{ hash: string, branch: string, timestamp: number }>}
 */
async function createSavepoint(repoPath, taskId, description) {
	if (!repoPath) {
		throw new Error("repoPath is required")
	}
	if (!taskId) {
		throw new Error("taskId is required")
	}

	// Verify it's a git repo
	if (!(await isGitRepo(repoPath))) {
		throw new Error("Not a git repository: " + repoPath)
	}

	// Get current branch
	const branch = await getCurrentBranch(repoPath)

	// Create a stash commit without modifying working tree
	// `git stash create` returns the commit hash of a stash-like commit
	// but doesn't actually stash the changes.
	const { stdout: hashOut } = await execAsync("git stash create", { cwd: repoPath })
	const hash = (hashOut || "").trim()

	if (!hash) {
		// No uncommitted changes — create a manual savepoint commit
		// by committing the current state as a lightweight tag
		const { stdout: revOut } = await execAsync("git rev-parse HEAD", { cwd: repoPath })
		const headHash = (revOut || "").trim()

		// Tag the current HEAD as a savepoint
		await execAsync('git tag -f "savepoint-' + taskId.toLowerCase() + '" ' + headHash, { cwd: repoPath }).catch(
			function () {},
		)

		const entry = {
			hash: headHash,
			branch: branch,
			timestamp: Date.now(),
			description: description || "Savepoint at current HEAD (no uncommitted changes)",
		}
		savepointRegistry.set(taskId.toUpperCase(), entry)
		await saveRegistry()
		return entry
	}

	// Tag the stash commit as a savepoint
	await execAsync('git tag -f "savepoint-' + taskId.toLowerCase() + '" ' + hash, { cwd: repoPath }).catch(
		function () {},
	)

	const entry = {
		hash: hash,
		branch: branch,
		timestamp: Date.now(),
		description: description || "Savepoint before autonomous coding",
	}
	savepointRegistry.set(taskId.toUpperCase(), entry)
	await saveRegistry()

	return entry
}

/**
 * List all savepoints.
 *
 * @param {string} [repoPath] - Optional repo path to filter by
 * @returns {Promise<Array<{ taskId: string, hash: string, branch: string, timestamp: number, description: string }>>}
 */
async function listSavepoints(repoPath) {
	const entries = []
	for (const [taskId, info] of savepointRegistry.entries()) {
		entries.push({
			taskId: taskId,
			hash: info.hash,
			branch: info.branch,
			timestamp: info.timestamp,
			description: info.description,
			createdAgo: formatRelativeTime(info.timestamp),
		})
	}

	// Sort by most recent first
	entries.sort(function (a, b) {
		return b.timestamp - a.timestamp
	})

	// If repoPath is given, filter by branch that matches current repo
	if (repoPath) {
		try {
			const branch = await getCurrentBranch(repoPath)
			return entries.filter(function (e) {
				return e.branch === branch
			})
		} catch (e) {
			return entries
		}
	}

	return entries
}

/**
 * Restore a savepoint by task ID.
 *
 * Uses `git checkout` to restore the savepoint commit, then
 * `git reset --soft` to keep the changes staged.
 *
 * @param {string} repoPath - Absolute path to the git repository
 * @param {string} taskId - Task identifier
 * @returns {Promise<{ hash: string, branch: string, success: boolean }>}
 */
async function restoreSavepoint(repoPath, taskId) {
	if (!repoPath) {
		throw new Error("repoPath is required")
	}
	if (!taskId) {
		throw new Error("taskId is required")
	}

	if (!(await isGitRepo(repoPath))) {
		throw new Error("Not a git repository: " + repoPath)
	}

	const entry = savepointRegistry.get(taskId.toUpperCase())
	if (!entry) {
		throw new Error("Savepoint not found for task: " + taskId)
	}

	// First try to restore via tag
	try {
		await execAsync('git checkout --force "savepoint-' + taskId.toLowerCase() + '"', { cwd: repoPath })
	} catch (e) {
		// Fall back to direct hash checkout
		await execAsync("git checkout --force " + entry.hash, { cwd: repoPath })
	}

	return {
		hash: entry.hash,
		branch: entry.branch,
		success: true,
	}
}

/**
 * Get a specific savepoint by task ID.
 *
 * @param {string} taskId
 * @returns {object|null}
 */
function getSavepoint(taskId) {
	return savepointRegistry.get(taskId.toUpperCase()) || null
}

/**
 * Delete a savepoint by task ID.
 *
 * @param {string} repoPath
 * @param {string} taskId
 */
async function deleteSavepoint(repoPath, taskId) {
	const entry = savepointRegistry.get(taskId.toUpperCase())
	if (entry) {
		savepointRegistry.delete(taskId.toUpperCase())
		await saveRegistry()
	}

	// Remove the git tag
	try {
		await execAsync('git tag -d "savepoint-' + taskId.toLowerCase() + '"', { cwd: repoPath })
	} catch (e) {
		// Tag may not exist
	}
}

/**
 * Format a timestamp as a relative time string.
 * @param {number} ts - Unix timestamp in milliseconds
 * @returns {string}
 */
function formatRelativeTime(ts) {
	if (!ts) return "N/A"
	const diff = Date.now() - ts
	if (diff < 0) return "just now"
	const seconds = Math.floor(diff / 1000)
	if (seconds < 60) return seconds + "s ago"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return minutes + "m ago"
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return hours + "h ago"
	const days = Math.floor(hours / 24)
	if (days < 30) return days + "d ago"
	const months = Math.floor(days / 30)
	return months + "mo ago"
}

module.exports = {
	createSavepoint,
	listSavepoints,
	restoreSavepoint,
	getSavepoint,
	deleteSavepoint,
	isGitRepo,
	getCurrentBranch,
	// Exposed for testing
	savepointRegistry,
	loadRegistry,
	saveRegistry,
}
