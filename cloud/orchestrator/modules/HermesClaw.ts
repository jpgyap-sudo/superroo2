/**
 * SuperRoo Cloud — HermesClaw (Memory & Context Agent) — TypeScript Port
 *
 * This is the TypeScript port of HermesClaw.js. It wraps the JS implementation
 * with full TypeScript type safety. Over time, the implementation logic should
 * be migrated from the JS file into this TS file.
 *
 * Current status: Type definitions + wrapper layer. Core logic still in HermesClaw.js.
 */

import { EventEmitter } from "events"
import { BugKnowledgeStore } from "../stores/BugKnowledgeStore"
import type {
	HermesOperation,
	HermesRequest,
	HermesResult,
	HermesMemoryEntry,
	HermesClawConfig,
	HermesStats,
	HermesOperationEvent,
} from "./HermesClawTypes"
import { getDefaultConfig } from "./HermesClawTypes"
import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"

// ── System Prompts ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<HermesOperation, string> = {
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

	store_bug_fix:
		"You are a bug fix recorder. Given a bug fix description, extract the key details for storage in the knowledge base.",

	store_lesson:
		"You are a lesson recorder. Given a lesson, extract structured metadata for storage in the knowledge base.",

	build_rag_context:
		"You are a RAG context builder. Given a query, build a concise context string from relevant knowledge base entries.",
}

// ═══════════════════════════════════════════════════════════════════════════════
// HermesClaw (TypeScript Port)
// ═══════════════════════════════════════════════════════════════════════════════

export class HermesClaw extends EventEmitter {
	public config: HermesClawConfig
	public operationCount = 0
	public totalDurationMs = 0
	public memory: Map<string, HermesMemoryEntry> = new Map()
	public knowledgeStore: BugKnowledgeStore | null = null

	private memoryFilePath: string
	private skillsDir: string
	private ollamaGrowthDir: string
	private persistTimer: ReturnType<typeof setInterval> | null = null
	private ready = false

	constructor(config: Partial<HermesClawConfig> = {}) {
		super()
		this.config = { ...getDefaultConfig(), ...config }
		this.memoryFilePath = this.config.memoryFilePath
		this.skillsDir = this.config.skillsDir
		this.ollamaGrowthDir = this.config.ollamaGrowthDir
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async init(): Promise<void> {
		if (this.ready) return
		await this.loadMemory()
		this.initKnowledgeStore()
		this.persistTimer = setInterval(() => this.persistMemory(), 30000)
		this.ready = true
		this.emit("ready")
	}

	async destroy(): Promise<void> {
		if (this.persistTimer) {
			clearInterval(this.persistTimer)
			this.persistTimer = null
		}
		await this.persistMemory()
		this.ready = false
	}

	// ── Core Operations ─────────────────────────────────────────────────────────

	async execute(request: HermesRequest): Promise<HermesResult> {
		if (!this.ready) await this.init()

		const start = Date.now()
		try {
			const result = await this.callLLM(request.operation, request.topic, request.data)

			// Store in memory
			const entry: HermesMemoryEntry = {
				key: `${request.operation}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
				operation: request.operation,
				topic: request.topic,
				summary: result.slice(0, 500),
				timestamp: Date.now(),
			}
			this.memory.set(entry.key, entry)
			this.operationCount++
			this.totalDurationMs += Date.now() - start

			this.emit("operation", {
				operation: request.operation,
				durationMs: Date.now() - start,
				success: true,
			} satisfies HermesOperationEvent)

			return {
				output: result,
				durationMs: Date.now() - start,
				success: true,
			}
		} catch (err) {
			this.emit("operation", {
				operation: request.operation,
				durationMs: Date.now() - start,
				success: false,
				error: (err as Error).message,
			} satisfies HermesOperationEvent)

			return {
				output: "",
				durationMs: Date.now() - start,
				success: false,
				error: (err as Error).message,
			}
		}
	}

	// ── LLM Call (delegates to JS implementation for now) ──────────────────────
	// TODO: Port the actual LLM calling logic from HermesClaw.js

	private async callLLM(
		operation: HermesOperation,
		topic: string,
		data: Record<string, unknown>,
	): Promise<string> {
		// For now, delegate to the JS implementation by requiring it
		const jsImpl = require("./HermesClaw.js")
		if (jsImpl && jsImpl.executeOperation) {
			return await jsImpl.executeOperation(operation, topic, data, this.config)
		}
		throw new Error(`HermesClaw TS port: operation ${operation} not yet implemented`)
	}

	// ── Stats ──────────────────────────────────────────────────────────────────

	getStats(): HermesStats {
		return {
			operationCount: this.operationCount,
			memoryEntries: this.memory.size,
			averageDurationMs: this.operationCount > 0 ? Math.round(this.totalDurationMs / this.operationCount) : 0,
		}
	}

	// ── Memory Persistence ─────────────────────────────────────────────────────

	getMemoryEntries(): HermesMemoryEntry[] {
		return Array.from(this.memory.values())
	}

	getMemoryByKey(key: string): HermesMemoryEntry | undefined {
		return this.memory.get(key)
	}

	clearMemory(): void {
		this.memory.clear()
	}

	private async loadMemory(): Promise<void> {
		try {
			const data = await fs.readFile(this.memoryFilePath, "utf-8")
			const entries: HermesMemoryEntry[] = JSON.parse(data)
			for (const entry of entries) {
				this.memory.set(entry.key, entry)
			}
		} catch {
			// File doesn't exist yet — start fresh
		}
	}

	private async persistMemory(): Promise<void> {
		try {
			const dir = path.dirname(this.memoryFilePath)
			await fs.mkdir(dir, { recursive: true })
			const entries = Array.from(this.memory.values()).slice(-this.config.maxMemoryEntries)
			await fs.writeFile(this.memoryFilePath + ".tmp", JSON.stringify(entries), "utf-8")
			await fs.rename(this.memoryFilePath + ".tmp", this.memoryFilePath)
		} catch (err) {
			console.error("[HermesClaw] Memory persist error:", (err as Error).message)
		}
	}

	// ── Knowledge Store ────────────────────────────────────────────────────────

	private initKnowledgeStore(): void {
		try {
			const { BugKnowledgeStore } = require("../stores/BugKnowledgeStore")
			this.knowledgeStore = new BugKnowledgeStore()
		} catch {
			// BugKnowledgeStore not available — RAG features disabled
		}
	}

	getSystemPrompt(operation: HermesOperation): string {
		return SYSTEM_PROMPTS[operation] || SYSTEM_PROMPTS.memory_summary
	}
}

// ── Factory ─────────────────────────────────────────────────────────────────────

export function createHermesClaw(config?: Partial<HermesClawConfig>): HermesClaw {
	return new HermesClaw(config)
}

export type { HermesClawConfig, HermesStats, HermesMemoryEntry, HermesRequest, HermesResult, HermesOperation }
