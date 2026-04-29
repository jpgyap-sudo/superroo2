/**
 * Super Roo — small presentational primitives.
 *
 * Pure, prop-driven, no context. Used across all five tabs for consistent
 * status/severity/level visualization.
 */

import { cn } from "@/lib/utils"
import type { BugSeverity, BugStatus, EventLevel, FeatureHealth, FeatureStatus, SafetyMode, TaskPriority, TaskStatus } from "../types"

// ──────────────────────────────────────────────────────────────────────────────
// Time helpers
// ──────────────────────────────────────────────────────────────────────────────

export function formatRelative(ms: number): string {
	const diff = Date.now() - ms
	if (diff < 0) return "in the future"
	const s = Math.floor(diff / 1000)
	if (s < 60) return `${s}s ago`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ago`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h ago`
	const d = Math.floor(h / 24)
	return `${d}d ago`
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	const s = Math.floor(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	const rs = s % 60
	return rs ? `${m}m ${rs}s` : `${m}m`
}

// ──────────────────────────────────────────────────────────────────────────────
// Status pills
// ──────────────────────────────────────────────────────────────────────────────

const TASK_STATUS_CLASSES: Record<TaskStatus, string> = {
	pending: "bg-vscode-badge-background text-vscode-badge-foreground",
	running: "bg-blue-500/20 text-blue-300 border-blue-500/40",
	succeeded: "bg-green-500/20 text-green-300 border-green-500/40",
	failed: "bg-red-500/20 text-red-300 border-red-500/40",
	blocked: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	cancelled: "bg-gray-500/20 text-gray-300 border-gray-500/40",
}

export function TaskStatusPill({ status }: { status: TaskStatus }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				TASK_STATUS_CLASSES[status],
			)}>
			{status}
		</span>
	)
}

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
	critical: "bg-red-500/20 text-red-300 border-red-500/40",
	high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
	normal: "bg-vscode-badge-background text-vscode-badge-foreground",
	low: "bg-gray-500/20 text-gray-400 border-gray-500/40",
}

export function PriorityPill({ priority }: { priority: TaskPriority }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				PRIORITY_CLASSES[priority],
			)}>
			{priority}
		</span>
	)
}

const FEATURE_STATUS_CLASSES: Record<FeatureStatus, string> = {
	planned: "bg-gray-500/20 text-gray-300 border-gray-500/40",
	building: "bg-blue-500/20 text-blue-300 border-blue-500/40",
	testing: "bg-purple-500/20 text-purple-300 border-purple-500/40",
	working: "bg-green-500/20 text-green-300 border-green-500/40",
	suspected_bug: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	broken: "bg-red-500/20 text-red-300 border-red-500/40",
	fixed: "bg-green-500/20 text-green-300 border-green-500/40",
	deprecated: "bg-gray-500/20 text-gray-400 border-gray-500/40",
}

export function FeatureStatusPill({ status }: { status: FeatureStatus }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				FEATURE_STATUS_CLASSES[status],
			)}>
			{status.replace("_", " ")}
		</span>
	)
}

const HEALTH_CLASSES: Record<FeatureHealth, string> = {
	unknown: "bg-gray-500/20 text-gray-400 border-gray-500/40",
	healthy: "bg-green-500/20 text-green-300 border-green-500/40",
	degraded: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	failing: "bg-red-500/20 text-red-300 border-red-500/40",
}

export function HealthPill({ health }: { health: FeatureHealth }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				HEALTH_CLASSES[health],
			)}>
			{health}
		</span>
	)
}

const BUG_SEVERITY_CLASSES: Record<BugSeverity, string> = {
	critical: "bg-red-600/30 text-red-200 border-red-500/60",
	high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
	medium: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	low: "bg-gray-500/20 text-gray-300 border-gray-500/40",
}

export function SeverityPill({ severity }: { severity: BugSeverity }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				BUG_SEVERITY_CLASSES[severity],
			)}>
			{severity}
		</span>
	)
}

const BUG_STATUS_CLASSES: Record<BugStatus, string> = {
	open: "bg-red-500/20 text-red-300 border-red-500/40",
	investigating: "bg-blue-500/20 text-blue-300 border-blue-500/40",
	fixed: "bg-green-500/20 text-green-300 border-green-500/40",
	blocked: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
	wontfix: "bg-gray-500/20 text-gray-400 border-gray-500/40",
}

export function BugStatusPill({ status }: { status: BugStatus }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				BUG_STATUS_CLASSES[status],
			)}>
			{status}
		</span>
	)
}

const LEVEL_CLASSES: Record<EventLevel, string> = {
	debug: "text-gray-400",
	info: "text-vscode-foreground",
	warn: "text-yellow-300",
	error: "text-red-300",
}

export function LevelText({ level, children }: { level: EventLevel; children: string }) {
	return <span className={cn("font-mono text-xs", LEVEL_CLASSES[level])}>{children}</span>
}

const MODE_CLASSES: Record<SafetyMode, string> = {
	OFF: "bg-gray-500/30 text-gray-300 border-gray-500/60",
	SAFE: "bg-blue-500/20 text-blue-300 border-blue-500/40",
	AUTO: "bg-green-500/20 text-green-300 border-green-500/40",
	FULL_AUTONOMOUS: "bg-orange-500/30 text-orange-200 border-orange-500/60",
}

export function ModePill({ mode }: { mode: SafetyMode }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border",
				MODE_CLASSES[mode],
			)}>
			{mode}
		</span>
	)
}
