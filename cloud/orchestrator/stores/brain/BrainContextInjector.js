/**
 * BrainContextInjector — Builds enriched context prompts from pgvector memory
 *
 * Integrates with PromptEnhancer to inject relevant memories into agent prompts.
 * Supports model-specific formatting (codex, claude, deepseek, kimi).
 */

class BrainContextInjector {
	/**
	 * @param {import('./MemoryService')} memoryService
	 * @param {object} [options]
	 * @param {number} [options.maxMemories=5]
	 * @param {number} [options.maxTokens=3000]
	 * @param {number} [options.minSimilarity=0.6]
	 */
	constructor(memoryService, options = {}) {
		this.memoryService = memoryService
		this.maxMemories = options.maxMemories || 5
		this.maxTokens = options.maxTokens || 3000
		this.minSimilarity = options.minSimilarity || 0.6
	}

	/**
	 * Build a context block from relevant memories for a task.
	 *
	 * @param {object} task - { projectId, goal, tags?, files?, agent?, model? }
	 * @returns {Promise<{memories: Array, contextBlock: string, tokenCount: number}>}
	 */
	async buildContext(task) {
		const projectId = task.projectId || "default"
		const memories = await this._fetchMemories(projectId, task)
		const contextBlock = this._formatMemories(memories, task.model)
		const tokenCount = this._estimateTokens(contextBlock)

		return { memories, contextBlock, tokenCount }
	}

	/**
	 * Fetch relevant memories using semantic search + tag/file filtering.
	 */
	async _fetchMemories(projectId, task) {
		try {
			// Primary: semantic search on the task goal
			const semanticResults = await this.memoryService.searchMemory({
				projectId,
				query: task.goal || "",
				limit: this.maxMemories,
				minSimilarity: this.minSimilarity,
				status: "approved",
			})

			// Secondary: tag-based lookup if tags provided
			let tagResults = []
			if (task.tags && task.tags.length > 0) {
				tagResults = await this.memoryService.listMemories({
					projectId,
					tags: task.tags,
					limit: 3,
					status: "approved",
				})
			}

			// Tertiary: file-based lookup if files provided
			let fileResults = []
			if (task.files && task.files.length > 0) {
				fileResults = await this.memoryService.listMemories({
					projectId,
					files: task.files,
					limit: 3,
					status: "approved",
				})
			}

			// Merge and deduplicate by id
			const seen = new Set()
			const merged = []

			for (const mem of [...semanticResults, ...tagResults, ...fileResults]) {
				if (!seen.has(mem.id) && merged.length < this.maxMemories) {
					seen.add(mem.id)
					merged.push(mem)
				}
			}

			return merged
		} catch (err) {
			// Graceful degradation: return empty if pgvector unavailable
			return []
		}
	}

	/**
	 * Format memories into a model-specific context block.
	 */
	_formatMemories(memories, model = "codex") {
		if (!memories || memories.length === 0) {
			return ""
		}

		const header = "📚 Relevant memories from Central Brain:\n"

		switch (model) {
			case "claude":
				return this._formatClaude(header, memories)
			case "deepseek":
				return this._formatDeepSeek(header, memories)
			case "kimi":
				return this._formatKimi(header, memories)
			case "codex":
			default:
				return this._formatCodex(header, memories)
		}
	}

	_formatCodex(header, memories) {
		const items = memories.map(
			(m, i) =>
				`[${i + 1}] ${m.title} (${m.memory_type}, confidence: ${(m.confidence * 100).toFixed(0)}%)
   Summary: ${m.summary}
   Tags: ${(m.tags || []).join(", ")}
   Files: ${(m.files || []).join(", ")}`,
		)
		return `${header}\n${items.join("\n\n")}\n`
	}

	_formatClaude(header, memories) {
		const items = memories.map(
			(m, i) =>
				`<memory index="${i + 1}" type="${m.memory_type}" confidence="${(m.confidence * 100).toFixed(0)}%">
  <title>${m.title}</title>
  <summary>${m.summary}</summary>
  <tags>${(m.tags || []).join(", ")}</tags>
</memory>`,
		)
		return `${header}\n${items.join("\n")}\n`
	}

	_formatDeepSeek(header, memories) {
		const items = memories.map(
			(m, i) =>
				`[MEMORY ${i + 1}]
Title: ${m.title}
Type: ${m.memory_type}
Confidence: ${(m.confidence * 100).toFixed(0)}%
Summary: ${m.summary}
Tags: ${(m.tags || []).join(", ")}
---`,
		)
		return `${header}\n${items.join("\n")}\n`
	}

	_formatKimi(header, memories) {
		const items = memories.map(
			(m, i) =>
				`## Memory ${i + 1}: ${m.title}
- Type: ${m.memory_type} | Confidence: ${(m.confidence * 100).toFixed(0)}%
- Summary: ${m.summary}
- Tags: ${(m.tags || []).join(", ")}`,
		)
		return `${header}\n${items.join("\n\n")}\n`
	}

	/**
	 * Rough token estimation (4 chars ≈ 1 token).
	 */
	_estimateTokens(text) {
		return Math.ceil(text.length / 4)
	}

	/**
	 * Check if the context block fits within token limits.
	 */
	fitsInLimit(contextBlock) {
		return this._estimateTokens(contextBlock) <= this.maxTokens
	}

	/**
	 * Build a system prompt section with memory context.
	 */
	async createSystemPrompt(task) {
		const { memories, contextBlock, tokenCount } = await this.buildContext(task)

		if (!contextBlock) {
			return { systemPrompt: "", memories, tokenCount: 0 }
		}

		const systemPrompt = [
			"## Central Brain Memory Context",
			"",
			"The following memories are relevant to this task. Use them to inform your approach:",
			"",
			contextBlock,
			"---",
		].join("\n")

		return { systemPrompt, memories, tokenCount }
	}
}

module.exports = { BrainContextInjector }
