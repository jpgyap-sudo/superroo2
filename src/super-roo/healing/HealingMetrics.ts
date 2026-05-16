/**
 * Super Roo — Healing Metrics.
 *
 * Tracks success/failure rates for healing actions per category and plan type.
 * Provides queryable success rates and persists metrics to a JSON file.
 *
 * Phase 1 enhancement: adds data-driven insight into which healing strategies
 * actually work, enabling continuous improvement of repair plans.
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

export interface HealingMetricsOptions {
	/** Path to persist metrics JSON. Default: <project_root>/memory/healing-metrics.json */
	persistPath?: string
	/** Whether to auto-persist after each recordOutcome call. Default: true */
	autoPersist?: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_PERSIST_PATH = path.join(process.cwd(), "memory", "healing-metrics.json")

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

	constructor(options: HealingMetricsOptions = {}) {
		this.persistPath = options.persistPath ?? DEFAULT_PERSIST_PATH
		this.autoPersist = options.autoPersist ?? true
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

		this.lastUpdated = Date.now()

		if (this.autoPersist) {
			this.persist()
		}
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
