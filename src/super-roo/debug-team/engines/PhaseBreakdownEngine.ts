/**
 * PhaseBreakdownEngine — Complex Problem Decomposition
 *
 * Decomposes complex goals into sequential, dependency-aware phases.
 * Each phase has a clear definition, status, dependencies, and success criteria.
 * Mirrors the methodology from .roo/skills/phase-breakdown/SKILL.md
 *
 * This engine is the first step in the Super Debug Loop pipeline.
 * It transforms an ambiguous goal into a structured, executable plan.
 */

import { EventEmitter } from "events"

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhaseStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "skipped"
	| "blocked"

export interface PhaseDependency {
	phaseId: string
	type: "hard" | "soft" | "informational"
	description: string
}

export interface PhaseDefinition {
	id: string
	title: string
	description: string
	goal: string
	successCriteria: string[]
	dependencies: PhaseDependency[]
	estimatedComplexity: 1 | 2 | 3 | 4 | 5 // 1=trivial, 5=extremely complex
	requiredCapabilities: string[]
	riskLevel: "low" | "medium" | "high" | "critical"
	rollbackStrategy?: string
	maxRetries: number
	timeoutMs: number
}

export interface PhaseResult {
	phaseId: string
	status: PhaseStatus
	startedAt: string
	completedAt?: string
	attempts: number
	errors: string[]
	artifacts: string[]
	lessons: string[]
	metrics: Record<string, number>
}

export interface BreakdownOptions {
	goal: string
	context: string
	constraints: string[]
	availableCapabilities: string[]
	maxPhases?: number
	parallelizeWherePossible?: boolean
	riskTolerance?: "low" | "medium" | "high"
}

export interface PhaseBreakdown {
	id: string
	goal: string
	context: string
	phases: PhaseDefinition[]
	dependencyGraph: Map<string, string[]> // phaseId → dependent phaseIds
	criticalPath: string[] // ordered phase IDs on the critical path
	estimatedTotalComplexity: number
	estimatedTotalTimeMs: number
	parallelGroups: string[][] // groups of phases that can run in parallel
	createdAt: string
	metadata: Record<string, unknown>
}

export interface BreakdownProgress {
	breakdownId: string
	goal: string
	phases: Map<string, PhaseResult>
	currentPhaseId: string | null
	completedCount: number
	totalCount: number
	failedCount: number
	blockedCount: number
	elapsedMs: number
	isComplete: boolean
}

export interface PhaseBreakdownEngineConfig {
	maxPhases: number
	defaultTimeoutMs: number
	maxRetriesPerPhase: number
	enableParallelExecution: boolean
	emitEvents: boolean
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface PhaseBreakdownEvents {
	"breakdown:created": (breakdown: PhaseBreakdown) => void
	"phase:started": (phaseId: string, definition: PhaseDefinition) => void
	"phase:completed": (phaseId: string, result: PhaseResult) => void
	"phase:failed": (phaseId: string, error: Error, result: PhaseResult) => void
	"phase:blocked": (phaseId: string, reason: string) => void
	"phase:retrying": (phaseId: string, attempt: number, maxRetries: number) => void
	"breakdown:complete": (progress: BreakdownProgress) => void
	"breakdown:failed": (progress: BreakdownProgress, error: Error) => void
	"progress:updated": (progress: BreakdownProgress) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class PhaseBreakdownEngine {
	private config: PhaseBreakdownEngineConfig
	private emitter: EventEmitter
	private breakdowns: Map<string, BreakdownProgress> = new Map()
	private phaseExecutors: Map<
		string,
		(
			phase: PhaseDefinition,
			context: string,
		) => Promise<PhaseResult>
	> = new Map()

	constructor(config?: Partial<PhaseBreakdownEngineConfig>) {
		this.config = {
			maxPhases: config?.maxPhases ?? 12,
			defaultTimeoutMs: config?.defaultTimeoutMs ?? 300_000, // 5 min default
			maxRetriesPerPhase: config?.maxRetriesPerPhase ?? 3,
			enableParallelExecution: config?.enableParallelExecution ?? true,
			emitEvents: config?.emitEvents ?? true,
		}
		this.emitter = new EventEmitter()
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof PhaseBreakdownEvents>(
		event: K,
		listener: PhaseBreakdownEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof PhaseBreakdownEvents>(
		event: K,
		listener: PhaseBreakdownEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof PhaseBreakdownEvents>(
		event: K,
		...args: Parameters<PhaseBreakdownEvents[K]>
	): void {
		if (this.config.emitEvents) {
			this.emitter.emit(event, ...(args as unknown[]))
		}
	}

	// ── Phase executor registration ─────────────────────────────────────────

	/**
	 * Register a custom executor for a specific phase type/capability.
	 * If no executor is registered, the engine uses the default sequential executor.
	 */
	registerPhaseExecutor(
		capability: string,
		executor: (
			phase: PhaseDefinition,
			context: string,
		) => Promise<PhaseResult>,
	): void {
		this.phaseExecutors.set(capability, executor)
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Create a phase breakdown from a complex goal.
	 * Analyzes the goal, context, and constraints to produce a structured plan.
	 */
	async createBreakdown(options: BreakdownOptions): Promise<PhaseBreakdown> {
		const {
			goal,
			context,
			constraints,
			availableCapabilities,
			maxPhases = this.config.maxPhases,
			parallelizeWherePossible = true,
			riskTolerance = "medium",
		} = options

		// Phase 1: Goal analysis — extract key objectives and scope
		const objectives = this.extractObjectives(goal, context)
		const scopeBoundaries = this.identifyScopeBoundaries(goal, constraints)

		// Phase 2: Decompose into phases
		const phases = this.decomposeIntoPhases(
			goal,
			objectives,
			scopeBoundaries,
			availableCapabilities,
			maxPhases,
			riskTolerance,
		)

		// Phase 3: Build dependency graph
		const dependencyGraph = this.buildDependencyGraph(phases)

		// Phase 4: Identify critical path
		const criticalPath = this.findCriticalPath(phases, dependencyGraph)

		// Phase 5: Identify parallel groups
		const parallelGroups = parallelizeWherePossible
			? this.findParallelGroups(phases, dependencyGraph)
			: []

		// Phase 6: Calculate estimates
		const estimatedTotalComplexity = phases.reduce(
			(sum, p) => sum + p.estimatedComplexity,
			0,
		)
		const estimatedTotalTimeMs = phases.reduce(
			(sum, p) => sum + p.timeoutMs,
			0,
		)

		const breakdown: PhaseBreakdown = {
			id: this.generateId(),
			goal,
			context,
			phases,
			dependencyGraph,
			criticalPath,
			estimatedTotalComplexity,
			estimatedTotalTimeMs,
			parallelGroups,
			createdAt: new Date().toISOString(),
			metadata: {
				constraints,
				availableCapabilities,
				riskTolerance,
				parallelizeWherePossible,
			},
		}

		// Initialize progress tracker
		const progress = this.createProgressTracker(breakdown)
		this.breakdowns.set(breakdown.id, progress)

		this.emit("breakdown:created", breakdown)
		return breakdown
	}

	/**
	 * Execute a breakdown by running each phase in dependency order.
	 * Returns the final progress state.
	 */
	async executeBreakdown(
		breakdownId: string,
		phaseExecutor?: (
			phase: PhaseDefinition,
			context: string,
		) => Promise<PhaseResult>,
	): Promise<BreakdownProgress> {
		const progress = this.breakdowns.get(breakdownId)
		if (!progress) {
			throw new Error(`Breakdown not found: ${breakdownId}`)
		}

		const breakdown = this.reconstructBreakdown(progress)
		const startTime = Date.now()

		try {
			// Execute phases in topological order
			const executionOrder = this.topologicalSort(breakdown)

			for (const phaseId of executionOrder) {
				const phase = breakdown.phases.find((p) => p.id === phaseId)
				if (!phase) continue

				// Check if phase is blocked by dependencies
				const blocker = this.checkBlocked(phase, progress)
				if (blocker) {
					progress.currentPhaseId = phaseId
					const result = this.createFailedResult(
						phaseId,
						new Error(blocker),
					)
					result.status = "blocked"
					progress.phases.set(phaseId, result)
					progress.blockedCount++
					this.emit("phase:blocked", phaseId, blocker)
					continue
				}

				// Skip completed phases
				const existing = progress.phases.get(phaseId)
				if (existing && existing.status === "completed") {
					continue
				}

				// Execute phase with retries
				progress.currentPhaseId = phaseId
				const result = await this.executePhaseWithRetries(
					phase,
					breakdown.context,
					phaseExecutor,
				)

				progress.phases.set(phaseId, result)

				if (result.status === "completed") {
					progress.completedCount++
					this.emit("phase:completed", phaseId, result)
				} else if (result.status === "failed") {
					progress.failedCount++
					this.emit("phase:failed", phaseId, new Error(result.errors.join("; ")), result)
				} else if (result.status === "blocked") {
					progress.blockedCount++
					this.emit("phase:blocked", phaseId, result.errors.join("; "))
				}

				progress.elapsedMs = Date.now() - startTime
				this.emit("progress:updated", { ...progress })
			}

			progress.isComplete = true
			progress.elapsedMs = Date.now() - startTime
			this.emit("breakdown:complete", { ...progress })
		} catch (error) {
			progress.elapsedMs = Date.now() - startTime
			this.emit(
				"breakdown:failed",
				{ ...progress },
				error instanceof Error ? error : new Error(String(error)),
			)
			throw error
		}

		return progress
	}

	/**
	 * Get the current progress of a breakdown.
	 */
	getProgress(breakdownId: string): BreakdownProgress | undefined {
		return this.breakdowns.get(breakdownId)
	}

	/**
	 * List all breakdowns and their status.
	 */
	listBreakdowns(): Array<{
		id: string
		goal: string
		completedCount: number
		totalCount: number
		isComplete: boolean
	}> {
		return Array.from(this.breakdowns.values()).map((p) => ({
			id: p.breakdownId,
			goal: p.goal,
			completedCount: p.completedCount,
			totalCount: p.totalCount,
			isComplete: p.isComplete,
		}))
	}

	/**
	 * Cancel a running breakdown.
	 */
	cancelBreakdown(breakdownId: string): boolean {
		return this.breakdowns.delete(breakdownId)
	}

	// ── Private: Decomposition Logic ─────────────────────────────────────────

	private extractObjectives(
		goal: string,
		context: string,
	): string[] {
		// Parse the goal and context to extract clear objectives
		// In a full implementation, this would use NLP/LLM
		const objectives: string[] = []

		// Split goal into sentences and extract actionable items
		const sentences = goal.split(/[.!?]+/).filter((s) => s.trim().length > 0)
		for (const sentence of sentences) {
			const trimmed = sentence.trim()
			if (
				trimmed.toLowerCase().startsWith("make") ||
				trimmed.toLowerCase().startsWith("implement") ||
				trimmed.toLowerCase().startsWith("create") ||
				trimmed.toLowerCase().startsWith("add") ||
				trimmed.toLowerCase().startsWith("fix") ||
				trimmed.toLowerCase().startsWith("refactor") ||
				trimmed.toLowerCase().startsWith("optimize")
			) {
				objectives.push(trimmed)
			}
		}

		// If no clear objectives found, use the whole goal
		if (objectives.length === 0) {
			objectives.push(goal)
		}

		return objectives
	}

	private identifyScopeBoundaries(
		goal: string,
		constraints: string[],
	): string[] {
		// Identify what's in scope and out of scope
		const boundaries: string[] = [...constraints]

		// Add implicit boundaries from the goal
		if (goal.toLowerCase().includes("frontend")) {
			boundaries.push("backend changes out of scope unless required")
		}
		if (goal.toLowerCase().includes("backend")) {
			boundaries.push("frontend changes out of scope unless required")
		}
		if (goal.toLowerCase().includes("api")) {
			boundaries.push("UI changes out of scope")
		}

		return boundaries
	}

	private decomposeIntoPhases(
		goal: string,
		objectives: string[],
		scopeBoundaries: string[],
		availableCapabilities: string[],
		maxPhases: number,
		riskTolerance: "low" | "medium" | "high",
	): PhaseDefinition[] {
		const phases: PhaseDefinition[] = []

		// Phase 1: Analysis & Understanding
		phases.push({
			id: "phase-analysis",
			title: "Analysis & Understanding",
			description: `Deep analysis of the goal: "${goal}". Understand the current codebase, identify affected modules, and map dependencies.`,
			goal: "Complete understanding of what needs to be built/changed and how it fits into the existing system",
			successCriteria: [
				"All affected modules identified",
				"Dependencies mapped",
				"Risk areas identified",
				"Entry points for implementation determined",
			],
			dependencies: [],
			estimatedComplexity: 2,
			requiredCapabilities: ["code-analysis", "system-understanding"],
			riskLevel: "low",
			maxRetries: 1,
			timeoutMs: this.config.defaultTimeoutMs,
		})

		// Phase 2: Planning & Design
		phases.push({
			id: "phase-planning",
			title: "Planning & Design",
			description:
				"Design the solution architecture, define interfaces, and create an implementation plan.",
			goal: "A detailed, actionable implementation plan",
			successCriteria: [
				"Solution architecture designed",
				"Interfaces defined",
				"Implementation order determined",
				"Testing strategy defined",
				"Rollback strategy defined",
			],
			dependencies: [
				{
					phaseId: "phase-analysis",
					type: "hard",
					description: "Must understand before planning",
				},
			],
			estimatedComplexity: 3,
			requiredCapabilities: [
				"system-design",
				"architecture-planning",
			],
			riskLevel: "medium",
			maxRetries: 2,
			timeoutMs: this.config.defaultTimeoutMs * 1.5,
		})

		// Phase 3: Snapshot & Safety
		phases.push({
			id: "phase-snapshot",
			title: "Snapshot & Safety",
			description:
				"Create a git snapshot of the current state. Set up the container sandbox for safe iteration.",
			goal: "Safe state captured and sandbox ready for experimentation",
			successCriteria: [
				"Git snapshot created",
				"Container sandbox initialized",
				"Rollback point established",
				"Test environment verified",
			],
			dependencies: [
				{
					phaseId: "phase-planning",
					type: "hard",
					description: "Must know what to snapshot before doing it",
				},
			],
			estimatedComplexity: 1,
			requiredCapabilities: ["git-operations", "docker"],
			riskLevel: "low",
			maxRetries: 1,
			timeoutMs: 60_000,
		})

		// Phase 4: Implementation
		phases.push({
			id: "phase-implementation",
			title: "Implementation",
			description:
				"Execute the implementation plan. Make code changes, create new files, modify existing ones.",
			goal: "All planned changes implemented",
			successCriteria: [
				"All planned code changes made",
				"New files created as needed",
				"Existing files modified correctly",
				"Code follows project conventions",
			],
			dependencies: [
				{
					phaseId: "phase-planning",
					type: "hard",
					description: "Must have a plan before implementing",
				},
				{
					phaseId: "phase-snapshot",
					type: "hard",
					description: "Must have safety snapshot before making changes",
				},
			],
			estimatedComplexity: 4,
			requiredCapabilities: ["coding", "refactoring"],
			riskLevel: "high",
			rollbackStrategy: "Rollback to snapshot if implementation fails critically",
			maxRetries: this.config.maxRetriesPerPhase,
			timeoutMs: this.config.defaultTimeoutMs * 3,
		})

		// Phase 5: Testing
		phases.push({
			id: "phase-testing",
			title: "Testing & Verification",
			description:
				"Run all tests, verify the implementation works correctly, and check for regressions.",
			goal: "All tests pass and implementation is verified",
			successCriteria: [
				"All existing tests pass",
				"New tests pass",
				"No regressions introduced",
				"Edge cases handled",
				"Performance impact acceptable",
			],
			dependencies: [
				{
					phaseId: "phase-implementation",
					type: "hard",
					description: "Must implement before testing",
				},
			],
			estimatedComplexity: 3,
			requiredCapabilities: ["testing", "verification"],
			riskLevel: "medium",
			maxRetries: this.config.maxRetriesPerPhase,
			timeoutMs: this.config.defaultTimeoutMs * 2,
		})

		// Phase 6: Code Review & Critique
		phases.push({
			id: "phase-critique",
			title: "Code Review & Critique",
			description:
				"Review all changes for quality, security, performance, and adherence to best practices.",
			goal: "Code quality verified and any issues addressed",
			successCriteria: [
				"Code review completed",
				"Security concerns addressed",
				"Performance implications understood",
				"Best practices followed",
				"Documentation updated if needed",
			],
			dependencies: [
				{
					phaseId: "phase-testing",
					type: "hard",
					description: "Must pass tests before review",
				},
			],
			estimatedComplexity: 2,
			requiredCapabilities: ["code-review", "security-analysis"],
			riskLevel: "low",
			maxRetries: 2,
			timeoutMs: this.config.defaultTimeoutMs,
		})

		// Phase 7: Integration Sync
		if (objectives.length > 1 || goal.toLowerCase().includes("feature")) {
			phases.push({
				id: "phase-integration",
				title: "Integration & Feature Sync",
				description:
					"Verify the changes integrate correctly with all other features and modules.",
				goal: "All features work together correctly",
				successCriteria: [
					"Cross-feature integration verified",
					"No feature conflicts",
					"All feature tests pass together",
					"Integration points documented",
				],
				dependencies: [
					{
						phaseId: "phase-critique",
						type: "hard",
						description: "Must pass review before integration",
					},
				],
				estimatedComplexity: 3,
				requiredCapabilities: [
					"integration-testing",
					"feature-coordination",
				],
				riskLevel: "high",
				maxRetries: 2,
				timeoutMs: this.config.defaultTimeoutMs * 2,
			})
		}

		// Phase 8: Final Verification & Deploy
		phases.push({
			id: "phase-final-verification",
			title: "Final Verification & Deployment",
			description:
				"Final verification of all changes and deployment to target environment.",
			goal: "Changes deployed and verified in target environment",
			successCriteria: [
				"All checks pass",
				"Deployment successful",
				"Post-deploy verification passed",
				"Monitoring confirms healthy state",
			],
			dependencies: [
				{
					phaseId: "phase-critique",
					type: "hard",
					description: "Must pass review before final verification",
				},
				...(goal.toLowerCase().includes("feature")
					? [
							{
								phaseId: "phase-integration",
								type: "hard" as const,
								description: "Must pass integration before deploy",
							},
						]
					: []),
			],
			estimatedComplexity: 2,
			requiredCapabilities: ["deployment", "verification"],
			riskLevel: "medium",
			maxRetries: 2,
			timeoutMs: this.config.defaultTimeoutMs,
		})

		// Phase 9: Lessons & Skills Generation
		phases.push({
			id: "phase-lessons",
			title: "Lessons Learned & Skills Generation",
			description:
				"Document lessons learned, generate skills from failures, and update resources.",
			goal: "Knowledge captured and skills updated for future use",
			successCriteria: [
				"Lessons documented",
				"Skills generated from failures",
				"Resources updated",
				"Knowledge persisted for future iterations",
			],
			dependencies: [
				{
					phaseId: "phase-final-verification",
					type: "soft",
					description: "Can start after verification, but best after deploy",
				},
			],
			estimatedComplexity: 1,
			requiredCapabilities: ["documentation", "knowledge-management"],
			riskLevel: "low",
			maxRetries: 1,
			timeoutMs: this.config.defaultTimeoutMs / 2,
		})

		// Trim to max phases if needed
		return phases.slice(0, maxPhases)
	}

	// ── Private: Graph Algorithms ────────────────────────────────────────────

	private buildDependencyGraph(
		phases: PhaseDefinition[],
	): Map<string, string[]> {
		const graph = new Map<string, string[]>()

		for (const phase of phases) {
			const dependents: string[] = []
			for (const other of phases) {
				if (other.id === phase.id) continue
				const hasDep = other.dependencies.some(
					(d) => d.phaseId === phase.id && d.type === "hard",
				)
				if (hasDep) {
					dependents.push(other.id)
				}
			}
			graph.set(phase.id, dependents)
		}

		return graph
	}

	private findCriticalPath(
		phases: PhaseDefinition[],
		dependencyGraph: Map<string, string[]>,
	): string[] {
		// Find the longest path through the dependency graph
		const visited = new Set<string>()
		const path: string[] = []

		const dfs = (nodeId: string): string[] => {
			if (visited.has(nodeId)) return []
			visited.add(nodeId)

			const dependents = dependencyGraph.get(nodeId) || []
			let longest: string[] = []

			for (const depId of dependents) {
				const subPath = dfs(depId)
				if (subPath.length > longest.length) {
					longest = subPath
				}
			}

			return [nodeId, ...longest]
		}

		// Find root nodes (no dependencies)
		const rootNodes = phases.filter(
			(p) => p.dependencies.filter((d) => d.type === "hard").length === 0,
		)

		for (const root of rootNodes) {
			visited.clear()
			const candidate = dfs(root.id)
			if (candidate.length > path.length) {
				path.length = 0
				path.push(...candidate)
			}
		}

		return path
	}

	private findParallelGroups(
		phases: PhaseDefinition[],
		dependencyGraph: Map<string, string[]>,
	): string[][] {
		const groups: string[][] = []
		const assigned = new Set<string>()

		// Group phases that have no dependencies on each other
		for (const phase of phases) {
			if (assigned.has(phase.id)) continue

			const group: string[] = [phase.id]
			assigned.add(phase.id)

			for (const other of phases) {
				if (assigned.has(other.id)) continue

				// Check if they can run in parallel (no dependency between them)
				const phaseDepsOnOther = phase.dependencies.some(
					(d) => d.phaseId === other.id && d.type === "hard",
				)
				const otherDepsOnPhase = other.dependencies.some(
					(d) => d.phaseId === phase.id && d.type === "hard",
				)

				if (!phaseDepsOnOther && !otherDepsOnPhase) {
					group.push(other.id)
					assigned.add(other.id)
				}
			}

			groups.push(group)
		}

		return groups
	}

	private topologicalSort(breakdown: PhaseBreakdown): string[] {
		const sorted: string[] = []
		const visited = new Set<string>()
		const visiting = new Set<string>()

		const visit = (phaseId: string) => {
			if (visited.has(phaseId)) return
			if (visiting.has(phaseId)) {
				throw new Error(`Circular dependency detected involving phase: ${phaseId}`)
			}

			visiting.add(phaseId)

			const phase = breakdown.phases.find((p) => p.id === phaseId)
			if (phase) {
				for (const dep of phase.dependencies) {
					if (dep.type === "hard") {
						visit(dep.phaseId)
					}
				}
			}

			visiting.delete(phaseId)
			visited.add(phaseId)
			sorted.push(phaseId)
		}

		for (const phase of breakdown.phases) {
			visit(phase.id)
		}

		return sorted
	}

	// ── Private: Execution ───────────────────────────────────────────────────

	private async executePhaseWithRetries(
		phase: PhaseDefinition,
		context: string,
		externalExecutor?: (
			phase: PhaseDefinition,
			context: string,
		) => Promise<PhaseResult>,
	): Promise<PhaseResult> {
		let lastError: Error | null = null
		let attempts = 0

		while (attempts < phase.maxRetries) {
			attempts++
			this.emit("phase:started", phase.id, phase)

			if (attempts > 1) {
				this.emit("phase:retrying", phase.id, attempts, phase.maxRetries)
			}

			try {
				const executor =
					externalExecutor ||
					this.findExecutor(phase) ||
					this.defaultPhaseExecutor

				const result = await executor(phase, context)
				result.attempts = attempts

				if (result.status === "completed") {
					return result
				}

				lastError = new Error(
					result.errors.join("; ") || "Phase failed without specific error",
				)
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error))
			}
		}

		// All retries exhausted
		return this.createFailedResult(phase.id, lastError!, attempts)
	}

	private findExecutor(
		phase: PhaseDefinition,
	): ((phase: PhaseDefinition, context: string) => Promise<PhaseResult>) | undefined {
		for (const capability of phase.requiredCapabilities) {
			const executor = this.phaseExecutors.get(capability)
			if (executor) return executor
		}
		return undefined
	}

	private defaultPhaseExecutor = async (
		phase: PhaseDefinition,
		_context: string,
	): Promise<PhaseResult> => {
		// Default executor: marks phase as completed with a placeholder result
		// In production, this would be replaced by actual LLM/agent execution
		return {
			phaseId: phase.id,
			status: "completed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			attempts: 1,
			errors: [],
			artifacts: [],
			lessons: [],
			metrics: {
				executionTimeMs: 0,
			},
		}
	}

	private checkBlocked(
		phase: PhaseDefinition,
		progress: BreakdownProgress,
	): string | null {
		for (const dep of phase.dependencies) {
			if (dep.type !== "hard") continue

			const depResult = progress.phases.get(dep.phaseId)
			if (!depResult || depResult.status !== "completed") {
				return `Blocked by dependency: ${dep.phaseId} (${dep.description})`
			}
		}
		return null
	}

	// ── Private: Helpers ─────────────────────────────────────────────────────

	private createProgressTracker(breakdown: PhaseBreakdown): BreakdownProgress {
		const phases = new Map<string, PhaseResult>()

		for (const phase of breakdown.phases) {
			phases.set(phase.id, {
				phaseId: phase.id,
				status: "pending",
				startedAt: new Date().toISOString(),
				attempts: 0,
				errors: [],
				artifacts: [],
				lessons: [],
				metrics: {},
			})
		}

		return {
			breakdownId: breakdown.id,
			goal: breakdown.goal,
			phases,
			currentPhaseId: null,
			completedCount: 0,
			totalCount: breakdown.phases.length,
			failedCount: 0,
			blockedCount: 0,
			elapsedMs: 0,
			isComplete: false,
		}
	}

	private reconstructBreakdown(
		progress: BreakdownProgress,
	): PhaseBreakdown {
		// This is a simplified reconstruction — in production, store the full breakdown
		return {
			id: progress.breakdownId,
			goal: progress.goal,
			context: "",
			phases: [],
			dependencyGraph: new Map(),
			criticalPath: [],
			estimatedTotalComplexity: 0,
			estimatedTotalTimeMs: 0,
			parallelGroups: [],
			createdAt: new Date().toISOString(),
			metadata: {},
		}
	}

	private createFailedResult(
		phaseId: string,
		error: Error,
		attempts = 1,
	): PhaseResult {
		return {
			phaseId,
			status: "failed",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			attempts,
			errors: [error.message],
			artifacts: [],
			lessons: [],
			metrics: {},
		}
	}

	private generateId(): string {
		return `bd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
	}
}
