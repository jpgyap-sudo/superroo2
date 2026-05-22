/**
 * Super Roo — Autonomous Loop
 *
 * TypeScript source for the 10-step autonomous coding & debugging improvement loop.
 * The JS runtime implementation lives at cloud/orchestrator/modules/AutonomousLoop.js.
 * This file provides TypeScript types and a factory function.
 */

import { EventEmitter } from "events"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface AutonomousLoopOptions {
	orchestrator?: unknown
	target?: string
	branch?: string
	durationMs?: number
	stepTimeoutMs?: number
	workspaceRoot?: string
	containerFirst?: boolean
	execAsync?: (command: string) => Promise<{ stdout: string; stderr: string }>
}

export interface AutonomousLoopStatus {
	jobId: string | null
	status: string
	running: boolean
	target: string
	branch: string
	currentStep: number
	currentStepName: string
	totalSteps: number
	progress: number
	elapsedMs: number
	remainingMs: number
	elapsedFormatted: string
	remainingFormatted: string
	stepResults: StepResult[]
	error: string | null
	startedAt: number | null
}

export interface StepResult {
	step: number
	name: string
	status: "completed" | "failed" | "skipped"
	details?: string
	duration?: number
	reason?: string
	timestamp: number
}

export interface StartResult {
	success: boolean
	jobId?: string
	status?: string
	target?: string
	durationMs?: number
	error?: string
}

export interface StopResult {
	success: boolean
	jobId?: string
	status?: string
	completedSteps?: number
	stepResults?: StepResult[]
	error?: string
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

export const STEP_NAMES: Record<number, string> = {
	1: "Audit",
	2: "Fix",
	3: "Test",
	4: "Simulate (E2E)",
	5: "Improve Code Quality",
	6: "Pattern Learning",
	7: "Dashboard",
	8: "Commit",
	9: "Deploy",
	10: "Health Check",
}

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
	{ pattern: /chown\s+-R\s+\//, reason: "Recursive ownership change on root" },
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

export function getStepName(step: number): string {
	return STEP_NAMES[step] || `Unknown Step ${step}`
}

export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`
	return `${seconds}s`
}
