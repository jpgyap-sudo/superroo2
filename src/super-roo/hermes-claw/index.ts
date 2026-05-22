/**
 * Super Roo — HermesClaw (Memory & Context Agent)
 *
 * TypeScript source for the cloud HermesClaw implementation.
 * The JS runtime implementation lives at cloud/orchestrator/modules/HermesClaw.js.
 * This file provides TypeScript types and re-exports from the debug-team adapter.
 *
 * HermesClaw is the MEMORY & CONTEXT agent for the Cloud Orchestrator.
 * It uses Ollama (primary) + OpenAI (fallback) + DeepSeek (secondary fallback)
 * for natural language understanding, memory recall, pattern recognition,
 * and skill generation.
 *
 * Cloud-specific additions vs HermesClawAdapter.ts:
 *   - Disk persistence (survives PM2 restarts)
 *   - Cross-job pattern analysis across ALL orchestrator tasks
 *   - Skill file generation for repeated failures
 *   - Knowledge base querying via API endpoint
 *   - pgvector-backed RAG memory via BugKnowledgeStore
 *   - Ollama Growth tracking for dashboard
 */

import { EventEmitter } from "events"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type HermesOperation =
	| "create_skill"
	| "memory_summary"
	| "context_recall"
	| "improvement_suggestion"
	| "pattern_analysis"
	| "knowledge_query"
	| "best_practices"
	| "lesson_extraction"
	| "store_bug_fix"
	| "store_lesson"
	| "build_rag_context"

export interface HermesRequest {
	operation: HermesOperation
	topic: string
	data: Record<string, unknown>
}

export interface HermesResult {
	output: string
	durationMs: number
	success: boolean
	error?: string
	structuredData?: Record<string, unknown>
}

export interface HermesMemoryEntry {
	key: string
	operation: string
	topic: string
	summary: string
	timestamp: number
}

export interface HermesClawConfig {
	ollamaBaseUrl: string
	ollamaModel: string
	apiKey: string
	model: string
	baseUrl: string
	fallbackApiKey: string
	fallbackModel: string
	fallbackBaseUrl: string
	operationModels: Partial<Record<HermesOperation, string>>
	timeoutMs: number
	maxTokens: number
	temperature: number
	maxMemoryEntries: number
	memoryFilePath: string
	skillsDir: string
	ollamaGrowthDir: string
}

export interface OllamaGrowthEvent {
	timestamp: number
	type: "readiness_check" | "model_load" | "inference" | "error"
	model: string
	durationMs: number
	success: boolean
	error?: string
}

export interface SkillFile {
	name: string
	description: string
	failurePattern: string
	rootCause: string
	solution: string
	verificationSteps: string[]
	relatedFiles: string[]
	tags: string[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_HERMES_CONFIG: HermesClawConfig = {
	ollamaBaseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
	ollamaModel:
		process.env.OLLAMA_MODEL || process.env.OLLAMA_HERMES_MODEL || process.env.OLLAMA_CHAT_MODEL || "qwen2.5:0.5b",
	apiKey: process.env.OPENAI_API_KEY || "",
	model: "gpt-4o-mini",
	baseUrl: "https://api.openai.com/v1",
	fallbackApiKey: process.env.DEEPSEEK_API_KEY || "",
	fallbackModel: "deepseek-chat",
	fallbackBaseUrl: "https://api.deepseek.com/v1",
	operationModels: {
		memory_summary: "ollama",
		lesson_extraction: "ollama",
		knowledge_query: "ollama",
		best_practices: "ollama",
		context_recall: "ollama",
		create_skill: "ollama",
		pattern_analysis: "ollama",
		improvement_suggestion: "ollama",
	},
	timeoutMs: 120_000,
	maxTokens: 2048,
	temperature: 0.3,
	maxMemoryEntries: 2000,
	memoryFilePath: "",
	skillsDir: "",
	ollamaGrowthDir: "",
}

export const SYSTEM_PROMPTS: Record<string, string> = {
	create_skill:
		"You are a skill generation expert. Given a failure or lesson from a debugging session, " +
		"create a structured skill definition in YAML frontmatter markdown format. " +
		"The skill should be reusable for future debugging sessions. " +
		"Output ONLY the skill file content with: name, description, failurePattern, " +
		"rootCause, solution, verificationSteps, relatedFiles, and tags.",

	memory_summary:
		"You are a memory summarization expert. Given a task's history, " +
		"create a concise but comprehensive summary covering: the goal, what was attempted, " +
		"key decisions made, what worked and what didn't, and lessons learned. " +
		"Focus on actionable insights for future tasks.",

	context_recall:
		"You are a context recall specialist. Given a query and relevant memory entries, " +
		"find and present the most relevant past experiences, solutions, and patterns. " +
		"For each suggestion, indicate confidence level and explain why it's relevant.",

	improvement_suggestion:
		"You are a process improvement analyst. Given failure patterns and job statistics, " +
		"suggest concrete improvements to the orchestrator process. " +
		"Prioritize suggestions by impact and effort required. " +
		"Consider tooling, automation, knowledge gaps, and workflow changes.",

	pattern_analysis:
		"You are a pattern recognition expert. Given data from multiple tasks, " +
		"identify recurring failure patterns, common root causes, and systemic issues. " +
		"Provide recommendations for systemic fixes that would prevent entire classes of failures.",

	knowledge_query:
		"You are a knowledge base query specialist. Given a question about the codebase or " +
		"feature implementation, search your knowledge and provide relevant solutions, " +
		"best practices, and references to existing skill files or resources.",

	best_practices:
		"You are a best practices curator. Given successful task completions, " +
		"extract and document best practices that can be applied to future work. " +
		"Focus on patterns that generalize across different types of problems.",

	lesson_extraction:
		"You are a lessons learned specialist. Given a completed or failed task, " +
		"extract structured lessons covering: what went wrong, root cause, " +
		"prevention strategies, early detection methods, and recommended skill/resource creation.",
}

// ──────────────────────────────────────────────────────────────────────────────
// Re-export from debug-team adapter for type compatibility
// ──────────────────────────────────────────────────────────────────────────────

export type {
	HermesClawOperation,
	HermesClawRequest,
	HermesClawResult,
	HermesClawAdapterConfig,
} from "../debug-team/adapters/HermesClawAdapter"
