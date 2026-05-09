/**
 * Super Roo — Centralized Commit & Deploy Log.
 *
 * THE single source of truth for all commits and deployments across all
 * coding agents. Every agent MUST use this module to record commits and
 * deploys so nothing is missed.
 *
 * This log is:
 * - Append-only (no deletions, only status updates)
 * - Agent-aware (records which agent made the change)
 * - Feature-linked (connects commits to product features)
 * - Deploy-tracked (records deploy attempts, health checks, rollbacks)
 * - Dashboard-visible (surfaced in the Working Tree tab)
 *
 * Integration points:
 *   - WorkingTreeAgent: triggers tree refresh on new commits/deploys
 *   - DeployOrchestrator: records deploy attempts and results
 *   - ProductMemoryService: persists as JSON alongside other product memory
 *   - Dashboard: displays the log in the Working Tree tab
 */

import { v4 as uuidv4 } from "uuid"
import fs from "fs/promises"
import path from "path"
import type { EventLog } from "../logging/EventLog"

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommitType = "feature" | "bugfix" | "refactor" | "docs" | "config" | "test" | "deploy" | "other"

export type DeployStatus = "pending" | "building" | "deploying" | "healthy" | "unhealthy" | "rolled_back" | "failed"

export interface CommitRecord {
	id: string
	commitSha: string
	agent: string
	type: CommitType
	title: string
	description: string
	filesChanged: string[]
	featuresAffected: string[]
	bugsFixed: string[]
	timestamp: string
	/** Link to the deploy that included this commit, if any */
	deployId?: string
}

export interface DeployRecord {
	id: string
	version: string
	commitSha: string
	agent: string
	status: DeployStatus
	environment: string
	commitsIncluded: string[] // commit SHAs
	featuresDeployed: string[] // feature IDs
	healthCheckPassed: boolean | null
	healthCheckLatencyMs: number | null
	rollbackFrom?: string // version rolled back from
	error?: string
	/** Human-readable reason for failure — used when marking stuck deploys as failed */
	failureReason?: string
	startedAt: string
	completedAt: string | null
}

export interface CommitDeployLogFile {
	commits: CommitRecord[]
	deploys: DeployRecord[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_FILE = "commit-deploy-log.json"

const DEFAULT_LOG: CommitDeployLogFile = {
	commits: [],
	deploys: [],
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CommitDeployLog {
	private logDir: string
	private logPath: string

	constructor(
		private readonly events: EventLog,
		memoryDir?: string,
	) {
		this.logDir = memoryDir || path.resolve(process.cwd(), "server/src/memory")
		this.logPath = path.join(this.logDir, LOG_FILE)
	}

	setMemoryDir(dir: string): void {
		this.logDir = dir
		this.logPath = path.join(this.logDir, LOG_FILE)
	}

	async initialize(): Promise<void> {
		await fs.mkdir(this.logDir, { recursive: true })
		try {
			await fs.access(this.logPath)
		} catch {
			await this.writeLog(DEFAULT_LOG)
		}
		this.events.info("commit_deploy_log.initialized", `Commit & Deploy Log initialized at ${this.logPath}`)
	}

	// ── Commits ───────────────────────────────────────────────────────────

	async recordCommit(input: {
		commitSha: string
		agent: string
		type: CommitType
		title: string
		description?: string
		filesChanged?: string[]
		featuresAffected?: string[]
		bugsFixed?: string[]
	}): Promise<CommitRecord> {
		const log = await this.readLog()
		const commit: CommitRecord = {
			id: `commit_${uuidv4()}`,
			commitSha: input.commitSha,
			agent: input.agent,
			type: input.type,
			title: input.title,
			description: input.description || "",
			filesChanged: input.filesChanged || [],
			featuresAffected: input.featuresAffected || [],
			bugsFixed: input.bugsFixed || [],
			timestamp: new Date().toISOString(),
		}
		log.commits.unshift(commit)
		await this.writeLog(log)

		this.events.info("commit_deploy_log.commit_recorded", `Commit recorded: ${input.title} (${input.agent})`, {
			data: {
				commitId: commit.id,
				commitSha: input.commitSha,
				agent: input.agent,
				type: input.type,
			} as unknown as Record<string, unknown>,
		})

		return commit
	}

	async getCommits(filter?: {
		agent?: string
		type?: CommitType
		featureId?: string
		limit?: number
	}): Promise<CommitRecord[]> {
		const log = await this.readLog()
		let commits = log.commits

		if (filter?.agent) {
			commits = commits.filter((c) => c.agent === filter.agent)
		}
		if (filter?.type) {
			commits = commits.filter((c) => c.type === filter.type)
		}
		if (filter?.featureId) {
			commits = commits.filter((c) => c.featuresAffected.includes(filter.featureId!))
		}
		if (filter?.limit) {
			commits = commits.slice(0, filter.limit)
		}

		return commits
	}

	// ── Deploys ───────────────────────────────────────────────────────────

	async recordDeploy(input: {
		version: string
		commitSha: string
		agent: string
		environment?: string
		commitsIncluded?: string[]
		featuresDeployed?: string[]
	}): Promise<DeployRecord> {
		const log = await this.readLog()
		const deploy: DeployRecord = {
			id: `deploy_${uuidv4()}`,
			version: input.version,
			commitSha: input.commitSha,
			agent: input.agent,
			status: "pending",
			environment: input.environment || "production",
			commitsIncluded: input.commitsIncluded || [],
			featuresDeployed: input.featuresDeployed || [],
			healthCheckPassed: null,
			healthCheckLatencyMs: null,
			startedAt: new Date().toISOString(),
			completedAt: null,
		}
		log.deploys.unshift(deploy)
		await this.writeLog(log)

		this.events.info("commit_deploy_log.deploy_started", `Deploy started: ${input.version} (${input.agent})`, {
			data: {
				deployId: deploy.id,
				version: input.version,
				agent: input.agent,
			} as unknown as Record<string, unknown>,
		})

		return deploy
	}

	async updateDeployStatus(
		deployId: string,
		update: {
			status: DeployStatus
			healthCheckPassed?: boolean | null
			healthCheckLatencyMs?: number | null
			error?: string
			rollbackFrom?: string
			/** Human-readable reason for failure — used when marking stuck deploys as failed */
			failureReason?: string
		},
	): Promise<DeployRecord> {
		const log = await this.readLog()
		const deploy = log.deploys.find((d) => d.id === deployId)
		if (!deploy) {
			throw new Error(`Deploy not found: ${deployId}`)
		}

		deploy.status = update.status
		if (update.healthCheckPassed !== undefined) deploy.healthCheckPassed = update.healthCheckPassed
		if (update.healthCheckLatencyMs !== undefined) deploy.healthCheckLatencyMs = update.healthCheckLatencyMs
		if (update.error) deploy.error = update.error
		if (update.rollbackFrom) deploy.rollbackFrom = update.rollbackFrom
		if (update.failureReason) deploy.failureReason = update.failureReason

		if (["healthy", "unhealthy", "rolled_back", "failed"].includes(update.status)) {
			deploy.completedAt = new Date().toISOString()
		}

		await this.writeLog(log)

		this.events.info("commit_deploy_log.deploy_updated", `Deploy ${deployId}: ${update.status}`, {
			data: {
				deployId,
				status: update.status,
			} as unknown as Record<string, unknown>,
		})

		return deploy
	}

	async getDeploys(filter?: { status?: DeployStatus; agent?: string; limit?: number }): Promise<DeployRecord[]> {
		const log = await this.readLog()
		let deploys = log.deploys

		if (filter?.status) {
			deploys = deploys.filter((d) => d.status === filter.status)
		}
		if (filter?.agent) {
			deploys = deploys.filter((d) => d.agent === filter.agent)
		}
		if (filter?.limit) {
			deploys = deploys.slice(0, filter.limit)
		}

		return deploys
	}

	async getLatestDeploy(): Promise<DeployRecord | null> {
		const log = await this.readLog()
		return log.deploys[0] || null
	}

	// ── Stats ─────────────────────────────────────────────────────────────

	async getStats(): Promise<{
		totalCommits: number
		totalDeploys: number
		successfulDeploys: number
		failedDeploys: number
		rolledBackDeploys: number
		commitsByAgent: Record<string, number>
		commitsByType: Record<string, number>
		lastCommit: CommitRecord | null
		lastDeploy: DeployRecord | null
	}> {
		const log = await this.readLog()

		const commitsByAgent: Record<string, number> = {}
		const commitsByType: Record<string, number> = {}

		for (const c of log.commits) {
			commitsByAgent[c.agent] = (commitsByAgent[c.agent] || 0) + 1
			commitsByType[c.type] = (commitsByType[c.type] || 0) + 1
		}

		return {
			totalCommits: log.commits.length,
			totalDeploys: log.deploys.length,
			successfulDeploys: log.deploys.filter((d) => d.status === "healthy").length,
			failedDeploys: log.deploys.filter((d) => d.status === "failed" || d.status === "unhealthy").length,
			rolledBackDeploys: log.deploys.filter((d) => d.status === "rolled_back").length,
			commitsByAgent,
			commitsByType,
			lastCommit: log.commits[0] || null,
			lastDeploy: log.deploys[0] || null,
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────

	private async readLog(): Promise<CommitDeployLogFile> {
		try {
			const raw = await fs.readFile(this.logPath, "utf-8")
			return JSON.parse(raw) as CommitDeployLogFile
		} catch (err: unknown) {
			if (isNodeError(err) && err.code === "ENOENT") {
				await this.writeLog(DEFAULT_LOG)
				return JSON.parse(JSON.stringify(DEFAULT_LOG))
			}
			throw err
		}
	}

	private async writeLog(data: CommitDeployLogFile): Promise<void> {
		await fs.writeFile(this.logPath, JSON.stringify(data, null, 2), "utf-8")
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err
}
