/**
 * HypothesisEngine — Critical Thinking & Assumption Management
 *
 * Manages the scientific method loop for the Super Debug Team:
 *   1. Formulate hypothesis about what's wrong / what needs to change
 *   2. Identify explicit assumptions with risk levels
 *   3. Track evidence for/against each hypothesis
 *   4. Refine hypotheses based on failure evidence
 *   5. Escalate when confidence drops below threshold
 *
 * Each hypothesis carries assumptions that must be verified before
 * the hypothesis can be accepted. Failed attempts generate evidence
 * that refines the next hypothesis.
 */

import { EventEmitter } from "events"

// ─── Types ───────────────────────────────────────────────────────────────────

export type HypothesisStatus =
	| "active"
	| "verified"
	| "falsified"
	| "superseded"
	| "inconclusive"

export type AssumptionStatus =
	| "unverified"
	| "verified"
	| "falsified"
	| "unknown"

export type AssumptionCategory =
	| "architecture"
	| "data"
	| "dependency"
	| "behavior"
	| "environment"
	| "integration"
	| "performance"
	| "security"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export interface Assumption {
	id: string
	description: string
	category: AssumptionCategory
	risk: RiskLevel
	verificationStrategy: string
	rollbackStrategy: string
	status: AssumptionStatus
	evidenceFor: string[]
	evidenceAgainst: string[]
	verifiedAt?: number
	falsifiedAt?: number
}

export interface Hypothesis {
	id: string
	attempt: number
	description: string
	assumptions: Assumption[]
	confidence: number
	status: HypothesisStatus
	evidenceFor: string[]
	evidenceAgainst: string[]
	createdAt: number
	resolvedAt?: number
	supersededBy?: string
}

export interface HypothesisEngineConfig {
	confidenceThreshold: number
	confidenceDecayPerFailure: number
	maxAssumptionsPerHypothesis: number
	enableAutoVerification: boolean
}

export interface HypothesisInput {
	goal: string
	phases: Array<{ id: string; title: string; description: string }>
	repo: string
}

export interface RefineInput {
	previousHypothesis: Hypothesis
	failureReason: string
	attempt: number
	lessons: Array<{
		id: string
		failureType: string
		rootCause: string
		filesInvolved: string[]
	}>
}

export interface HypothesisResult {
	hypothesis: Hypothesis
	confidence: number
	recommendation: "proceed" | "refine" | "escalate" | "abandon"
	unverifiedAssumptions: Assumption[]
	criticalAssumptions: Assumption[]
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface HypothesisEngineEvents {
	"hypothesis:created": (hypothesis: Hypothesis) => void
	"hypothesis:verified": (hypothesis: Hypothesis) => void
	"hypothesis:falsified": (hypothesis: Hypothesis, evidence: string[]) => void
	"hypothesis:superseded": (old: Hypothesis, next: Hypothesis) => void
	"assumption:verified": (assumption: Assumption) => void
	"assumption:falsified": (assumption: Assumption, evidence: string[]) => void
	"confidence:updated": (hypothesisId: string, oldConfidence: number, newConfidence: number) => void
	"escalation:triggered": (hypothesis: Hypothesis, reason: string) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class HypothesisEngine {
	private config: HypothesisEngineConfig
	private emitter: EventEmitter
	private hypotheses: Map<string, Hypothesis> = new Map()
	private assumptionTemplates: Map<AssumptionCategory, string[]> = new Map()

	constructor(config?: Partial<HypothesisEngineConfig>) {
		this.config = {
			confidenceThreshold: config?.confidenceThreshold ?? 0.7,
			confidenceDecayPerFailure: config?.confidenceDecayPerFailure ?? 0.15,
			maxAssumptionsPerHypothesis: config?.maxAssumptionsPerHypothesis ?? 8,
			enableAutoVerification: config?.enableAutoVerification ?? true,
		}
		this.emitter = new EventEmitter()

		this.initializeAssumptionTemplates()
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof HypothesisEngineEvents>(
		event: K,
		listener: HypothesisEngineEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof HypothesisEngineEvents>(
		event: K,
		listener: HypothesisEngineEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof HypothesisEngineEvents>(
		event: K,
		...args: Parameters<HypothesisEngineEvents[K]>
	): void {
		this.emitter.emit(event, ...(args as unknown[]))
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Create an initial hypothesis for a debug job.
	 * Generates assumptions based on the goal, phases, and repo context.
	 */
	createHypothesis(input: HypothesisInput): Hypothesis {
		const assumptions = this.generateAssumptions(input)

		const hypothesis: Hypothesis = {
			id: this.generateId(),
			attempt: 1,
			description: this.buildHypothesisDescription(input),
			assumptions,
			confidence: 0.85, // Start with high confidence, will be refined
			status: "active",
			evidenceFor: [],
			evidenceAgainst: [],
			createdAt: Date.now(),
		}

		this.hypotheses.set(hypothesis.id, hypothesis)
		this.emit("hypothesis:created", hypothesis)

		return hypothesis
	}

	/**
	 * Refine a hypothesis based on failure evidence.
	 * Reduces confidence, falsifies relevant assumptions, and generates
	 * a new hypothesis for the next attempt.
	 */
	refineHypothesis(input: RefineInput): Hypothesis {
		const prev = input.previousHypothesis

		// Mark previous as superseded
		prev.status = "superseded"
		prev.resolvedAt = Date.now()

		// Calculate new confidence
		const oldConfidence = prev.confidence
		const newConfidence = Math.max(
			0.1,
			prev.confidence - this.config.confidenceDecayPerFailure,
		)

		this.emit("confidence:updated", prev.id, oldConfidence, newConfidence)

		// Falsify assumptions related to the failure
		const falsifiedAssumptions = this.falsifyRelatedAssumptions(
			prev,
			input.failureReason,
			input.lessons,
		)

		// Generate new assumptions based on lessons learned
		const newAssumptions = this.generateRefinedAssumptions(
			prev,
			input.failureReason,
			input.lessons,
			falsifiedAssumptions,
		)

		// Build evidence from lessons
		const evidenceAgainst = [
			...prev.evidenceAgainst,
			`Attempt ${input.attempt}: ${input.failureReason}`,
		]

		const hypothesis: Hypothesis = {
			id: this.generateId(),
			attempt: input.attempt + 1,
			description: this.buildRefinedDescription(prev, input.failureReason, input.lessons),
			assumptions: newAssumptions,
			confidence: newConfidence,
			status: "active",
			evidenceFor: [],
			evidenceAgainst,
			createdAt: Date.now(),
			supersededBy: prev.id,
		}

		this.hypotheses.set(hypothesis.id, hypothesis)
		this.emit("hypothesis:superseded", prev, hypothesis)

		// Check if we need to escalate
		if (newConfidence < 0.3) {
			this.emit(
				"escalation:triggered",
				hypothesis,
				`Confidence dropped to ${newConfidence.toFixed(2)} — below escalation threshold`,
			)
		}

		return hypothesis
	}

	/**
	 * Verify a specific assumption with evidence.
	 */
	verifyAssumption(
		hypothesisId: string,
		assumptionId: string,
		evidence: string,
		verified: boolean,
	): boolean {
		const hypothesis = this.hypotheses.get(hypothesisId)
		if (!hypothesis) return false

		const assumption = hypothesis.assumptions.find((a) => a.id === assumptionId)
		if (!assumption) return false

		if (verified) {
			assumption.status = "verified"
			assumption.evidenceFor.push(evidence)
			assumption.verifiedAt = Date.now()
			hypothesis.evidenceFor.push(evidence)
			this.emit("assumption:verified", assumption)
		} else {
			assumption.status = "falsified"
			assumption.evidenceAgainst.push(evidence)
			assumption.falsifiedAt = Date.now()
			hypothesis.evidenceAgainst.push(evidence)
			this.emit("assumption:falsified", assumption, [evidence])
		}

		// Recalculate confidence
		this.recalculateConfidence(hypothesis)

		// Check if all assumptions are verified
		if (hypothesis.assumptions.every((a) => a.status === "verified")) {
			hypothesis.status = "verified"
			hypothesis.resolvedAt = Date.now()
			this.emit("hypothesis:verified", hypothesis)
		}

		return true
	}

	/**
	 * Get the current evaluation of a hypothesis.
	 */
	evaluateHypothesis(hypothesisId: string): HypothesisResult | null {
		const hypothesis = this.hypotheses.get(hypothesisId)
		if (!hypothesis) return null

		const unverifiedAssumptions = hypothesis.assumptions.filter(
			(a) => a.status === "unverified" || a.status === "unknown",
		)
		const criticalAssumptions = hypothesis.assumptions.filter(
			(a) => a.risk === "critical" && a.status !== "verified",
		)

		let recommendation: HypothesisResult["recommendation"] = "proceed"

		if (criticalAssumptions.length > 0) {
			recommendation = "refine"
		}
		if (hypothesis.confidence < this.config.confidenceThreshold) {
			recommendation = "refine"
		}
		if (hypothesis.confidence < 0.3) {
			recommendation = "escalate"
		}
		if (hypothesis.confidence < 0.1) {
			recommendation = "abandon"
		}

		return {
			hypothesis,
			confidence: hypothesis.confidence,
			recommendation,
			unverifiedAssumptions,
			criticalAssumptions,
		}
	}

	/**
	 * Get a hypothesis by ID.
	 */
	getHypothesis(id: string): Hypothesis | undefined {
		return this.hypotheses.get(id)
	}

	/**
	 * List all hypotheses for a given attempt range.
	 */
	listHypotheses(): Hypothesis[] {
		return Array.from(this.hypotheses.values())
	}

	/**
	 * Reset the engine state.
	 */
	reset(): void {
		this.hypotheses.clear()
	}

	// ── Private: Assumption Generation ──────────────────────────────────────

	private initializeAssumptionTemplates(): void {
		this.assumptionTemplates.set("architecture", [
			"The existing architecture supports this change without major refactoring",
			"The component/module boundaries are correctly identified",
			"No architectural conflicts with existing features",
			"The change follows the established design patterns",
		])

		this.assumptionTemplates.set("data", [
			"The data model supports the required operations",
			"Data validation rules are correctly understood",
			"Edge cases in data are handled appropriately",
			"Data migration is not required or is straightforward",
		])

		this.assumptionTemplates.set("dependency", [
			"All required dependencies are available and compatible",
			"No version conflicts with existing dependencies",
			"External APIs/services are available and stable",
			"The dependency graph is correctly understood",
		])

		this.assumptionTemplates.set("behavior", [
			"The expected behavior is correctly understood",
			"User interactions follow the expected flow",
			"Error states are handled correctly",
			"The behavior is consistent across supported environments",
		])

		this.assumptionTemplates.set("environment", [
			"The development/production environment is correctly configured",
			"Environment variables and secrets are properly set up",
			"The runtime environment supports all required features",
			"No platform-specific issues will arise",
		])

		this.assumptionTemplates.set("integration", [
			"The integration points are correctly identified",
			"Interfaces between components are compatible",
			"No breaking changes to existing integrations",
			"The integration can be tested in isolation",
		])

		this.assumptionTemplates.set("performance", [
			"The change does not introduce significant performance regressions",
			"Resource usage remains within acceptable limits",
			"Scaling characteristics are understood",
			"Performance testing covers the critical paths",
		])

		this.assumptionTemplates.set("security", [
			"The change does not introduce security vulnerabilities",
			"Input validation is properly implemented",
			"Authentication/authorization is correctly handled",
			"Sensitive data is properly protected",
		])
	}

	private generateAssumptions(input: HypothesisInput): Assumption[] {
		const assumptions: Assumption[] = []
		const categories: AssumptionCategory[] = [
			"architecture",
			"behavior",
			"dependency",
			"integration",
		]

		// Add domain-specific categories based on goal
		if (input.goal.toLowerCase().includes("data") || input.goal.toLowerCase().includes("database")) {
			categories.push("data")
		}
		if (input.goal.toLowerCase().includes("deploy") || input.goal.toLowerCase().includes("config")) {
			categories.push("environment")
		}
		if (input.goal.toLowerCase().includes("performance") || input.goal.toLowerCase().includes("speed")) {
			categories.push("performance")
		}
		if (input.goal.toLowerCase().includes("auth") || input.goal.toLowerCase().includes("security")) {
			categories.push("security")
		}

		for (const category of categories) {
			const templates = this.assumptionTemplates.get(category) || []
			const selected = templates.slice(0, 2) // Max 2 per category

			for (const template of selected) {
				if (assumptions.length >= this.config.maxAssumptionsPerHypothesis) break

				assumptions.push({
					id: this.generateId(),
					description: template,
					category,
					risk: this.assessRisk(category, template),
					verificationStrategy: this.buildVerificationStrategy(category, template),
					rollbackStrategy: this.buildRollbackStrategy(category, template),
					status: "unverified",
					evidenceFor: [],
					evidenceAgainst: [],
				})
			}

			if (assumptions.length >= this.config.maxAssumptionsPerHypothesis) break
		}

		return assumptions
	}

	private generateRefinedAssumptions(
		prevHypothesis: Hypothesis,
		failureReason: string,
		lessons: Array<{ failureType: string; rootCause: string; filesInvolved: string[] }>,
		falsifiedAssumptions: Assumption[],
	): Assumption[] {
		const newAssumptions: Assumption[] = []

		// Keep assumptions that weren't falsified
		for (const assumption of prevHypothesis.assumptions) {
			if (assumption.status !== "falsified" && assumption.status !== "unknown") {
				newAssumptions.push({ ...assumption })
			}
		}

		// Add new assumptions based on failure analysis
		const failureCategories = this.analyzeFailureCategories(failureReason, lessons)

		for (const category of failureCategories) {
			const templates = this.assumptionTemplates.get(category) || []
			const newTemplate = templates.find(
				(t) =>
					!prevHypothesis.assumptions.some((a) => a.description === t),
			)

			if (newTemplate && newAssumptions.length < this.config.maxAssumptionsPerHypothesis) {
				newAssumptions.push({
					id: this.generateId(),
					description: newTemplate,
					category,
					risk: "high", // New assumptions from failures start at high risk
					verificationStrategy: this.buildVerificationStrategy(category, newTemplate),
					rollbackStrategy: this.buildRollbackStrategy(category, newTemplate),
					status: "unverified",
					evidenceFor: [],
					evidenceAgainst: [],
				})
			}
		}

		// Add specific assumption about the failure
		if (newAssumptions.length < this.config.maxAssumptionsPerHypothesis) {
			newAssumptions.push({
				id: this.generateId(),
				description: `The root cause "${failureReason}" has been correctly identified and addressed`,
				category: "behavior",
				risk: "critical",
				verificationStrategy: `Verify that the fix for "${failureReason}" resolves the issue without side effects`,
				rollbackStrategy: "Rollback to last known good snapshot if this assumption is wrong",
				status: "unverified",
				evidenceFor: [],
				evidenceAgainst: [],
			})
		}

		return newAssumptions
	}

	private falsifyRelatedAssumptions(
		hypothesis: Hypothesis,
		failureReason: string,
		lessons: Array<{ failureType: string; rootCause: string; filesInvolved: string[] }>,
	): Assumption[] {
		const falsified: Assumption[] = []

		for (const assumption of hypothesis.assumptions) {
			// Check if this assumption is related to the failure
			const isRelated =
				assumption.category === this.categorizeFailure(failureReason) ||
				lessons.some(
					(l) =>
						l.failureType.toLowerCase().includes(assumption.category) ||
						assumption.description.toLowerCase().includes(l.rootCause.toLowerCase()),
				)

			if (isRelated && assumption.status !== "verified") {
				assumption.status = "falsified"
				assumption.evidenceAgainst.push(
					`Falsified by failure: ${failureReason}`,
				)
				assumption.falsifiedAt = Date.now()
				falsified.push(assumption)
			}
		}

		return falsified
	}

	// ── Private: Analysis ───────────────────────────────────────────────────

	private buildHypothesisDescription(input: HypothesisInput): string {
		const phaseNames = input.phases.map((p) => p.title).join(" → ")
		return `Implement "${input.goal}" via ${phaseNames} in ${input.repo}`
	}

	private buildRefinedDescription(
		prev: Hypothesis,
		failureReason: string,
		lessons: Array<{ failureType: string; rootCause: string }>,
	): string {
		const lessonSummary = lessons
			.slice(-3)
			.map((l) => `${l.failureType}: ${l.rootCause}`)
			.join("; ")

		return `${prev.description} [refined after: ${failureReason} — lessons: ${lessonSummary}]`
	}

	private assessRisk(category: AssumptionCategory, _template: string): RiskLevel {
		switch (category) {
			case "security":
			case "architecture":
				return "high"
			case "integration":
			case "performance":
				return "medium"
			case "data":
			case "dependency":
			case "behavior":
			case "environment":
				return "low"
		}
	}

	private buildVerificationStrategy(
		category: AssumptionCategory,
		description: string,
	): string {
		switch (category) {
			case "architecture":
				return `Code review and architecture analysis: ${description}`
			case "data":
				return `Data validation tests and schema checks: ${description}`
			case "dependency":
				return `Dependency resolution check and version compatibility test: ${description}`
			case "behavior":
				return `Unit/integration tests covering expected behavior: ${description}`
			case "environment":
				return `Environment configuration validation: ${description}`
			case "integration":
				return `Integration test suite for affected interfaces: ${description}`
			case "performance":
				return `Performance benchmark before and after change: ${description}`
			case "security":
				return `Security audit and penetration test: ${description}`
		}
	}

	private buildRollbackStrategy(
		category: AssumptionCategory,
		_description: string,
	): string {
		switch (category) {
			case "architecture":
				return "Revert architectural changes and restore previous structure"
			case "data":
				return "Restore data to pre-change state from backup/snapshot"
			case "dependency":
				return "Revert dependency changes to previous versions"
			case "behavior":
				return "Revert behavioral changes to previous implementation"
			case "environment":
				return "Restore environment configuration from snapshot"
			case "integration":
				return "Revert integration changes and restore previous interfaces"
			case "performance":
				return "Revert performance-related changes"
			case "security":
				return "Immediately revert security changes and audit"
		}
	}

	private categorizeFailure(failureReason: string): AssumptionCategory {
		const lower = failureReason.toLowerCase()
		if (lower.includes("architect") || lower.includes("design")) return "architecture"
		if (lower.includes("data") || lower.includes("schema") || lower.includes("database")) return "data"
		if (lower.includes("dep") || lower.includes("version") || lower.includes("import")) return "dependency"
		if (lower.includes("test") || lower.includes("behavior") || lower.includes("logic")) return "behavior"
		if (lower.includes("env") || lower.includes("config") || lower.includes("platform")) return "environment"
		if (lower.includes("integration") || lower.includes("api") || lower.includes("interface")) return "integration"
		if (lower.includes("perf") || lower.includes("slow") || lower.includes("memory")) return "performance"
		if (lower.includes("security") || lower.includes("auth") || lower.includes("vuln")) return "security"
		return "behavior"
	}

	private analyzeFailureCategories(
		failureReason: string,
		lessons: Array<{ failureType: string; rootCause: string }>,
	): AssumptionCategory[] {
		const categories = new Set<AssumptionCategory>()

		categories.add(this.categorizeFailure(failureReason))

		for (const lesson of lessons) {
			categories.add(this.categorizeFailure(lesson.failureType))
			categories.add(this.categorizeFailure(lesson.rootCause))
		}

		return Array.from(categories)
	}

	private recalculateConfidence(hypothesis: Hypothesis): void {
		const total = hypothesis.assumptions.length
		if (total === 0) return

		const verified = hypothesis.assumptions.filter(
			(a) => a.status === "verified",
		).length
		const falsified = hypothesis.assumptions.filter(
			(a) => a.status === "falsified",
		).length

		// Base confidence on verified vs total, penalized by falsified
		const baseConfidence = verified / total
		const falsifiedPenalty = falsified / total

		hypothesis.confidence = Math.max(0.1, baseConfidence - falsifiedPenalty)
	}

	private generateId(): string {
		return `hyp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
	}
}
