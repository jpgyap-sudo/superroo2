/**
 * RollbackManager — Git Snapshot & Rollback System
 *
 * Provides safe snapshot/rollback capabilities for the Super Debug Team.
 * Before each attempt, a git snapshot is created. If the attempt fails,
 * the codebase is rolled back to the snapshot state.
 *
 * Inspired by the reference swarm architecture's rollback.ts:
 *   - createSnapshot: git add -A && git commit -m "snapshot-{label}" && git rev-parse HEAD
 *   - rollbackSnapshot: git reset --hard {rev} && git clean -fd
 *
 * Supports multiple rollback strategies:
 *   - "hard": Full git reset --hard + clean (default, destructive)
 *   - "soft": git reset --soft (keeps changes staged)
 *   - "stash": git stash (preserves changes for later review)
 *   - "branch": Creates a backup branch before rollback
 */

import { spawn } from "child_process"
import { EventEmitter } from "events"
import * as path from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SnapshotType = "auto" | "manual" | "pre_attempt" | "pre_deploy" | "milestone"

export type RollbackStrategy = "hard" | "soft" | "stash" | "branch"

export interface Snapshot {
	id: string
	rev: string
	branch: string
	timestamp: number
	label: string
	type: SnapshotType
	metadata: Record<string, unknown>
	fileCount?: number
}

export interface RollbackConfig {
	/** Default rollback strategy. Default: "hard" */
	defaultStrategy: RollbackStrategy
	/** Whether to create a backup branch before rollback. Default: true */
	createBackupBranch: boolean
	/** Backup branch prefix. Default: "debug-rollback/" */
	backupBranchPrefix: string
	/** Max snapshots to keep per repo. Default: 50 */
	maxSnapshotsPerRepo: number
	/** Whether to verify rollback by checking git status. Default: true */
	verifyRollback: boolean
	/** Auto-stash uncommitted changes before snapshot. Default: true */
	autoStash: boolean
}

export interface RollbackResult {
	success: boolean
	snapshotRev: string
	strategy: RollbackStrategy
	backupBranch?: string
	error?: string
	durationMs: number
	filesRestored?: number
}

export interface SnapshotOptions {
	label: string
	type?: SnapshotType
	metadata?: Record<string, unknown>
}

export interface CommitOptions {
	message: string
	author: string
	coAuthors?: string[]
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface RollbackManagerEvents {
	"snapshot:created": (snapshot: Snapshot) => void
	"snapshot:failed": (repoPath: string, error: Error) => void
	"rollback:started": (repoPath: string, rev: string, strategy: RollbackStrategy) => void
	"rollback:completed": (result: RollbackResult) => void
	"rollback:failed": (repoPath: string, rev: string, error: Error) => void
	"commit:created": (repoPath: string, message: string) => void
	"backup:created": (branch: string) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class RollbackManager {
	private config: RollbackConfig
	private emitter: EventEmitter
	private snapshots: Map<string, Snapshot[]> = new Map() // repoPath → snapshots

	constructor(config?: Partial<RollbackConfig>) {
		this.config = {
			defaultStrategy: config?.defaultStrategy ?? "hard",
			createBackupBranch: config?.createBackupBranch ?? true,
			backupBranchPrefix: config?.backupBranchPrefix ?? "debug-rollback/",
			maxSnapshotsPerRepo: config?.maxSnapshotsPerRepo ?? 50,
			verifyRollback: config?.verifyRollback ?? true,
			autoStash: config?.autoStash ?? true,
		}
		this.emitter = new EventEmitter()
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof RollbackManagerEvents>(
		event: K,
		listener: RollbackManagerEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof RollbackManagerEvents>(
		event: K,
		listener: RollbackManagerEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof RollbackManagerEvents>(
		event: K,
		...args: Parameters<RollbackManagerEvents[K]>
	): void {
		this.emitter.emit(event, ...(args as unknown[]))
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Create a git snapshot of the current state.
	 * Stashes uncommitted changes first (if configured), then commits everything.
	 */
	async createSnapshot(
		repoPath: string,
		options: SnapshotOptions,
	): Promise<Snapshot> {
		const absPath = path.resolve(repoPath)
		const startTime = Date.now()

		try {
			// Auto-stash uncommitted changes if configured
			if (this.config.autoStash) {
				await this.execGit(absPath, "stash", ["push", "-m", `auto-stash-${options.label}`])
			}

			// Stage all changes
			await this.execGit(absPath, "add", ["-A"])

			// Count files changed
			const statusResult = await this.execGit(absPath, "status", ["--porcelain"])
			const fileCount = statusResult.stdout
				? statusResult.stdout.split("\n").filter((l) => l.trim().length > 0).length
				: 0

			// Commit snapshot
			const commitMsg = `snapshot: ${options.label} [debug-team]`
			await this.execGit(absPath, "commit", [
				"--allow-empty",
				"-m", commitMsg,
				"--author=super-roo-debug-team <debug-team@superroo.ai>",
			])

			// Get the commit hash
			const revResult = await this.execGit(absPath, "rev-parse", ["HEAD"])
			const rev = revResult.stdout?.trim() ?? ""

			// Get current branch
			const branchResult = await this.execGit(absPath, "rev-parse", ["--abbrev-ref", "HEAD"])
			const branch = branchResult.stdout?.trim() ?? "unknown"

			const snapshot: Snapshot = {
				id: `snap-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
				rev,
				branch,
				timestamp: Date.now(),
				label: options.label,
				type: options.type ?? "auto",
				metadata: options.metadata ?? {},
				fileCount,
			}

			// Store snapshot
			const repoSnapshots = this.snapshots.get(absPath) || []
			repoSnapshots.push(snapshot)

			// Enforce max snapshots limit
			while (repoSnapshots.length > this.config.maxSnapshotsPerRepo) {
				repoSnapshots.shift()
			}
			this.snapshots.set(absPath, repoSnapshots)

			this.emit("snapshot:created", snapshot)
			return snapshot
		} catch (error) {
			this.emit(
				"snapshot:failed",
				absPath,
				error instanceof Error ? error : new Error(String(error)),
			)
			throw error
		}
	}

	/**
	 * Rollback to a specific snapshot revision.
	 * Supports multiple strategies: hard, soft, stash, branch.
	 */
	async rollback(
		repoPath: string,
		rev: string,
		strategy?: RollbackStrategy,
	): Promise<RollbackResult> {
		const absPath = path.resolve(repoPath)
		const startTime = Date.now()
		const actualStrategy = strategy ?? this.config.defaultStrategy

		this.emit("rollback:started", absPath, rev, actualStrategy)

		try {
			let backupBranch: string | undefined

			// Create backup branch before rollback (if configured)
			if (this.config.createBackupBranch && actualStrategy !== "branch") {
				backupBranch = `${this.config.backupBranchPrefix}${Date.now()}`
				await this.execGit(absPath, "branch", [backupBranch])
				this.emit("backup:created", backupBranch)
			}

			switch (actualStrategy) {
				case "hard":
					await this.rollbackHard(absPath, rev)
					break
				case "soft":
					await this.rollbackSoft(absPath, rev)
					break
				case "stash":
					await this.rollbackStash(absPath, rev)
					break
				case "branch":
					backupBranch = await this.rollbackBranch(absPath, rev)
					break
			}

			// Verify rollback
			let filesRestored: number | undefined
			if (this.config.verifyRollback) {
				const statusResult = await this.execGit(absPath, "status", ["--porcelain"])
				filesRestored = statusResult.stdout
					? statusResult.stdout.split("\n").filter((l) => l.trim().length > 0).length
					: 0
			}

			const result: RollbackResult = {
				success: true,
				snapshotRev: rev,
				strategy: actualStrategy,
				backupBranch,
				durationMs: Date.now() - startTime,
				filesRestored,
			}

			this.emit("rollback:completed", result)
			return result
		} catch (error) {
			const result: RollbackResult = {
				success: false,
				snapshotRev: rev,
				strategy: actualStrategy,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - startTime,
			}

			this.emit(
				"rollback:failed",
				absPath,
				rev,
				error instanceof Error ? error : new Error(String(error)),
			)
			return result
		}
	}

	/**
	 * Commit successful changes (not a rollback, but a final commit).
	 */
	async commitSuccess(
		repoPath: string,
		options: CommitOptions,
	): Promise<string> {
		const absPath = path.resolve(repoPath)

		try {
			// Stage all changes
			await this.execGit(absPath, "add", ["-A"])

			// Check if there's anything to commit
			const statusResult = await this.execGit(absPath, "status", ["--porcelain"])
			if (!statusResult.stdout?.trim()) {
				return "nothing-to-commit"
			}

			// Build commit message with co-authors
			let message = options.message
			if (options.coAuthors && options.coAuthors.length > 0) {
				message += "\n\n"
				for (const coAuthor of options.coAuthors) {
					message += `Co-authored-by: ${coAuthor}\n`
				}
			}

			await this.execGit(absPath, "commit", [
				"-m", message,
				`--author=${options.author} <${options.author}@superroo.ai>`,
			])

			const revResult = await this.execGit(absPath, "rev-parse", ["HEAD"])
			const rev = revResult.stdout?.trim() ?? ""

			this.emit("commit:created", absPath, options.message)
			return rev
		} catch (error) {
			throw error
		}
	}

	/**
	 * List all snapshots for a repo.
	 */
	listSnapshots(repoPath: string): Snapshot[] {
		const absPath = path.resolve(repoPath)
		return this.snapshots.get(absPath) || []
	}

	/**
	 * Get the latest snapshot for a repo.
	 */
	getLatestSnapshot(repoPath: string): Snapshot | undefined {
		const snapshots = this.listSnapshots(repoPath)
		return snapshots[snapshots.length - 1]
	}

	/**
	 * Clear snapshot history for a repo.
	 */
	clearSnapshots(repoPath: string): void {
		const absPath = path.resolve(repoPath)
		this.snapshots.delete(absPath)
	}

	/**
	 * Check if git is available and the repo is valid.
	 */
	async validateRepo(repoPath: string): Promise<boolean> {
		const absPath = path.resolve(repoPath)
		try {
			const result = await this.execGit(absPath, "rev-parse", ["--git-dir"])
			return result.exitCode === 0
		} catch {
			return false
		}
	}

	// ── Private: Rollback Strategies ────────────────────────────────────────

	/**
	 * Hard rollback: git reset --hard + git clean -fd
	 * Completely resets the working directory to the snapshot state.
	 */
	private async rollbackHard(absPath: string, rev: string): Promise<void> {
		await this.execGit(absPath, "reset", ["--hard", rev])
		await this.execGit(absPath, "clean", ["-fd"])
	}

	/**
	 * Soft rollback: git reset --soft
	 * Moves HEAD back but keeps changes staged.
	 */
	private async rollbackSoft(absPath: string, rev: string): Promise<void> {
		await this.execGit(absPath, "reset", ["--soft", rev])
	}

	/**
	 * Stash rollback: git stash + git reset --hard
	 * Stashes current changes before hard resetting.
	 */
	private async rollbackStash(absPath: string, rev: string): Promise<void> {
		await this.execGit(absPath, "stash", [
			"push",
			"-m",
			`rollback-stash-${Date.now()}`,
		])
		await this.execGit(absPath, "reset", ["--hard", rev])
	}

	/**
	 * Branch rollback: Creates a branch at current state, then hard resets.
	 */
	private async rollbackBranch(absPath: string, rev: string): Promise<string> {
		const branchName = `${this.config.backupBranchPrefix}${Date.now()}`
		await this.execGit(absPath, "branch", [branchName])
		await this.execGit(absPath, "reset", ["--hard", rev])
		await this.execGit(absPath, "clean", ["-fd"])
		return branchName
	}

	// ── Private: Git Execution ──────────────────────────────────────────────

	private execGit(
		cwd: string,
		command: string,
		args: string[],
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const proc = spawn("git", [command, ...args], {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			})

			let stdout = ""
			let stderr = ""

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString()
			})

			proc.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString()
			})

			proc.on("close", (exitCode) => {
				if (exitCode === 0) {
					resolve({ exitCode, stdout, stderr })
				} else {
					reject(
						new Error(
							`git ${command} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
						),
					)
				}
			})

			proc.on("error", (err) => {
				reject(new Error(`git ${command} spawn error: ${err.message}`))
			})
		})
	}
}
