const fs = require("fs/promises")
const path = require("path")
const { LearningPolicy } = require("./LearningPolicy")

function compactLessons(lessons, maxChars = 1800) {
	const body = lessons
		.map(
			(lesson, index) =>
				`${index + 1}. ${lesson.title || lesson.problem || lesson.topic}\n   Rule: ${
					lesson.rule_summary || lesson.solution || lesson.content || "No rule recorded."
				}\n   Tags: ${(lesson.tags || []).join(", ") || "none"}`,
		)
		.join("\n\n")
	return `Relevant Lessons:\n${body}`.slice(0, maxChars)
}

class LearningGateway {
	constructor(options = {}) {
		this.hermesClaw = options.hermesClaw || null
		this.projectRoot = options.projectRoot || process.env.SUPERROO_ROOT || process.cwd()
		this.lessonIndexPath = options.lessonIndexPath || path.join(this.projectRoot, "memory", "lesson-index.jsonl")
		this.eventsPath = options.eventsPath || path.join(this.projectRoot, "memory", "learning-events.jsonl")
		this.curationPath = options.curationPath || path.join(this.projectRoot, "memory", "lesson-curation.jsonl")
		this.promotionPath =
			options.promotionPath || path.join(this.projectRoot, "memory", "skill-promotion-candidates.jsonl")
		this.policy = options.policy || new LearningPolicy()
	}

	async _readLocalLessons() {
		try {
			const raw = await fs.readFile(this.lessonIndexPath, "utf8")
			const lessons = raw
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => JSON.parse(line))
			return this._applyCuration(lessons, await this._readCuration())
		} catch {
			return []
		}
	}

	async _readCuration() {
		try {
			const raw = await fs.readFile(this.curationPath, "utf8")
			return raw
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		} catch {
			return []
		}
	}

	_applyCuration(lessons, entries) {
		const latestByLesson = new Map()
		for (const entry of entries) {
			latestByLesson.set(entry.lesson_id, entry)
		}
		return lessons.map((lesson) => {
			const curation = latestByLesson.get(lesson.id)
			if (!curation) return lesson
			return {
				...lesson,
				...(curation.rule_summary ? { rule_summary: curation.rule_summary } : {}),
				...(curation.lesson_summary ? { lesson_summary: curation.lesson_summary } : {}),
				...(curation.tags ? { tags: curation.tags } : {}),
				manual_policy_status: curation.action === "approve" ? curation.policy_status || "eligible" : undefined,
				curation_action: curation.action,
				curation_note: curation.note || null,
				merged_into: curation.action === "merge" ? curation.target_lesson_id : null,
				curated_at: curation.created_at,
			}
		})
	}

	async _appendEvent(event) {
		await fs.mkdir(path.dirname(this.eventsPath), { recursive: true })
		await fs.appendFile(
			this.eventsPath,
			`${JSON.stringify({ created_at: new Date().toISOString(), ...event })}\n`,
			"utf8",
		)
	}

	async _readEvents() {
		try {
			const raw = await fs.readFile(this.eventsPath, "utf8")
			return raw
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		} catch {
			return []
		}
	}

	_buildUsageStats(events) {
		const usage = new Map()
		const taskLessons = new Map()
		for (const event of events) {
			if (event.event_type === "lesson_search") {
				const taskId = event.payload?.task_id
				const lessonIds = event.payload?.lesson_ids || []
				if (taskId && lessonIds.length) taskLessons.set(taskId, lessonIds)
				for (const id of lessonIds) {
					const current = usage.get(id) || { recalls: 0, successes: 0, failures: 0, partials: 0 }
					current.recalls += 1
					usage.set(id, current)
				}
			}
			if (event.event_type === "readiness_score") {
				const lessonIds = event.payload?.lesson_ids || taskLessons.get(event.payload?.task_id) || []
				for (const id of lessonIds) {
					const current = usage.get(id) || { recalls: 0, successes: 0, failures: 0, partials: 0 }
					if (event.payload?.outcome === "success") current.successes += 1
					else if (event.payload?.outcome === "partial") current.partials += 1
					else if (event.payload?.outcome === "failure") current.failures += 1
					usage.set(id, current)
				}
			}
		}
		return usage
	}

	_rankLocalLessons(lessons, query, tags = [], filePaths = [], usageStats = new Map()) {
		const needles = query.toLowerCase().split(/\W+/).filter(Boolean)
		return lessons
			.map((lesson) => {
				const haystack =
					`${lesson.title} ${lesson.rule_summary} ${lesson.lesson_summary} ${(lesson.tags || []).join(" ")} ${(lesson.files || []).join(" ")}`.toLowerCase()
				const lexical = needles.reduce((score, needle) => score + (haystack.includes(needle) ? 1 : 0), 0)
				const tagBoost = tags.length > 0 && tags.some((tag) => lesson.tags?.includes(tag)) ? 2 : 0
				const fileBoost =
					filePaths.length > 0 && filePaths.some((filePath) => lesson.files?.includes(filePath)) ? 1.5 : 0
				const evaluation = this.policy.evaluateLesson(lesson)
				const policyStatus = lesson.manual_policy_status || evaluation.status
				const usage = usageStats.get(lesson.id) || { recalls: 0, successes: 0, failures: 0, partials: 0 }
				const successBoost = usage.successes * 0.75 + usage.partials * 0.25 - usage.failures * 0.75
				return {
					...lesson,
					quality_score: evaluation.qualityScore,
					policy_status: policyStatus,
					usage,
					score:
						lexical +
						tagBoost +
						fileBoost +
						(lesson.relevance_score || 0) +
						evaluation.qualityScore +
						successBoost,
				}
			})
			.filter(
				(lesson) =>
					lesson.score > 0 &&
					lesson.curation_action !== "retire" &&
					lesson.curation_action !== "merge" &&
					(lesson.manual_policy_status || this.policy.isInjectionEligible(lesson)),
			)
			.sort((a, b) => b.score - a.score)
	}

	_dedupeLessons(lessons) {
		const seen = new Set()
		return lessons.filter((lesson) => {
			const key = lesson.id || `${lesson.title || lesson.topic}:${lesson.rule_summary || lesson.content}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	}

	async search({ query, topK = 3, tags = [], filePaths = [], compact = true, taskId = null }) {
		const events = await this._readEvents()
		const usageStats = this._buildUsageStats(events)
		const localLessons = this._rankLocalLessons(
			await this._readLocalLessons(),
			query,
			tags,
			filePaths,
			usageStats,
		).slice(0, topK)
		let ragLessons = []

		if (this.hermesClaw?.bugKnowledgeStore) {
			try {
				ragLessons = await this.hermesClaw.bugKnowledgeStore.searchLessons(query, {
					limit: topK,
					threshold: 0.5,
				})
			} catch {
				ragLessons = []
			}
		}

		const lessons = this._dedupeLessons([...localLessons, ...ragLessons]).slice(0, topK)
		const compactText = compact ? compactLessons(lessons) : undefined
		await this._appendEvent({
			event_type: "lesson_search",
			payload: {
				query,
				topK,
				returned: lessons.length,
				task_id: taskId,
				tags,
				file_paths: filePaths,
				lesson_ids: lessons.map((lesson) => lesson.id).filter(Boolean),
			},
		})
		return { lessons, compact: compactText }
	}

	async store(input) {
		let stored = null
		if (this.hermesClaw) {
			stored = await this.hermesClaw.storeLesson({
				lesson_type: input.task_type || "best_practice",
				topic: input.problem,
				content: [input.root_cause, input.solution].filter(Boolean).join("\n"),
				source_task_id: input.raw_ref || null,
				project: input.project || "superroo2",
				metadata: input,
			})
		}
		await this._appendEvent({
			event_type: "lesson_store",
			payload: {
				...input,
				quality: this.policy.evaluateLesson({
					rule_summary: input.solution,
					lesson_summary: input.root_cause,
					files: input.files,
					tags: input.tags,
					confidence: input.confidence,
				}),
			},
		})
		return stored || { success: false, id: null }
	}

	async score(input) {
		const score = Math.max(
			0,
			Math.min(
				100,
				(input.outcome === "success" ? 70 : input.outcome === "partial" ? 45 : 15) +
					Math.min(20, (input.used_lessons || 0) * 4),
			),
		)
		if (this.policy.shouldStoreOutcome(input)) {
			await this._appendEvent({
				event_type: "readiness_score",
				payload: {
					...input,
					task_id: input.task_id || input.taskId || null,
					lesson_ids: input.lessonIds || input.lesson_ids || [],
					score,
				},
			})
			await this._writePromotionCandidates()
		}
		return score
	}

	async curate(input) {
		const lessons = await this._readLocalLessons()
		const lesson = lessons.find((entry) => entry.id === input.lesson_id)
		if (!lesson) throw new Error(`Lesson not found: ${input.lesson_id}`)
		if (!["approve", "retire", "merge"].includes(input.action)) {
			throw new Error("action must be approve, retire, or merge")
		}
		if (input.action === "merge") {
			if (!input.target_lesson_id) throw new Error("target_lesson_id is required for merge")
			if (!lessons.some((entry) => entry.id === input.target_lesson_id)) {
				throw new Error(`Merge target not found: ${input.target_lesson_id}`)
			}
		}
		const entry = {
			lesson_id: input.lesson_id,
			action: input.action,
			target_lesson_id: input.target_lesson_id || null,
			policy_status: input.policy_status || null,
			rule_summary: input.rule_summary || null,
			lesson_summary: input.lesson_summary || null,
			tags: Array.isArray(input.tags) ? input.tags : null,
			note: input.note || null,
			actor: input.actor || "dashboard",
			created_at: new Date().toISOString(),
		}
		await fs.mkdir(path.dirname(this.curationPath), { recursive: true })
		await fs.appendFile(this.curationPath, `${JSON.stringify(entry)}\n`, "utf8")
		await this._appendEvent({ event_type: "lesson_curated", payload: entry })
		return entry
	}

	async getRecentEvents(limit = 12) {
		try {
			return (await this._readEvents()).slice(-limit).reverse()
		} catch {
			return []
		}
	}

	async getOperationalStats() {
		const [lessons, events] = await Promise.all([this._readLocalLessons(), this._readEvents()])
		const usageStats = this._buildUsageStats(events)
		const evaluated = lessons.map((lesson) => {
			const evaluation = this.policy.evaluateLesson(lesson)
			return {
				...lesson,
				...evaluation,
				status: lesson.manual_policy_status || evaluation.status,
				injectionEligible:
					lesson.curation_action !== "retire" &&
					lesson.curation_action !== "merge" &&
					Boolean(lesson.manual_policy_status || evaluation.injectionEligible),
				usage: usageStats.get(lesson.id) || { recalls: 0, successes: 0, failures: 0, partials: 0 },
			}
		})
		const curationQueue = evaluated.filter((lesson) => lesson.status === "draft")
		const topLessons = evaluated
			.filter((lesson) => lesson.injectionEligible)
			.sort(
				(a, b) =>
					b.usage.successes - a.usage.successes ||
					b.qualityScore - a.qualityScore ||
					(b.relevance_score || 0) - (a.relevance_score || 0),
			)
			.slice(0, 5)
		// "Dead" = recalled at least once but never succeeded (persistent failures)
		const deadLessons = evaluated
			.filter((lesson) => lesson.usage.recalls > 0 && lesson.usage.successes === 0)
			.sort((a, b) => b.usage.recalls - a.usage.recalls)
			.slice(0, 8)
		const failedAfterRecall = evaluated
			.filter((lesson) => lesson.usage.failures > 0)
			.sort((a, b) => b.usage.failures - a.usage.failures)
			.slice(0, 8)
		const promotionCandidates = evaluated.filter((lesson) => this.policy.isPromotionCandidate(lesson, lesson.usage))
		return {
			recentEvents: events.slice(-12).reverse(),
			searches: events.filter((event) => event.event_type === "lesson_search").length,
			stores: events.filter((event) => event.event_type === "lesson_store").length,
			scores: events.filter((event) => event.event_type === "readiness_score").length,
			curations: events.filter((event) => event.event_type === "lesson_curated").length,
			curationQueue: curationQueue.slice(0, 8),
			topLessons,
			deadLessons,
			failedAfterRecall,
			promotionCandidates,
		}
	}

	async _writePromotionCandidates() {
		const stats = await this.getOperationalStats()
		await fs.mkdir(path.dirname(this.promotionPath), { recursive: true })
		const lines = stats.promotionCandidates.map((lesson) =>
			JSON.stringify({
				id: lesson.id,
				title: lesson.title,
				rule_summary: lesson.rule_summary,
				quality_score: lesson.qualityScore,
				usage: lesson.usage,
				created_at: new Date().toISOString(),
			}),
		)
		await fs.writeFile(this.promotionPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8")
	}
}

module.exports = { LearningGateway, compactLessons }
