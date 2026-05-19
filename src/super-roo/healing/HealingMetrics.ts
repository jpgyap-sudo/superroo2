/**
 * Super Roo — Healing Metrics.
 *
 * Tracks success/failure rates for healing actions per category and plan type.
 * Provides queryable success rates and persists metrics to a JSON file.
 *
 * Phase 1 enhancement: adds data-driven insight into which healing strategies
 * actually work, enabling continuous improvement of repair plans.
 *
 * Phase 2 enhancements:
 * - Trend tracking with rolling window (last N outcomes per category)
 * - Precision/recall per category
 * - Confusion matrix tracking for ML classifier evaluation
 */

import * as fs from "node:fs"
import * as path from "node:path"

import type { RootCauseCategory, RepairPlan, ExecutionResult } from "../types"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CategoryMetrics {
	successCount: number
	failureCount: number
	totalAttempts: number
}

export interface PlanTypeMetrics {
	successCount: number
	failureCount: number
	totalAttempts: number
}

export interface MetricsSnapshot {
	byCategory: Record<string, CategoryMetrics>
	byPlanType: Record<string, PlanTypeMetrics>
	overall: {
		successCount: number
		failureCount: number
		totalAttempts: number
	}
	lastUpdated: number
}

/** A single outcome record for trend analysis */
export interface OutcomeRecord {
	incidentId: string
	category: RootCauseCategory
	success: boolean
	timestamp: number
}

/** Precision and recall for a single category */
export interface PrecisionRecall {
	truePositives: number
	falsePositives: number
	falseNegatives: number
	precision: number // 0-1
	recall: number // 0-1
	f1Score: number // 0-1
}

/** Confusion matrix entry: predicted -> actual -> count */
export type ConfusionMatrix = Record<string, Record<string, number>>

export interface HealingMetricsOptions {
	/** Path to persist metrics JSON. Default: <project_root>/memory/healing-metrics.json */
	persistPath?: string
	/** Whether to auto-persist after each recordOutcome call. Default: true */
	autoPersist?: boolean
	/** Rolling window size for trend analysis. Default: 50 */
	trendWindowSize?: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_PERSIST_PATH = path.join(process.cwd(), "memory", "healing-metrics.json")
const DEFAULT_TREND_WINDOW_SIZE = 50

// ──────────────────────────────────────────────────────────────────────────────
// HealingMetrics
// ──────────────────────────────────────────────────────────────────────────────

export class HealingMetrics {
	private byCategory: Map<string, CategoryMetrics> = new Map()
	private byPlanType: Map<string, PlanTypeMetrics> = new Map()
	private overallSuccessCount = 0
	private overallFailureCount = 0
	private lastUpdated = 0
	private readonly persistPath: string
	private readonly autoPersist: boolean
	private readonly trendWindowSize: number

	/** Rolling window of recent outcomes for trend analysis */
	private outcomeHistory: OutcomeRecord[] = []

	/** Confusion matrix: predicted category -> actual category -> count */
	private confusionMatrix: ConfusionMatrix = {}

	constructor(options: HealingMetricsOptions = {}) {
		this.persistPath = options.persistPath ?? DEFAULT_PERSIST_PATH
		this.autoPersist = options.autoPersist ?? true
		this.trendWindowSize = options.trendWindowSize ?? DEFAULT_TREND_WINDOW_SIZE
		this.load()
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Public API
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Record the outcome of a healing attempt.
	 */
	recordOutcome(incidentId: string, category: RootCauseCategory, success: boolean, plan: RepairPlan): void {
		// Update category metrics
		const catKey = category
		const catMetrics = this.byCategory.get(catKey) ?? { successCount: 0, failureCount: 0, totalAttempts: 0 }
		if (success) {
			catMetrics.successCount++
		} else {
			catMetrics.failureCount++
		}
		catMetrics.totalAttempts++
		this.byCategory.set(catKey, catMetrics)

		// Update plan type metrics (based on root cause category as plan type)
		const planType = category
		const planMetrics = this.byPlanType.get(planType) ?? { successCount: 0, failureCount: 0, totalAttempts: 0 }
		if (success) {
			planMetrics.successCount++
		} else {
			planMetrics.failureCount++
		}
		planMetrics.totalAttempts++
		this.byPlanType.set(planType, planMetrics)

		// Update overall
		if (success) {
			this.overallSuccessCount++
		} else {
			this.overallFailureCount++
		}

		// Record in outcome history for trend analysis
		this.outcomeHistory.push({
			incidentId,
			category,
			success,
			timestamp: Date.now(),
		})

		// Trim history to window size
		if (this.outcomeHistory.length > this.trendWindowSize) {
			this.outcomeHistory = this.outcomeHistory.slice(-this.trendWindowSize)
		}

		this.lastUpdated = Date.now()

		if (this.autoPersist) {
			this.persist()
		}
	}

	/**
	 * Record a classification result for confusion matrix tracking.
	 * This tracks what the classifier predicted vs what the actual outcome was.
	 */
	recordClassification(predictedCategory: RootCauseCategory, actualCategory: RootCauseCategory): void {
		if (!this.confusionMatrix[predictedCategory]) {
			this.confusionMatrix[predictedCategory] = {}
		}
		const actualCount = this.confusionMatrix[predictedCategory][actualCategory] ?? 0
		this.confusionMatrix[predictedCategory][actualCategory] = actualCount + 1
	}

	/**
	 * Get the success rate for a specific category (0-1).
	 * Returns 0 if no attempts recorded.
	 */
	getSuccessRate(category: RootCauseCategory): number {
		const metrics = this.byCategory.get(category)
		if (!metrics || metrics.totalAttempts === 0) {
			return 0
		}
		return metrics.successCount / metrics.totalAttempts
	}

	/**
	 * Get the overall success rate across all categories (0-1).
	 * Returns 0 if no attempts recorded.
	 */
	getOverallSuccessRate(): number {
		const total = this.overallSuccessCount + this.overallFailureCount
		if (total === 0) {
			return 0
		}
		return this.overallSuccessCount / total
	}

	/**
	 * Get the success rate for a specific plan type (0-1).
	 * Returns 0 if no attempts recorded.
	 */
	getPlanTypeSuccessRate(planType: string): number {
		const metrics = this.byPlanType.get(planType)
		if (!metrics || metrics.totalAttempts === 0) {
			return 0
		}
		return metrics.successCount / metrics.totalAttempts
	}

	/**
	 * Get category metrics for a specific category.
	 */
	getCategoryMetrics(category: RootCauseCategory): CategoryMetrics {
		return this.byCategory.get(category) ?? { successCount: 0, failureCount: 0, totalAttempts: 0 }
	}

	/**
	 * Get all category metrics.
	 */
	getAllCategoryMetrics(): Map<string, CategoryMetrics> {
		return new Map(this.byCategory)
	}

	/**
	 * Get all plan type metrics.
	 */
	getAllPlanTypeMetrics(): Map<string, PlanTypeMetrics> {
		return new Map(this.byPlanType)
	}

	/**
	 * Get total attempts count.
	 */
	getTotalAttempts(): number {
		return this.overallSuccessCount + this.overallFailureCount
	}

	/**
	 * Get total success count.
	 */
	getTotalSuccesses(): number {
		return this.overallSuccessCount
	}

	/**
	 * Get total failure count.
	 */
	getTotalFailures(): number {
		return this.overallFailureCount
	}

	/**
	 * Get the rolling trend success rate for a category (last N outcomes).
	 * Returns 0 if no recent outcomes.
	 */
	getTrendSuccessRate(category: RootCauseCategory, windowSize?: number): number {
		const window = windowSize ?? this.trendWindowSize
		const recent = this.outcomeHistory.filter((o) => o.category === category).slice(-window)

		if (recent.length === 0) return 0

		const successes = recent.filter((o) => o.success).length
		return successes / recent.length
	}

	/**
	 * Get the overall rolling trend success rate (last N outcomes across all categories).
	 */
	getOverallTrendRate(windowSize?: number): number {
		const window = windowSize ?? this.trendWindowSize
		const recent = this.outcomeHistory.slice(-window)

		if (recent.length === 0) return 0

		const successes = recent.filter((o) => o.success).length
		return successes / recent.length
	}

	/**
	 * Check if a category's trend is improving (trend rate > overall rate).
	 * Returns null if insufficient data.
	 */
	isTrendImproving(category: RootCauseCategory): boolean | null {
		const trendRate = this.getTrendSuccessRate(category)
		const overallRate = this.getSuccessRate(category)

		if (trendRate === 0 && overallRate === 0) return null
		if (overallRate === 0) return trendRate > 0

		return trendRate > overallRate
	}

	/**
	 * Get precision and recall for a specific category.
	 * Uses the confusion matrix to calculate.
	 */
	getPrecisionRecall(category: RootCauseCategory): PrecisionRecall {
		// True positives: predicted this category AND actual was this category
		const truePositives = this.confusionMatrix[category]?.[category] ?? 0

		// False positives: predicted this category BUT actual was something else
		let falsePositives = 0
		if (this.confusionMatrix[category]) {
			for (const [actual, count] of Object.entries(this.confusionMatrix[category])) {
				if (actual !== category) {
					falsePositives += count
				}
			}
		}

		// False negatives: actual was this category BUT predicted something else
		let falseNegatives = 0
		for (const [predicted, actuals] of Object.entries(this.confusionMatrix)) {
			if (predicted !== category) {
				falseNegatives += actuals[category] ?? 0
			}
		}

		const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0

		const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0

		const f1Score = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0

		return {
			truePositives,
			falsePositives,
			falseNegatives,
			precision,
			recall,
			f1Score,
		}
	}

	/**
	 * Get the full confusion matrix.
	 */
	getConfusionMatrix(): ConfusionMatrix {
		return JSON.parse(JSON.stringify(this.confusionMatrix))
	}

	/**
	 * Get the recent outcome history for analysis.
	 */
	getOutcomeHistory(): OutcomeRecord[] {
		return [...this.outcomeHistory]
	}

	/**
	 * Take a snapshot of current metrics for reporting.
	 */
	snapshot(): MetricsSnapshot {
		const byCategory: Record<string, CategoryMetrics> = {}
		for (const [key, value] of this.byCategory) {
			byCategory[key] = { ...value }
		}

		const byPlanType: Record<string, PlanTypeMetrics> = {}
		for (const [key, value] of this.byPlanType) {
			byPlanType[key] = { ...value }
		}

		return {
			byCategory,
			byPlanType,
			overall: {
				successCount: this.overallSuccessCount,
				failureCount: this.overallFailureCount,
				totalAttempts: this.overallSuccessCount + this.overallFailureCount,
			},
			lastUpdated: this.lastUpdated,
		}
	}

	/**
	 * Reset all metrics (in-memory and persisted).
	 */
	reset(): void {
		this.byCategory.clear()
		this.byPlanType.clear()
		this.overallSuccessCount = 0
		this.overallFailureCount = 0
		this.lastUpdated = 0
		this.outcomeHistory = []
		this.confusionMatrix = {}
		this.persist()
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Persistence
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Persist metrics to JSON file.
	 */
	persist(): void {
		try {
			const dir = path.dirname(this.persistPath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}

			const data = this.snapshot()
			fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8")
		} catch {
			// Silently fail — metrics persistence should never crash the healing system
		}
	}

	/**
	 * Load metrics from JSON file.
	 */
	private load(): void {
		try {
			if (!fs.existsSync(this.persistPath)) {
				return
			}

			const raw = fs.readFileSync(this.persistPath, "utf-8")
			const data = JSON.parse(raw) as MetricsSnapshot

			// Restore category metrics
			for (const [key, value] of Object.entries(data.byCategory)) {
				this.byCategory.set(key, value)
			}

			// Restore plan type metrics
			for (const [key, value] of Object.entries(data.byPlanType)) {
				this.byPlanType.set(key, value)
			}

			// Restore overall
			this.overallSuccessCount = data.overall.successCount
			this.overallFailureCount = data.overall.failureCount
			this.lastUpdated = data.lastUpdated
		} catch {
			// Silently fail — start with fresh metrics if file is corrupted
		}
	}
}
