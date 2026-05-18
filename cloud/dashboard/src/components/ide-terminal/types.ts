"use client"

export interface AutocompleteSuggestion {
	label: string
	detail?: string
	insertText?: string
}

export interface BrainPlanStep {
	step: number
	action: string
	status: "pending" | "running" | "done" | "failed"
}

export interface BrainFeedback {
	type: "success" | "info" | "warning" | "error"
	message: string
	timestamp: string
}

export interface BrainError {
	file: string
	line: number
	message: string
	suggestion?: string
}

export interface BrainFix {
	file: string
	description: string
	diff?: string
	status: "pending" | "applied" | "skipped"
}

export interface BrainMemory {
	summary: string
	lastUpdated: string
	commands: string[]
	context?: string
}

export interface BrainDeployment {
	id: string
	status: string
	branch: string
	timestamp: string
	url?: string
}

export interface BrainApproval {
	id: string
	action: string
	description: string
	status: "pending" | "approved" | "rejected"
}

export interface ProjectContext {
	project: string
	language: string
	framework: string
	description: string
}

export interface DiffChange {
	type: "added" | "removed" | "unchanged"
	content: string
	lineNumber: number
}

export interface DiffData {
	filePath: string
	original: string
	modified: string
	changes: DiffChange[]
}

export type BrainTab = "plan" | "memory" | "deploy" | "errors" | "fixes" | "approvals"
