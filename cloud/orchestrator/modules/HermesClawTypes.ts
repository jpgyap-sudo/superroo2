/**
 * SuperRoo Cloud — HermesClaw Type Definitions
 *
 * Shared types for HermesClaw (Memory & Context Agent).
 * Used by both the JS implementation and any future TS port.
 */

// ── Operation Types ─────────────────────────────────────────────────────────────

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

// ── Request / Result ────────────────────────────────────────────────────────────

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

// ── Memory ──────────────────────────────────────────────────────────────────────

export interface HermesMemoryEntry {
	key: string
	operation: string
	topic: string
	summary: string
	timestamp: number
}

// ── Config ──────────────────────────────────────────────────────────────────────

export interface HermesClawConfig {
	ollamaBaseUrl: string
	ollamaModel: string
	apiKey: string
	model: string
	baseUrl: string
	fallbackApiKey: string
	fallbackModel: string
	fallbackBaseUrl: string
	operationModels: Partial<Record<HermesOperation, "ollama" | "cloud">>
	timeoutMs: number
	maxTokens: number
	temperature: number
	maxMemoryEntries: number
	memoryFilePath: string
	skillsDir: string
	ollamaGrowthDir: string
}

// ── Stats ───────────────────────────────────────────────────────────────────────

export interface HermesStats {
	operationCount: number
	memoryEntries: number
	averageDurationMs: number
	lastOperation?: string
	lastOperationTime?: number
}

// ── Skill Entry ─────────────────────────────────────────────────────────────────

export interface SkillEntry {
	name: string
	description: string
	failurePattern: string
	rootCause: string
	solution: string
	verificationSteps: string[]
	relatedFiles: string[]
	tags: string[]
	createdAt: string
}

// ── Ollama Growth Entry ─────────────────────────────────────────────────────────

export interface OllamaGrowthEntry {
	model: string
	operation: "readiness_check" | "growth_event" | "performance_sample"
	timestamp: string
	durationMs: number
	success: boolean
	tokensGenerated?: number
	tokensPerSecond?: number
	error?: string
	metadata?: Record<string, unknown>
}

// ── RAG / Knowledge Base ────────────────────────────────────────────────────────

export interface BugFixRecord {
	id: string
	title: string
	description: string
	rootCause: string
	solution: string
	affectedFiles: string[]
	tags: string[]
	timestamp: string
	embedding?: number[]
}

export interface LessonRecord {
	id: string
	title: string
	content: string
	source: string
	tags: string[]
	timestamp: string
	embedding?: number[]
}

export interface RAGContext {
	bugFixes: BugFixRecord[]
	lessons: LessonRecord[]
	query: string
	totalResults: number
}

// ── Event Types ─────────────────────────────────────────────────────────────────

export interface HermesOperationEvent {
	operation: HermesOperation
	durationMs: number
	success: boolean
	error?: string
}

// ── Default Config ──────────────────────────────────────────────────────────────

export function getDefaultConfig(): HermesClawConfig {
	return {
		ollamaBaseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
		ollamaModel: process.env.OLLAMA_MODEL || process.env.OLLAMA_HERMES_MODEL || process.env.OLLAMA_CHAT_MODEL || "hermes3",
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
		memoryFilePath: pathJoin(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud/data/hermes-memory.json"),
		skillsDir: pathJoin(process.env.SUPERROO_ROOT || "/opt/superroo2", ".roo/skills"),
		ollamaGrowthDir: pathJoin(process.env.SUPERROO_ROOT || "/opt/superroo2", "memory", "ollama"),
	}
}

function pathJoin(...parts: string[]): string {
	return parts.join("/").replace(/\/+/g, "/")
}
