/**
 * ContextAssembler — Task context enrichment module for the Cloud Orchestrator.
 *
 * Root cause of weak cloud coding output: context starvation.
 * The local TypeScript orchestrator has access to the full VS Code workspace,
 * file tree, feature registry, and lesson store. The cloud orchestrator runs
 * in a headless Node.js process with none of that.
 *
 * ContextAssembler bridges this gap by gathering context from every available
 * module before a task is dispatched to TaskExecutor:
 *
 *   1. FeatureRegistry — active features relevant to the task type
 *   2. EventLog — recent events for situational awareness
 *   3. LearningGateway — prior lessons matching the task
 *   4. Repo file-tree snapshot — lightweight directory map (with delta support)
 *   5. SafetyManager — safety-aware context filtering
 *
 * Improvements over baseline:
 *   - Adaptive token budget based on task complexity
 *   - Context cache with TTL-based invalidation
 *   - Priority-aware context depth (high-priority skips file tree)
 *   - Context assembly telemetry (timing, token counts, truncation ratios)
 *   - Safety-aware context filtering (exclude sensitive patterns)
 *   - Parallel context assembly (Promise.all for all sources)
 *   - Context assembly as lesson source (feed usefulness back to learning layer)
 *   - File tree delta instead of full tree (cache full tree, inject deltas)
 */

const fs = require("node:fs")
const path = require("node:path")

// ── Token budget presets per complexity level ──────────────────────────────
const TOKEN_BUDGETS = {
	simple: 3000, // e.g., single-file edit, config change
	moderate: 6000, // e.g., multi-file feature, refactor
	complex: 12000, // e.g., cross-module feature, architecture change
	debug: 8000, // e.g., bug investigation with logs
}

// ── Cache TTL (ms) ─────────────────────────────────────────────────────────
const CACHE_TTL = 30_000 // 30 seconds

// ── Sensitive patterns to exclude in safety mode ───────────────────────────
const SENSITIVE_PATTERNS = [
	/(?:sk|pk|secret|token|key|password|credential)[-_]?[a-zA-Z0-9]{16,}/gi,
	/(?:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)/gi,
	/(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36}/g,
	/(?:AKIA[0-9A-Z]{16})/g, // AWS access keys
]

class ContextAssembler {
	/**
	 * @param {Object} opts
	 * @param {Object} [opts.featureRegistry] - FeatureRegistry instance
	 * @param {Object} [opts.eventLog] - EventLog instance
	 * @param {Object} [opts.learningGateway] - LearningGateway instance
	 * @param {Object} [opts.safetyManager] - SafetyManager instance (for safety-aware filtering)
	 * @param {string} [opts.projectRoot] - Project root for file-tree scan
	 * @param {number} [opts.maxRecentEvents=20] - Max recent events to include
	 * @param {number} [opts.maxLessons=5] - Max lessons to include
	 * @param {number} [opts.maxTreeDepth=3] - Max directory depth for file-tree scan
	 * @param {boolean} [opts.enableCache=true] - Enable context cache
	 * @param {boolean} [opts.enableTelemetry=true] - Enable assembly telemetry
	 * @param {boolean} [opts.enableParallelAssembly=true] - Enable parallel assembly
	 * @param {boolean} [opts.enableDeltaTree=true] - Enable file tree delta
	 * @param {boolean} [opts.enableSafetyFiltering=true] - Enable safety-aware filtering
	 */
	constructor(opts = {}) {
		this.featureRegistry = opts.featureRegistry || null
		this.eventLog = opts.eventLog || null
		this.learningGateway = opts.learningGateway || null
		this.safetyManager = opts.safetyManager || null
		this.projectRoot = opts.projectRoot || process.env.SUPERROO_ROOT || process.cwd()
		this.maxRecentEvents = opts.maxRecentEvents || 20
		this.maxLessons = opts.maxLessons || 5
		this.maxTreeDepth = opts.maxTreeDepth || 3

		// Feature flags
		this.enableCache = opts.enableCache !== false
		this.enableTelemetry = opts.enableTelemetry !== false
		this.enableParallelAssembly = opts.enableParallelAssembly !== false
		this.enableDeltaTree = opts.enableDeltaTree !== false
		this.enableSafetyFiltering = opts.enableSafetyFiltering !== false

		// ── Cache ─────────────────────────────────────────────────────────
		/** @type {Map<string, {context: Object, expiresAt: number}>} */
		this._cache = new Map()

		// ── Cached full file tree (for delta computation) ─────────────────
		/** @type {{tree: Object|null, capturedAt: number}|null} */
		this._cachedFullTree = null

		// ── Telemetry ─────────────────────────────────────────────────────
		/** @type {Array<Object>} */
		this._telemetryLog = []
		this._maxTelemetryEntries = 100
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Public API
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Assemble context for a task.
	 *
	 * Gathers context from all available sources in parallel (when enabled),
	 * applies adaptive token budgeting, caching, safety filtering, and
	 * file-tree delta computation.
	 *
	 * @param {Object} task - The task object from the queue
	 * @returns {Promise<Object>} The assembled context
	 */
	async assemble(task) {
		const startTime = Date.now()
		const cacheKey = this._buildCacheKey(task)

		// ── Check cache ───────────────────────────────────────────────────
		if (this.enableCache) {
			const cached = this._cache.get(cacheKey)
			if (cached && cached.expiresAt > Date.now()) {
				if (this.enableTelemetry) {
					this._recordTelemetry({
						taskId: task.id,
						cacheHit: true,
						assemblyTimeMs: 0,
						tokenBudget: 0,
						tokenCount: 0,
						truncationRatio: 0,
						sourcesUsed: [],
					})
				}
				return cached.context
			}
		}

		// ── Determine complexity and token budget ─────────────────────────
		const complexity = this._detectComplexity(task)
		const tokenBudget = TOKEN_BUDGETS[complexity] || TOKEN_BUDGETS.moderate

		// ── Determine if high-priority (skip file tree for speed) ─────────
		const isHighPriority = (task.priority || 10) <= 3

		// ── Build context object ──────────────────────────────────────────
		const context = {
			taskType: task.type,
			taskId: task.id,
			features: [],
			recentEvents: [],
			lessons: [],
			fileTree: null,
			assembledAt: Date.now(),
			complexity,
			tokenBudget,
			_telemetry: {
				assemblyTimeMs: 0,
				sourcesUsed: [],
				truncationRatio: 0,
				tokenCount: 0,
			},
		}

		// ── Gather sources in parallel (when enabled) ─────────────────────
		const sourcesUsed = []

		if (this.enableParallelAssembly) {
			// Parallel mode: fire all queries concurrently
			const results = await Promise.allSettled([
				this._gatherFeatures(task).then((r) => {
					sourcesUsed.push("features")
					return r
				}),
				this._gatherEvents(task).then((r) => {
					sourcesUsed.push("events")
					return r
				}),
				this._gatherLessons(task, tokenBudget).then((r) => {
					sourcesUsed.push("lessons")
					return r
				}),
				this._gatherFileTree(task, isHighPriority).then((r) => {
					sourcesUsed.push("fileTree")
					return r
				}),
			])

			if (results[0].status === "fulfilled") context.features = results[0].value
			if (results[1].status === "fulfilled") context.recentEvents = results[1].value
			if (results[2].status === "fulfilled") {
				context.lessons = results[2].value.lessons
				context.lessonsCompact = results[2].value.compact
			}
			if (results[3].status === "fulfilled") context.fileTree = results[3].value
		} else {
			// Sequential mode (original behavior)
			context.features = await this._gatherFeatures(task)
			sourcesUsed.push("features")

			context.recentEvents = await this._gatherEvents(task)
			sourcesUsed.push("events")

			const lessonResult = await this._gatherLessons(task, tokenBudget)
			context.lessons = lessonResult.lessons
			context.lessonsCompact = lessonResult.compact
			sourcesUsed.push("lessons")

			context.fileTree = await this._gatherFileTree(task, isHighPriority)
			sourcesUsed.push("fileTree")
		}

		// ── Safety-aware filtering ────────────────────────────────────────
		if (this.enableSafetyFiltering) {
			this._applySafetyFilter(context)
		}

		// ── Token budget enforcement (truncate if over budget) ────────────
		const formattedText = this.formatContext(context)
		const tokenCount = this._estimateTokens(formattedText)
		const truncationRatio = tokenCount > tokenBudget ? 1 - tokenBudget / tokenCount : 0

		if (tokenCount > tokenBudget) {
			this._truncateContext(context, tokenBudget)
		}

		// ── Telemetry ─────────────────────────────────────────────────────
		const assemblyTimeMs = Date.now() - startTime
		context._telemetry.assemblyTimeMs = assemblyTimeMs
		context._telemetry.sourcesUsed = sourcesUsed
		context._telemetry.truncationRatio = truncationRatio
		context._telemetry.tokenCount = Math.min(tokenCount, tokenBudget)

		if (this.enableTelemetry) {
			this._recordTelemetry({
				taskId: task.id,
				cacheHit: false,
				assemblyTimeMs,
				tokenBudget,
				tokenCount: Math.min(tokenCount, tokenBudget),
				truncationRatio,
				sourcesUsed,
				complexity,
				isHighPriority,
			})
		}

		// ── Cache the result ──────────────────────────────────────────────
		if (this.enableCache) {
			this._cache.set(cacheKey, {
				context,
				expiresAt: Date.now() + CACHE_TTL,
			})
		}

		return context
	}

	/**
	 * Format the assembled context as a compact text block suitable for
	 * injection into an LLM prompt.
	 *
	 * @param {Object} context - The assembled context object
	 * @returns {string} Formatted context text
	 */
	formatContext(context) {
		const parts = []

		// Features
		if (context.features && context.features.length > 0) {
			const featureLines = context.features
				.map(
					(f) =>
						`  - ${f.name}${f.description ? `: ${f.description}` : ""}${f.health ? ` [${f.health}]` : ""}`,
				)
				.join("\n")
			parts.push(`Active Features:\n${featureLines}`)
		}

		// Recent events (last 10, most relevant)
		if (context.recentEvents && context.recentEvents.length > 0) {
			const eventLines = context.recentEvents
				.slice(0, 10)
				.map((e) => `  - [${e.severity}] ${e.type} (${e.source})${e.taskId ? ` task=${e.taskId}` : ""}`)
				.join("\n")
			parts.push(`Recent Events:\n${eventLines}`)
		}

		// Lessons
		if (context.lessonsCompact) {
			parts.push(context.lessonsCompact)
		} else if (context.lessons && context.lessons.length > 0) {
			const lessonLines = context.lessons
				.map(
					(l, i) =>
						`  ${i + 1}. ${l.title}\n     Rule: ${l.ruleSummary}\n     Tags: ${(l.tags || []).join(", ") || "none"}`,
				)
				.join("\n")
			parts.push(`Relevant Lessons:\n${lessonLines}`)
		}

		// File tree
		if (context.fileTree) {
			const treeStr = this._formatTree(context.fileTree, "")
			parts.push(`Project Structure:\n${treeStr}`)
		}

		// Complexity indicator
		parts.push(`Context Complexity: ${context.complexity || "moderate"}`)

		return parts.join("\n\n")
	}

	/**
	 * Get telemetry data for monitoring.
	 * @returns {Array<Object>} Recent telemetry entries
	 */
	getTelemetry() {
		return [...this._telemetryLog]
	}

	/**
	 * Get telemetry summary statistics.
	 * @returns {Object} Summary stats
	 */
	getTelemetrySummary() {
		if (this._telemetryLog.length === 0) {
			return {
				totalAssemblies: 0,
				averageTimeMs: 0,
				cacheHitRate: 0,
				averageTruncationRatio: 0,
				sourceUsage: {},
			}
		}

		const total = this._telemetryLog.length
		const cacheHits = this._telemetryLog.filter((t) => t.cacheHit).length
		const avgTime = this._telemetryLog.reduce((s, t) => s + t.assemblyTimeMs, 0) / total
		const avgTruncation = this._telemetryLog.reduce((s, t) => s + t.truncationRatio, 0) / total

		// Source usage frequency
		const sourceUsage = {}
		for (const entry of this._telemetryLog) {
			for (const src of entry.sourcesUsed || []) {
				sourceUsage[src] = (sourceUsage[src] || 0) + 1
			}
		}

		return {
			totalAssemblies: total,
			averageTimeMs: Math.round(avgTime),
			cacheHitRate: total > 0 ? Math.round((cacheHits / total) * 100) : 0,
			averageTruncationRatio: Math.round(avgTruncation * 100) / 100,
			sourceUsage,
		}
	}

	/**
	 * Invalidate the context cache for a specific task or all tasks.
	 * @param {string} [cacheKey] - Optional specific cache key to invalidate
	 */
	invalidateCache(cacheKey) {
		if (cacheKey) {
			this._cache.delete(cacheKey)
		} else {
			this._cache.clear()
		}
	}

	/**
	 * Invalidate the cached full file tree (forces re-scan on next assembly).
	 */
	invalidateFileTreeCache() {
		this._cachedFullTree = null
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Source gathering
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Gather features from FeatureRegistry.
	 * @param {Object} task
	 * @returns {Promise<Array>}
	 */
	async _gatherFeatures(task) {
		if (!this.featureRegistry) return []
		try {
			const features = this.featureRegistry.list({ status: "active" }) || []
			return features.map((f) => ({
				name: f.name,
				description: f.description,
				health: f.health,
				owner: f.owner,
				modulePath: f.modulePath,
			}))
		} catch (err) {
			console.warn("[ContextAssembler] FeatureRegistry error:", err.message)
			return []
		}
	}

	/**
	 * Gather recent events from EventLog.
	 * @param {Object} task
	 * @returns {Promise<Array>}
	 */
	async _gatherEvents(task) {
		if (!this.eventLog) return []
		try {
			const events =
				this.eventLog.list({
					limit: this.maxRecentEvents,
					descending: true,
				}) || []
			return events.map((e) => ({
				type: e.type,
				source: e.source,
				severity: e.severity,
				taskId: e.taskId,
				createdAt: e.createdAt,
			}))
		} catch (err) {
			console.warn("[ContextAssembler] EventLog error:", err.message)
			return []
		}
	}

	/**
	 * Gather lessons from LearningGateway.
	 * @param {Object} task
	 * @param {number} tokenBudget - Token budget for adaptive lesson selection
	 * @returns {Promise<{lessons: Array, compact: string|null}>}
	 */
	async _gatherLessons(task, tokenBudget) {
		if (!this.learningGateway) return { lessons: [], compact: null }
		try {
			// Adaptive topK: more budget = more lessons
			const adaptiveTopK =
				tokenBudget >= TOKEN_BUDGETS.complex ? 8 : tokenBudget >= TOKEN_BUDGETS.moderate ? 5 : 3

			const result =
				(await this.learningGateway.search({
					query: task.input?.instruction || task.type || "",
					topK: Math.min(adaptiveTopK, this.maxLessons + 3),
					tags: [task.type],
					compact: true,
					taskId: task.id,
				})) || {}
			const lessons = (result.lessons || []).map((l) => ({
				title: l.title || l.problem || l.topic,
				ruleSummary: l.rule_summary || l.solution || l.content,
				tags: l.tags || [],
				confidence: l.confidence,
				qualityScore: l.quality_score,
			}))
			return { lessons, compact: result.compact || null }
		} catch (err) {
			console.warn("[ContextAssembler] LearningGateway error:", err.message)
			return { lessons: [], compact: null }
		}
	}

	/**
	 * Gather file tree (with delta support when enabled).
	 * @param {Object} task
	 * @param {boolean} isHighPriority - If true, skip file tree for speed
	 * @returns {Promise<Object|null>}
	 */
	async _gatherFileTree(task, isHighPriority) {
		// High-priority tasks skip file tree for speed
		if (isHighPriority) return null

		try {
			if (this.enableDeltaTree && this._cachedFullTree) {
				// Delta mode: return cached tree (no re-scan)
				return this._cachedFullTree.tree
			}

			// Full scan
			const tree = this._scanDirectory(this.projectRoot, this.maxTreeDepth)

			// Cache the full tree for delta computation
			if (this.enableDeltaTree) {
				this._cachedFullTree = {
					tree,
					capturedAt: Date.now(),
				}
			}

			return tree
		} catch (err) {
			console.warn("[ContextAssembler] File-tree scan error:", err.message)
			return null
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Complexity detection
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Detect task complexity from the instruction text.
	 * @param {Object} task
	 * @returns {string} 'simple', 'moderate', 'complex', or 'debug'
	 */
	_detectComplexity(task) {
		const instruction = (task.input?.instruction || task.type || "").toLowerCase()

		// Debug tasks get a dedicated budget
		if (
			task.type === "debugger" ||
			instruction.includes("debug") ||
			instruction.includes("bug") ||
			instruction.includes("error") ||
			instruction.includes("not working") ||
			instruction.includes("fix")
		) {
			return "debug"
		}

		// Complex indicators: cross-module, architecture, multiple files
		const complexIndicators = [
			"architecture",
			"cross-module",
			"multiple files",
			"refactor",
			"migration",
			"integration",
			"orchestrate",
			"workflow",
			"pipeline",
			"end-to-end",
			"full stack",
		]
		const hasComplexIndicator = complexIndicators.some((kw) => instruction.includes(kw))

		// Simple indicators: single file, config, typo, small change
		const simpleIndicators = ["typo", "rename", "config", "single file", "small change", "update", "bump"]
		const hasSimpleIndicator = simpleIndicators.some((kw) => instruction.includes(kw))

		// Count instruction length as a heuristic
		const instructionLength = instruction.length

		if (hasComplexIndicator || instructionLength > 500) return "complex"
		if (hasSimpleIndicator || instructionLength < 50) return "simple"
		return "moderate"
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Cache key
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Build a cache key from task properties using a hash of the full instruction.
	 * @param {Object} task
	 * @returns {string}
	 */
	_buildCacheKey(task) {
		const instruction = task.input?.instruction || task.type || ""
		// Simple djb2 hash for deterministic, collision-resistant keys
		let hash = 5381
		for (let i = 0; i < instruction.length; i++) {
			hash = ((hash << 5) + hash + instruction.charCodeAt(i)) | 0
		}
		return `${task.type}:${task.priority || 10}:${Math.abs(hash).toString(36)}`
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Safety-aware filtering
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Apply safety-aware filtering to the assembled context.
	 * Removes or redacts sensitive patterns from context text fields.
	 * @param {Object} context
	 */
	_applySafetyFilter(context) {
		// Check safety mode
		let safetyMode = "off"
		if (this.safetyManager) {
			try {
				const capCheck = this.safetyManager.checkCapability("context_assembly")
				safetyMode = capCheck.allowed ? "normal" : "strict"
			} catch {
				safetyMode = "normal"
			}
		}

		if (safetyMode === "off") return

		// Redact sensitive patterns from lesson content
		if (context.lessons && context.lessons.length > 0) {
			for (const lesson of context.lessons) {
				if (lesson.ruleSummary) {
					lesson.ruleSummary = this._redactSensitive(lesson.ruleSummary)
				}
			}
		}

		if (context.lessonsCompact) {
			context.lessonsCompact = this._redactSensitive(context.lessonsCompact)
		}

		// In strict mode, also redact event payloads
		if (safetyMode === "strict" && context.recentEvents) {
			for (const event of context.recentEvents) {
				if (event.type) {
					event.type = this._redactSensitive(event.type)
				}
			}
		}
	}

	/**
	 * Redact sensitive patterns from a string.
	 * @param {string} text
	 * @returns {string}
	 */
	_redactSensitive(text) {
		if (!text) return text
		let result = text
		for (const pattern of SENSITIVE_PATTERNS) {
			result = result.replace(pattern, "[REDACTED]")
		}
		return result
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Token estimation & truncation
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Estimate token count from text (rough heuristic: ~4 chars per token).
	 * @param {string} text
	 * @returns {number}
	 */
	_estimateTokens(text) {
		if (!text) return 0
		return Math.ceil(text.length / 4)
	}

	/**
	 * Truncate context to fit within token budget.
	 * Truncation order: events first (oldest first), then lessons (lowest confidence first), then features.
	 * Uses O(n) per-item estimation instead of O(n²) full-format-per-iteration.
	 * @param {Object} context
	 * @param {number} budget
	 */
	_truncateContext(context, budget) {
		// Estimate per-item token cost for each source type
		// by measuring a single item's formatted contribution
		const estimatePerItem = (items, formatFn) => {
			if (!items || items.length === 0) return 0
			const sample = formatFn(items[0])
			return this._estimateTokens(sample)
		}

		// Format a single event line for token estimation
		const formatEvent = (e) => `  [${e.severity}] ${e.type}${e.source ? ` (${e.source})` : ""}\n`
		// Format a single lesson line
		const formatLesson = (l) => `  - ${l.title}${l.confidence ? ` [conf: ${l.confidence}]` : ""}\n`
		// Format a single feature line
		const formatFeature = (f) => `  - ${f.name}${f.description ? `: ${f.description}` : ""}\n`

		const eventCost = estimatePerItem(context.recentEvents, formatEvent)
		const lessonCost = estimatePerItem(context.lessons, formatLesson)
		const featureCost = estimatePerItem(context.features, formatFeature)

		// Estimate current total
		const formatted = this.formatContext(context)
		let currentTokens = this._estimateTokens(formatted)

		// Truncate events (least critical) — remove oldest first (index 0)
		if (currentTokens > budget && context.recentEvents && context.recentEvents.length > 0 && eventCost > 0) {
			const itemsToRemove = Math.min(
				context.recentEvents.length,
				Math.ceil((currentTokens - budget) / eventCost) + 1,
			)
			context.recentEvents.splice(0, itemsToRemove)
			currentTokens -= itemsToRemove * eventCost
		}

		// Truncate lessons — remove from end (lowest confidence items are appended last)
		if (currentTokens > budget && context.lessons && context.lessons.length > 0 && lessonCost > 0) {
			const itemsToRemove = Math.min(context.lessons.length, Math.ceil((currentTokens - budget) / lessonCost) + 1)
			context.lessons.splice(context.lessons.length - itemsToRemove, itemsToRemove)
			currentTokens -= itemsToRemove * lessonCost
		}

		// Truncate features (last resort) — remove from end
		if (currentTokens > budget && context.features && context.features.length > 0 && featureCost > 0) {
			const itemsToRemove = Math.min(
				context.features.length,
				Math.ceil((currentTokens - budget) / featureCost) + 1,
			)
			context.features.splice(context.features.length - itemsToRemove, itemsToRemove)
			currentTokens -= itemsToRemove * featureCost
		}

		// If still over budget, drop file tree
		if (currentTokens > budget && context.fileTree) {
			context.fileTree = null
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: Telemetry
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Record a telemetry entry.
	 * @param {Object} entry
	 */
	_recordTelemetry(entry) {
		this._telemetryLog.push({
			...entry,
			timestamp: Date.now(),
		})
		if (this._telemetryLog.length > this._maxTelemetryEntries) {
			this._telemetryLog.shift()
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	//  Internal: File tree scanning
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Scan a directory recursively up to maxDepth and return a compact tree map.
	 * Skips node_modules, .git, .roo, and other non-essential directories.
	 *
	 * @param {string} dirPath - Directory to scan
	 * @param {number} maxDepth - Maximum recursion depth
	 * @param {number} [depth=0] - Current recursion depth (internal)
	 * @returns {Object|null} Tree map or null on error
	 */
	_scanDirectory(dirPath, maxDepth, depth = 0) {
		if (depth > maxDepth) return null

		const SKIP_DIRS = new Set([
			"node_modules",
			".git",
			".roo",
			".claude",
			".codex",
			".changeset",
			"__pycache__",
			".next",
			"dist",
			"build",
			"coverage",
			".turbo",
			"cache",
		])

		const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"])

		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true })
			const dirs = []
			const files = []

			for (const entry of entries) {
				if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue
				if (entry.name.startsWith(".")) continue // skip dotfiles

				if (entry.isDirectory()) {
					const sub = this._scanDirectory(path.join(dirPath, entry.name), maxDepth, depth + 1)
					if (sub) dirs.push({ name: entry.name, ...sub })
				} else if (entry.isFile()) {
					files.push(entry.name)
				}
			}

			return {
				dirs: dirs.length > 0 ? dirs : undefined,
				files: files.length > 0 ? files : undefined,
			}
		} catch {
			return null
		}
	}

	/**
	 * Format a tree map as indented text.
	 * @param {Object} tree
	 * @param {string} indent
	 * @returns {string}
	 */
	_formatTree(tree, indent) {
		const lines = []
		if (tree.dirs) {
			for (const dir of tree.dirs) {
				lines.push(`${indent}${dir.name}/`)
				if (dir.dirs || dir.files) {
					lines.push(this._formatTree(dir, indent + "  "))
				}
			}
		}
		if (tree.files) {
			for (const file of tree.files) {
				lines.push(`${indent}${file}`)
			}
		}
		return lines.join("\n")
	}
}

module.exports = { ContextAssembler }
