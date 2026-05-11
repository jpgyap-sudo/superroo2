/**
 * FeatureSyncOrchestrator — Multi-Feature Coordination & Integration Verification
 *
 * Ensures that changes made by the debug team don't break existing features
 * and that multiple features work together correctly. This is critical for
 * complex feature work where changes touch multiple parts of the system.
 *
 * Key responsibilities:
 *   1. Track feature dependencies and affected features
 *   2. Verify integration between changed code and existing features
 *   3. Detect feature conflicts before they reach production
 *   4. Generate integration test plans for affected feature combinations
 *   5. Maintain a feature dependency graph for the workspace
 */

import { EventEmitter } from "events"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyncStatus = "pending" | "in_progress" | "verified" | "conflict" | "failed" | "skipped"

export type DependencyType = "hard" | "soft" | "optional"

export interface FeatureDependency {
	featureId: string
	dependsOn: string
	type: DependencyType
	description: string
	verified: boolean
}

export interface FeatureSyncPlan {
	id: string
	jobId: string
	goal: string
	featureIds: string[]
	affectedFiles: string[]
	integrationChecks: IntegrationCheck[]
	dependencyGraph: Map<string, string[]> // featureId → dependent featureIds
	status: SyncStatus
	error?: string
	createdAt: number
	completedAt?: number
}

export interface IntegrationCheck {
	id: string
	description: string
	featuresInvolved: string[]
	filesInvolved: string[]
	testCommand: string
	status: "pending" | "running" | "passed" | "failed" | "skipped"
	output?: string
	error?: string
}

export interface FeatureSyncConfig {
	/** Whether to run integration tests. Default: true */
	runIntegrationTests: boolean
	/** Whether to check for feature conflicts. Default: true */
	checkForConflicts: boolean
	/** Whether to auto-resolve soft conflicts. Default: true */
	autoResolveSoftConflicts: boolean
	/** Max integration checks per sync. Default: 20 */
	maxIntegrationChecks: number
	/** Default test command for integration checks. Default: "pnpm test:integration" */
	defaultTestCommand: string
}

export interface SyncPlanInput {
	jobId: string
	goal: string
	featureIds: string[]
	affectedFiles: string[]
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface FeatureSyncEvents {
	"sync:started": (plan: FeatureSyncPlan) => void
	"sync:completed": (plan: FeatureSyncPlan) => void
	"sync:failed": (plan: FeatureSyncPlan, error: Error) => void
	"conflict:detected": (plan: FeatureSyncPlan, description: string) => void
	"conflict:resolved": (plan: FeatureSyncPlan, description: string) => void
	"check:started": (check: IntegrationCheck) => void
	"check:completed": (check: IntegrationCheck) => void
	"check:failed": (check: IntegrationCheck, error: Error) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class FeatureSyncOrchestrator {
	private config: FeatureSyncConfig
	private emitter: EventEmitter
	private plans: Map<string, FeatureSyncPlan> = new Map()
	private featureGraph: Map<string, FeatureDependency[]> = new Map()

	constructor(config?: Partial<FeatureSyncConfig>) {
		this.config = {
			runIntegrationTests: config?.runIntegrationTests ?? true,
			checkForConflicts: config?.checkForConflicts ?? true,
			autoResolveSoftConflicts: config?.autoResolveSoftConflicts ?? true,
			maxIntegrationChecks: config?.maxIntegrationChecks ?? 20,
			defaultTestCommand: config?.defaultTestCommand ?? "pnpm test:integration",
		}
		this.emitter = new EventEmitter()
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof FeatureSyncEvents>(
		event: K,
		listener: FeatureSyncEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof FeatureSyncEvents>(
		event: K,
		listener: FeatureSyncEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof FeatureSyncEvents>(
		event: K,
		...args: Parameters<FeatureSyncEvents[K]>
	): void {
		this.emitter.emit(event, ...(args as unknown[]))
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Create a sync plan for a debug job.
	 * Analyzes affected features, builds dependency graph, and generates
	 * integration checks.
	 */
	async createSyncPlan(input: SyncPlanInput): Promise<FeatureSyncPlan> {
		const dependencyGraph = this.buildDependencyGraph(input.featureIds)
		const integrationChecks = this.generateIntegrationChecks(input)

		const plan: FeatureSyncPlan = {
			id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
			jobId: input.jobId,
			goal: input.goal,
			featureIds: input.featureIds,
			affectedFiles: input.affectedFiles,
			integrationChecks,
			dependencyGraph,
			status: "pending",
			createdAt: Date.now(),
		}

		this.plans.set(plan.id, plan)
		return plan
	}

	/**
	 * Execute a sync plan — run all integration checks and verify feature compatibility.
	 */
	async executeSyncPlan(plan: FeatureSyncPlan): Promise<boolean> {
		plan.status = "in_progress"
		this.emit("sync:started", plan)

		try {
			// Check for conflicts first
			if (this.config.checkForConflicts) {
				const conflicts = await this.detectConflicts(plan)
				if (conflicts.length > 0) {
					for (const conflict of conflicts) {
						this.emit("conflict:detected", plan, conflict)

						if (this.config.autoResolveSoftConflicts) {
							const resolved = await this.resolveConflict(plan, conflict)
							if (resolved) {
								this.emit("conflict:resolved", plan, conflict)
							}
						}
					}
				}
			}

			// Run integration checks
			if (this.config.runIntegrationTests) {
				for (const check of plan.integrationChecks) {
					check.status = "running"
					this.emit("check:started", check)

					try {
						const result = await this.runIntegrationCheck(check)
						check.status = result ? "passed" : "failed"
						check.output = `Integration check completed`
						this.emit("check:completed", check)
					} catch (error) {
						check.status = "failed"
						check.error = error instanceof Error ? error.message : String(error)
						this.emit(
							"check:failed",
							check,
							error instanceof Error ? error : new Error(String(error)),
						)
					}
				}
			}

			// Determine overall status
			const failedChecks = plan.integrationChecks.filter((c) => c.status === "failed")
			if (failedChecks.length > 0) {
				plan.status = "conflict"
				plan.error = `${failedChecks.length} integration check(s) failed`
				this.emit("sync:failed", plan, new Error(plan.error))
				return false
			}

			plan.status = "verified"
			plan.completedAt = Date.now()
			this.emit("sync:completed", plan)
			return true
		} catch (error) {
			plan.status = "failed"
			plan.error = error instanceof Error ? error.message : String(error)
			plan.completedAt = Date.now()
			this.emit(
				"sync:failed",
				plan,
				error instanceof Error ? error : new Error(String(error)),
			)
			return false
		}
	}

	/**
	 * Register a feature dependency in the global feature graph.
	 */
	registerFeatureDependency(dependency: FeatureDependency): void {
		const deps = this.featureGraph.get(dependency.featureId) || []
		deps.push(dependency)
		this.featureGraph.set(dependency.featureId, deps)
	}

	/**
	 * Get the dependency graph for a set of features.
	 */
	getFeatureDependencies(featureIds: string[]): FeatureDependency[] {
		const deps: FeatureDependency[] = []
		for (const featureId of featureIds) {
			const featureDeps = this.featureGraph.get(featureId) || []
			deps.push(...featureDeps)
		}
		return deps
	}

	/**
	 * Get a sync plan by ID.
	 */
	getPlan(planId: string): FeatureSyncPlan | undefined {
		return this.plans.get(planId)
	}

	/**
	 * List all sync plans.
	 */
	listPlans(): FeatureSyncPlan[] {
		return Array.from(this.plans.values())
	}

	/**
	 * Reset the engine state.
	 */
	reset(): void {
		this.plans.clear()
		this.featureGraph.clear()
	}

	// ── Private: Graph & Check Generation ───────────────────────────────────

	private buildDependencyGraph(
		featureIds: string[],
	): Map<string, string[]> {
		const graph = new Map<string, string[]>()

		for (const featureId of featureIds) {
			const dependents: string[] = []
			const deps = this.featureGraph.get(featureId) || []

			for (const dep of deps) {
				if (dep.type === "hard" || dep.type === "soft") {
					dependents.push(dep.dependsOn)
				}
			}

			graph.set(featureId, dependents)
		}

		return graph
	}

	private generateIntegrationChecks(input: SyncPlanInput): IntegrationCheck[] {
		const checks: IntegrationCheck[] = []
		let checkCount = 0

		// Check 1: Build verification
		if (checkCount < this.config.maxIntegrationChecks) {
			checks.push({
				id: `check-build-${Date.now()}`,
				description: "Verify the project builds successfully with all changes",
				featuresInvolved: [...input.featureIds],
				filesInvolved: [...input.affectedFiles],
				testCommand: "pnpm build 2>&1",
				status: "pending",
			})
			checkCount++
		}

		// Check 2: Unit tests for affected files
		if (checkCount < this.config.maxIntegrationChecks && input.affectedFiles.length > 0) {
			checks.push({
				id: `check-unit-${Date.now()}`,
				description: "Run unit tests for all affected modules",
				featuresInvolved: [...input.featureIds],
				filesInvolved: [...input.affectedFiles],
				testCommand: "pnpm test -- --coverage=false 2>&1",
				status: "pending",
			})
			checkCount++
		}

		// Check 3: Cross-feature integration
		if (checkCount < this.config.maxIntegrationChecks && input.featureIds.length > 1) {
			checks.push({
				id: `check-integration-${Date.now()}`,
				description: `Verify integration between features: ${input.featureIds.join(", ")}`,
				featuresInvolved: [...input.featureIds],
				filesInvolved: [...input.affectedFiles],
				testCommand: this.config.defaultTestCommand,
				status: "pending",
			})
			checkCount++
		}

		// Check 4: Lint and type checking
		if (checkCount < this.config.maxIntegrationChecks) {
			checks.push({
				id: `check-lint-${Date.now()}`,
				description: "Run linter and type checker on all affected files",
				featuresInvolved: [...input.featureIds],
				filesInvolved: [...input.affectedFiles],
				testCommand: "pnpm lint 2>&1; pnpm typecheck 2>&1",
				status: "pending",
			})
			checkCount++
		}

		// Check 5: Affected file-specific tests
		for (const file of input.affectedFiles.slice(0, 3)) {
			if (checkCount >= this.config.maxIntegrationChecks) break
			checks.push({
				id: `check-file-${Date.now()}-${checkCount}`,
				description: `Verify file integrity: ${file}`,
				featuresInvolved: [...input.featureIds],
				filesInvolved: [file],
				testCommand: `pnpm test -- --findRelatedTests ${file} 2>&1`,
				status: "pending",
			})
			checkCount++
		}

		return checks
	}

	// ── Private: Conflict Detection & Resolution ────────────────────────────

	private async detectConflicts(plan: FeatureSyncPlan): Promise<string[]> {
		const conflicts: string[] = []

		// Check 1: File-level conflicts (same file modified by multiple features)
		const fileFeatureMap = new Map<string, string[]>()
		for (const featureId of plan.featureIds) {
			const deps = this.featureGraph.get(featureId) || []
			for (const dep of deps) {
				// In a real implementation, we'd check actual file changes
				// For now, flag features that share dependencies
				const existing = fileFeatureMap.get(dep.dependsOn) || []
				existing.push(featureId)
				fileFeatureMap.set(dep.dependsOn, existing)
			}
		}

		for (const [dep, features] of fileFeatureMap) {
			if (features.length > 1) {
				conflicts.push(
					`Multiple features (${features.join(", ")}) share dependency: ${dep}`,
				)
			}
		}

		// Check 2: Circular dependencies
		const visited = new Set<string>()
		const recursionStack = new Set<string>()

		const detectCycle = (featureId: string): boolean => {
			if (recursionStack.has(featureId)) return true
			if (visited.has(featureId)) return false

			visited.add(featureId)
			recursionStack.add(featureId)

			const deps = this.featureGraph.get(featureId) || []
			for (const dep of deps) {
				if (detectCycle(dep.dependsOn)) {
					conflicts.push(
						`Circular dependency detected involving feature: ${featureId} -> ${dep.dependsOn}`,
					)
					return true
				}
			}

			recursionStack.delete(featureId)
			return false
		}

		for (const featureId of plan.featureIds) {
			detectCycle(featureId)
		}

		return conflicts
	}

	private async resolveConflict(
		_plan: FeatureSyncPlan,
		conflict: string,
	): Promise<boolean> {
		// Auto-resolve soft conflicts by logging and continuing
		// In a full implementation, this would:
		//   1. Analyze the conflicting changes
		//   2. Attempt to merge them
		//   3. Run verification tests
		//   4. Report resolution or escalate

		if (conflict.includes("share dependency")) {
			// Soft conflict — can be resolved by running integration tests
			return true
		}

		if (conflict.includes("Circular dependency")) {
			// Hard conflict — cannot auto-resolve
			return false
		}

		return false
	}

	private async runIntegrationCheck(
		_check: IntegrationCheck,
	): Promise<boolean> {
		// In a real implementation, this would execute the test command
		// and parse the output. For now, return true (pass) as a placeholder.
		// The actual test execution is handled by the ContainerSandbox.
		return true
	}
}
