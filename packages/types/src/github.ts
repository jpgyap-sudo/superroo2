/**
 * SuperRoo — GitHub Dashboard Types
 *
 * Shared types for the GitHub Repository Operations Center.
 * These types are used by both the backend (src/super-roo/github/)
 * and the frontend (webview-ui/src/components/github/).
 */

/** Severity levels for AI suggestions and activity events */
export type Severity = "low" | "medium" | "high" | "critical"

/** Status for pipeline stages and health metrics */
export type StageStatus = "success" | "running" | "warning" | "failed" | "pending"

/** Sync status between local and remote */
export type SyncStatus = "synced" | "diverged" | "conflict" | "unknown"

/** Deployment health status */
export type DeployHealth = "healthy" | "degraded" | "failed" | "pending"

/** Working tree file change type */
export type WorkingTreeFileStatus = "modified" | "new" | "deleted" | "staged"

/** Safety mode for autonomous tasks */
export type SafetyMode = "Sandbox" | "Manual Approval" | "Auto Approve"

// ── Core Entities ─────────────────────────────────────────────────────────────

export interface RepoStatus {
	repoName: string
	branch: string
	syncStatus: SyncStatus
	lastPush: string
	lastCommit: {
		message: string
		author: string
		time: string
	}
	deployment: {
		status: DeployHealth
		environment: string
		time: string
	}
	openPRs: number
	pendingReviews: number
	changedFiles: number
	modifiedFiles: number
	stagedFiles: number
	testPassRate: number
	testsPassed: number
	testsFailed: number
}

export interface ActivityEvent {
	id: string
	time: string
	agent: string
	role: string
	title: string
	detail: string
	severity: Severity
}

export interface HealthMetric {
	label: string
	value: string | number
	status: StageStatus
	percent?: number
}

export interface AiSuggestion {
	id: string
	title: string
	severity: Severity
	description: string
	suggestedAction?: string
}

export interface WorkingTreeFile {
	path: string
	status: WorkingTreeFileStatus
	additions: number
	deletions: number
}

export interface PipelineStage {
	name: string
	status: StageStatus
	duration: string
}

export interface AutonomousTask {
	title: string
	assignedAgent: string
	model: string
	progress: number
	queuePosition: string
	estimatedFiles: number
	safetyMode: SafetyMode
}

export interface AiCommit {
	sha: string
	message: string
	author: string
	model: string
	risk: Severity
	status: string
	time: string
}

export interface PullRequest {
	number: number
	title: string
	author: string
	time: string
	status: string
	reviewStatus: string
	additions: number
	deletions: number
}

// ── Dashboard Aggregate ───────────────────────────────────────────────────────

export interface GitHubDashboardData {
	repoStatus: RepoStatus
	activityEvents: ActivityEvent[]
	healthMetrics: HealthMetric[]
	aiSuggestions: AiSuggestion[]
	workingTreeFiles: WorkingTreeFile[]
	pipelineStages: PipelineStage[]
	autonomousTask: AutonomousTask
	aiCommits: AiCommit[]
	pullRequests: PullRequest[]
}
