const PLACEHOLDER_PATTERN = /TODO|To be determined|Unknown|No reusable rule recorded|No lesson summary recorded/i

function normalizeText(value) {
	return String(value || "").trim()
}

function hasDurableText(value) {
	const text = normalizeText(value)
	return text.length >= 24 && !PLACEHOLDER_PATTERN.test(text)
}

class LearningPolicy {
	constructor(options = {}) {
		this.minInjectionQuality = options.minInjectionQuality ?? 0.62
		this.minPromotionQuality = options.minPromotionQuality ?? 0.78
		this.promotionSuccessThreshold = options.promotionSuccessThreshold ?? 3
	}

	evaluateLesson(lesson = {}) {
		const factors = {
			hasRule: hasDurableText(lesson.rule_summary || lesson.rule || lesson.content),
			hasSummary: hasDurableText(lesson.lesson_summary || lesson.summary || lesson.problem),
			hasFiles: Array.isArray(lesson.files) && lesson.files.length > 0,
			hasTags: Array.isArray(lesson.tags) && lesson.tags.length > 0,
			hasHighConfidence: String(lesson.confidence || "").toLowerCase() === "high",
			hasTests: Boolean(lesson.relevance_factors?.has_tests || lesson.test_result),
		}
		let qualityScore = 0.2
		if (factors.hasRule) qualityScore += 0.28
		if (factors.hasSummary) qualityScore += 0.2
		if (factors.hasFiles) qualityScore += 0.08
		if (factors.hasTags) qualityScore += 0.08
		if (factors.hasHighConfidence) qualityScore += 0.08
		if (factors.hasTests) qualityScore += 0.08
		qualityScore = Number(Math.min(1, qualityScore).toFixed(2))

		const status =
			qualityScore >= this.minPromotionQuality
				? "promotable"
				: qualityScore >= this.minInjectionQuality
					? "eligible"
					: "draft"

		return {
			qualityScore,
			status,
			factors,
			injectionEligible: status !== "draft",
		}
	}

	isInjectionEligible(lesson) {
		return this.evaluateLesson(lesson).injectionEligible
	}

	shouldStoreOutcome(input = {}) {
		return Boolean(input.task_id || input.taskId || input.raw_ref || input.lessonIds?.length || input.used_lessons)
	}

	isPromotionCandidate(lesson, usage = {}) {
		const evaluation = this.evaluateLesson(lesson)
		return (
			evaluation.qualityScore >= this.minPromotionQuality &&
			(usage.successes || 0) >= this.promotionSuccessThreshold &&
			(usage.failures || 0) === 0
		)
	}
}

module.exports = { LearningPolicy, PLACEHOLDER_PATTERN }
