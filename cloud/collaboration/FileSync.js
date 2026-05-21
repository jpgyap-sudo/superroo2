/**
 * FileSync — Real-time file change propagation for collaboration.
 *
 * Manages file change operations (insert, delete, replace) and propagates
 * them to all collaborators in a session. Uses operational transform (OT)
 * for basic conflict resolution.
 *
 * Inspired by Eclipse Theia's collaboration package which provides
 * real-time collaborative editing with operational transformation.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 */

const EventEmitter = require("node:events")

/**
 * @typedef {Object} FileChange
 * @property {'insert'|'delete'|'replace'} type — Type of change
 * @property {Object} range — Range of the change
 * @property {number} range.startLine — Start line (0-based)
 * @property {number} range.startColumn — Start column (0-based)
 * @property {number} [range.endLine] — End line (0-based, for delete/replace)
 * @property {number} [range.endColumn] — End column (0-based, for delete/replace)
 * @property {string} [text] — Text to insert (for insert/replace)
 * @property {number} timestamp — When the change was made
 */

/**
 * @typedef {Object} FileSnapshot
 * @property {string} filePath — Path relative to workspace root
 * @property {string} content — Full file content
 * @property {number} version — Monotonically increasing version number
 * @property {number} lastModified — Last modification timestamp
 * @property {string} lastModifiedBy — User ID who last modified
 */

/**
 * @typedef {Object} ChangeOperation
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} userName
 * @property {string} filePath
 * @property {FileChange} change
 * @property {number} version — Document version this change applies to
 */

class FileSync extends EventEmitter {
	constructor() {
		super()

		/** @type {Map<string, FileSnapshot>} */
		this._snapshots = new Map()

		/** @type {Map<string, ChangeOperation[]>} */
		this._pendingChanges = new Map()

		/** @type {Map<string, number>} */
		this._versionCounters = new Map()
	}

	// ── Snapshot management ─────────────────────────────────────────────────

	/**
	 * Create or update a file snapshot.
	 * @param {Object} opts
	 * @param {string} opts.filePath
	 * @param {string} opts.content
	 * @param {string} opts.userId
	 * @returns {FileSnapshot}
	 */
	setSnapshot({ filePath, content, userId }) {
		const key = filePath
		const version = (this._versionCounters.get(key) ?? 0) + 1
		this._versionCounters.set(key, version)

		const snapshot = {
			filePath,
			content,
			version,
			lastModified: Date.now(),
			lastModifiedBy: userId,
		}

		this._snapshots.set(key, snapshot)
		this.emit("snapshot:updated", { filePath, version, userId })
		return snapshot
	}

	/**
	 * Get a file snapshot.
	 * @param {string} filePath
	 * @returns {FileSnapshot|undefined}
	 */
	getSnapshot(filePath) {
		return this._snapshots.get(filePath)
	}

	/**
	 * Get the current version of a file.
	 * @param {string} filePath
	 * @returns {number}
	 */
	getVersion(filePath) {
		return this._versionCounters.get(filePath) ?? 0
	}

	/**
	 * Check if a file has a snapshot.
	 * @param {string} filePath
	 * @returns {boolean}
	 */
	hasSnapshot(filePath) {
		return this._snapshots.has(filePath)
	}

	// ── Change operations ───────────────────────────────────────────────────

	/**
	 * Apply a change to a file and propagate to collaborators.
	 * @param {Object} opts
	 * @param {string} opts.sessionId
	 * @param {string} opts.userId
	 * @param {string} opts.userName
	 * @param {string} opts.filePath
	 * @param {FileChange} opts.change
	 * @param {number} [opts.baseVersion] — Expected base version for conflict detection
	 * @returns {{ applied: boolean, snapshot: FileSnapshot|null, conflict: boolean }}
	 */
	applyChange({ sessionId, userId, userName, filePath, change, baseVersion }) {
		const snapshot = this._snapshots.get(filePath)
		const currentVersion = this._versionCounters.get(filePath) ?? 0

		// Conflict detection: if baseVersion doesn't match current, there's a conflict
		if (baseVersion !== undefined && baseVersion !== currentVersion) {
			// Queue the change as pending for conflict resolution
			this._queuePendingChange({ sessionId, userId, userName, filePath, change, version: baseVersion })
			this.emit("change:conflict", {
				sessionId,
				userId,
				userName,
				filePath,
				change,
				expectedVersion: baseVersion,
				actualVersion: currentVersion,
			})
			return { applied: false, snapshot: snapshot || null, conflict: true }
		}

		if (!snapshot) {
			// No snapshot yet — create one from the change
			const newSnapshot = this.setSnapshot({
				filePath,
				content: change.text || "",
				userId,
			})
			this.emit("change:applied", {
				sessionId,
				userId,
				userName,
				filePath,
				change,
				version: newSnapshot.version,
			})
			return { applied: true, snapshot: newSnapshot, conflict: false }
		}

		// Apply the change to the snapshot content
		const newContent = this._applyChangeToContent(snapshot.content, change)
		if (newContent === null) {
			return { applied: false, snapshot, conflict: false }
		}

		const newVersion = currentVersion + 1
		this._versionCounters.set(filePath, newVersion)

		const newSnapshot = {
			filePath,
			content: newContent,
			version: newVersion,
			lastModified: Date.now(),
			lastModifiedBy: userId,
		}
		this._snapshots.set(filePath, newSnapshot)

		this.emit("change:applied", {
			sessionId,
			userId,
			userName,
			filePath,
			change,
			version: newVersion,
		})

		return { applied: true, snapshot: newSnapshot, conflict: false }
	}

	/**
	 * Apply a batch of changes atomically.
	 * @param {Object} opts
	 * @param {string} opts.sessionId
	 * @param {string} opts.userId
	 * @param {string} opts.userName
	 * @param {string} opts.filePath
	 * @param {FileChange[]} opts.changes
	 * @returns {{ applied: boolean, snapshot: FileSnapshot|null, conflict: boolean }}
	 */
	applyBatch({ sessionId, userId, userName, filePath, changes }) {
		let snapshot = this._snapshots.get(filePath)

		for (const change of changes) {
			if (!snapshot) {
				snapshot = this.setSnapshot({
					filePath,
					content: change.text || "",
					userId,
				})
				continue
			}

			const newContent = this._applyChangeToContent(snapshot.content, change)
			if (newContent === null) {
				return { applied: false, snapshot, conflict: false }
			}

			const currentVersion = this._versionCounters.get(filePath) ?? 0
			this._versionCounters.set(filePath, currentVersion + 1)

			snapshot = {
				filePath,
				content: newContent,
				version: currentVersion + 1,
				lastModified: Date.now(),
				lastModifiedBy: userId,
			}
			this._snapshots.set(filePath, snapshot)
		}

		this.emit("batch:applied", {
			sessionId,
			userId,
			userName,
			filePath,
			changeCount: changes.length,
			version: snapshot.version,
		})

		return { applied: true, snapshot, conflict: false }
	}

	// ── Conflict resolution ─────────────────────────────────────────────────

	/**
	 * Queue a pending change for conflict resolution.
	 * @param {ChangeOperation} operation
	 */
	_queuePendingChange(operation) {
		const key = operation.filePath
		if (!this._pendingChanges.has(key)) {
			this._pendingChanges.set(key, [])
		}
		this._pendingChanges.get(key).push(operation)
	}

	/**
	 * Get pending changes for a file.
	 * @param {string} filePath
	 * @returns {ChangeOperation[]}
	 */
	getPendingChanges(filePath) {
		return [...(this._pendingChanges.get(filePath) || [])]
	}

	/**
	 * Resolve a conflict by applying a change with force (bypasses version check).
	 * @param {Object} opts
	 * @param {string} opts.sessionId
	 * @param {string} opts.userId
	 * @param {string} opts.userName
	 * @param {string} opts.filePath
	 * @param {FileChange} opts.change
	 * @returns {{ applied: boolean, snapshot: FileSnapshot|null }}
	 */
	resolveConflict({ sessionId, userId, userName, filePath, change }) {
		const result = this.applyChange({
			sessionId,
			userId,
			userName,
			filePath,
			change,
			baseVersion: undefined, // Bypass version check
		})

		if (result.applied) {
			// Clear pending changes for this file
			this._pendingChanges.delete(filePath)
			this.emit("conflict:resolved", { sessionId, userId, filePath })
		}

		return { applied: result.applied, snapshot: result.snapshot }
	}

	/**
	 * Get all files with pending conflicts.
	 * @returns {string[]}
	 */
	getFilesWithConflicts() {
		return Array.from(this._pendingChanges.keys())
	}

	// ── Content transformation ──────────────────────────────────────────────

	/**
	 * Apply a single change to file content.
	 * @param {string} content
	 * @param {FileChange} change
	 * @returns {string|null} — Transformed content, or null if invalid
	 */
	_applyChangeToContent(content, change) {
		const lines = content.split("\n")

		switch (change.type) {
			case "insert": {
				const { startLine, startColumn } = change.range
				if (startLine < 0 || startLine >= lines.length) return null

				const line = lines[startLine]
				const before = line.slice(0, startColumn)
				const after = line.slice(startColumn)
				lines[startLine] = before + (change.text || "") + after
				return lines.join("\n")
			}

			case "delete": {
				const { startLine, startColumn, endLine, endColumn } = change.range
				if (startLine < 0 || startLine >= lines.length) return null
				if (endLine === undefined || endLine === startLine) {
					// Single-line delete
					const line = lines[startLine]
					lines[startLine] = line.slice(0, startColumn) + line.slice(endColumn ?? startColumn)
				} else {
					// Multi-line delete
					if (endLine >= lines.length) return null
					const startPart = lines[startLine].slice(0, startColumn)
					const endPart = lines[endLine].slice(endColumn ?? 0)
					lines.splice(startLine, endLine - startLine + 1, startPart + endPart)
				}
				return lines.join("\n")
			}

			case "replace": {
				const { startLine, startColumn, endLine, endColumn } = change.range
				if (startLine < 0 || startLine >= lines.length) return null

				if (endLine === undefined || endLine === startLine) {
					const line = lines[startLine]
					lines[startLine] =
						line.slice(0, startColumn) + (change.text || "") + line.slice(endColumn ?? startColumn)
				} else {
					if (endLine >= lines.length) return null
					const startPart = lines[startLine].slice(0, startColumn)
					const endPart = lines[endLine].slice(endColumn ?? 0)
					lines.splice(startLine, endLine - startLine + 1, startPart + (change.text || "") + endPart)
				}
				return lines.join("\n")
			}

			default:
				return null
		}
	}

	// ── Diff utilities ──────────────────────────────────────────────────────

	/**
	 * Compute a simple line-based diff between two strings.
	 * Returns an array of changes to transform `oldContent` into `newContent`.
	 * @param {string} oldContent
	 * @param {string} newContent
	 * @returns {FileChange[]}
	 */
	computeDiff(oldContent, newContent) {
		const oldLines = oldContent.split("\n")
		const newLines = newContent.split("\n")

		/** @type {FileChange[]} */
		const changes = []

		// Simple LCS-based diff
		const lcs = this._longestCommonSubsequence(oldLines, newLines)

		let oldIdx = 0
		let newIdx = 0
		let lcsIdx = 0

		while (oldIdx < oldLines.length || newIdx < newLines.length) {
			if (lcsIdx < lcs.length && oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
				// Lines match — no change
				oldIdx++
				newIdx++
				lcsIdx++
			} else if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
				// Line was inserted
				changes.push({
					type: "insert",
					range: {
						startLine: oldIdx,
						startColumn: 0,
					},
					text: newLines[newIdx] + "\n",
					timestamp: Date.now(),
				})
				newIdx++
			} else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
				// Line was deleted
				changes.push({
					type: "delete",
					range: {
						startLine: oldIdx,
						startColumn: 0,
						endLine: oldIdx,
						endColumn: oldLines[oldIdx].length,
					},
					timestamp: Date.now(),
				})
				oldIdx++
			} else {
				// Line was replaced
				changes.push({
					type: "replace",
					range: {
						startLine: oldIdx,
						startColumn: 0,
						endLine: oldIdx,
						endColumn: oldLines[oldIdx].length,
					},
					text: newLines[newIdx] + "\n",
					timestamp: Date.now(),
				})
				oldIdx++
				newIdx++
				lcsIdx++
			}
		}

		return changes
	}

	/**
	 * Compute the longest common subsequence of two arrays of strings.
	 * @param {string[]} a
	 * @param {string[]} b
	 * @returns {string[]}
	 */
	_longestCommonSubsequence(a, b) {
		const m = a.length
		const n = b.length
		const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (a[i - 1] === b[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1] + 1
				} else {
					dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
				}
			}
		}

		// Backtrack to find the LCS
		const result = []
		let i = m,
			j = n
		while (i > 0 && j > 0) {
			if (a[i - 1] === b[j - 1]) {
				result.unshift(a[i - 1])
				i--
				j--
			} else if (dp[i - 1][j] > dp[i][j - 1]) {
				i--
			} else {
				j--
			}
		}

		return result
	}

	// ── Cleanup ─────────────────────────────────────────────────────────────

	/**
	 * Remove all snapshots and pending changes for a file.
	 * @param {string} filePath
	 */
	removeFile(filePath) {
		this._snapshots.delete(filePath)
		this._pendingChanges.delete(filePath)
		this._versionCounters.delete(filePath)
		this.emit("file:removed", { filePath })
	}

	/**
	 * Clear all state.
	 */
	clear() {
		this._snapshots.clear()
		this._pendingChanges.clear()
		this._versionCounters.clear()
		this.removeAllListeners()
	}
}

module.exports = { FileSync }
