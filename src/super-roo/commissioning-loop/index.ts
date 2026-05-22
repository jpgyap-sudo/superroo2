/**
 * Super Roo — Commissioning Loop
 *
 * TypeScript source for the 14-phase full-stack commissioning engine.
 * The JS runtime implementation lives at cloud/orchestrator/modules/CommissioningLoop.js.
 * This file provides TypeScript types and a factory function.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CommissioningLoopOptions {
	orchestrator?: unknown
	workspaceRoot?: string
	containerFirst?: boolean
	phaseTimeoutMs?: number
	commissioningDir?: string
}

export interface CommissioningPhase {
	id: number
	name: string
	description: string
}

export interface PhaseResult {
	phase: number
	name: string
	status: "completed" | "failed" | "skipped" | "running"
	details?: string
	duration?: number
	error?: string
	timestamp: number
}

export interface CommissioningStatus {
	jobId: string | null
	status: string
	running: boolean
	currentPhase: number
	currentPhaseName: string
	totalPhases: number
	progress: number
	elapsedMs: number
	remainingMs: number
	elapsedFormatted: string
	remainingFormatted: string
	phaseResults: PhaseResult[]
	error: string | null
	startedAt: number | null
}

export interface StartResult {
	success: boolean
	jobId?: string
	status?: string
	error?: string
}

export interface StopResult {
	success: boolean
	jobId?: string
	status?: string
	completedPhases?: number
	phaseResults?: PhaseResult[]
	error?: string
}

export interface CommissioningReport {
	jobId: string
	status: string
	overall: "pass" | "fail" | "partial"
	phaseResults: PhaseResult[]
	summary: string
	recommendations: string[]
	startedAt: number
	completedAt: number
	durationMs: number
}

export interface SafetyRule {
	pattern: RegExp
	reason: string
}

export interface SafetyCheckResult {
	allowed: boolean
	reason?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

export const COMMISSIONING_PHASES: CommissioningPhase[] = [
	{
		id: 1,
		name: "Repository & Architecture Inspection",
		description: "Inspect repo structure, architecture docs, and configuration",
	},
	{
		id: 2,
		name: "Dependency & Environment Validation",
		description: "Validate all dependencies and environment variables",
	},
	{
		id: 3,
		name: "Application Boot Verification (VPS)",
		description: "Verify all PM2 services are online and healthy",
	},
	{ id: 4, name: "Real User UI Testing (Playwright)", description: "Run Playwright E2E tests in container" },
	{ id: 5, name: "API & Backend Verification", description: "Test all API endpoints for correctness" },
	{ id: 6, name: "Database Validation", description: "Verify database connectivity, schema, and migrations" },
	{
		id: 7,
		name: "Integration & External Service Verification",
		description: "Test integrations with external services",
	},
	{ id: 8, name: "Queue, Worker & Background Job Testing", description: "Verify queue processing and worker health" },
	{ id: 9, name: "File Upload & Storage Testing", description: "Test file upload, download, and storage operations" },
	{ id: 10, name: "Security & Auth Validation", description: "Run security scans and auth flow tests" },
	{ id: 11, name: "Performance & Stability Testing", description: "Run load tests and stability checks" },
	{ id: 12, name: "Autonomous Debugging & Recovery", description: "Auto-fix any issues found in previous phases" },
	{ id: 13, name: "Deployment Readiness Verification", description: "Verify all criteria for production deployment" },
	{ id: 14, name: "Final Commissioning Report", description: "Generate comprehensive commissioning report" },
]

export const HARD_SAFETY_PATTERNS: SafetyRule[] = [
	{ pattern: /\brm\s+-rf\b/, reason: "Recursive force delete" },
	{ pattern: /\bmkfs\b/, reason: "Filesystem creation — destructive" },
	{ pattern: /\bdd\s+if=/, reason: "Raw disk write — destructive" },
	{ pattern: /\bshutdown\b/, reason: "System shutdown" },
	{ pattern: /\breboot\b/, reason: "System reboot" },
	{ pattern: /\bpasswd\b/, reason: "Password change" },
	{ pattern: /\buserdel\b/, reason: "User deletion" },
	{ pattern: /\busermod\b/, reason: "User modification" },
	{ pattern: /chmod\s+-R\s+777\s+\//, reason: "Recursive world-writable on root" },
	{ pattern: /chown\s+-R\s+.*\/$/, reason: "Recursive ownership change on root" },
	{ pattern: /cat\s+\.env/, reason: "Exposing .env file" },
	{ pattern: /(nano|vi|vim)\s+\.env/, reason: "Editing .env file" },
	{ pattern: />\s+\.env/, reason: "Overwriting .env file" },
	{ pattern: /\/etc\//, reason: "Editing system configuration" },
	{ pattern: /~\/\.ssh/, reason: "Accessing SSH keys" },
	{ pattern: /\/root\/\.ssh/, reason: "Accessing root SSH keys" },
	{ pattern: /docker\s+rm\b/, reason: "Docker container removal" },
	{ pattern: /docker\s+system\s+prune/, reason: "Docker system prune" },
	{ pattern: /docker\s+volume\s+rm/, reason: "Docker volume removal" },
	{ pattern: /pm2\s+delete\b/, reason: "PM2 app deletion" },
	{ pattern: /drop\s+table\b/i, reason: "Production database table deletion" },
	{ pattern: /drop\s+database\b/i, reason: "Production database deletion" },
	{ pattern: /\bprivateKey\b/, reason: "Private key exposure" },
	{ pattern: /\bsecretKey\b/, reason: "Secret key exposure" },
]

// ──────────────────────────────────────────────────────────────────────────────
// Safety Check
// ──────────────────────────────────────────────────────────────────────────────

export function checkHardSafety(command: string): SafetyCheckResult {
	for (const rule of HARD_SAFETY_PATTERNS) {
		if (rule.pattern.test(command)) {
			return { allowed: false, reason: rule.reason }
		}
	}
	return { allowed: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────────────────────

export function getPhaseName(phase: number): string {
	const found = COMMISSIONING_PHASES.find((p) => p.id === phase)
	return found ? found.name : `Unknown Phase ${phase}`
}

export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`
	return `${seconds}s`
}
