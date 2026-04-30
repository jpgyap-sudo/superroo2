/**
 * Super Roo — Orchestrator.
 *
 * The conductor. Owns:
 *   - MemoryStore (SQLite, schema migrations on open)
 *   - SafetyManager (mode + blocklist)
 *   - EventLog (append-only, persisted + live subscribers)
 *   - TaskQueue (priority queue, persistent)
 *   - FeatureRegistry (product memory)
 *   - AgentRegistry (Phase 2 plugs into this)
 *
 * Lifecycle:
 *   ctor → start() → (loop) processNext() → stop() → close()
 *
 * The loop is *not* started automatically. Phase 1 callers (tests, future
 * agents) drive it explicitly. Phase 2's autonomous mode will turn on
 * `runLoop()` to process tasks continuously.
 *
 * Phase 1 boundary:
 *   - We do NOT yet register agents. Calling `processNext()` on a task whose
 *     agent isn't registered marks the task BLOCKED with a clear reason.
 *   - We do NOT yet wire into Roo's auto-approval. Phase 2 will add an adapter.
 *   - We do NOT yet wire into VS Code commands. Phase 3+ will.
 */

import * as path from "node:path"

import { EventLog } from "../logging/EventLog"
import { MemoryStore } from "../memory/MemoryStore"
import { FeatureRegistry } from "../features/FeatureRegistry"
import { TaskQueue } from "../queue/TaskQueue"
import { SafetyManager } from "../safety/SafetyManager"
import type { OrchestratorConfig, SafetyMode, Task, TaskInputRaw } from "../types"
import { AgentRegistry } from "./AgentRegistry"
import { InfiniteImprovementLoop } from "../ml/loop/InfiniteImprovementLoop"
import { FileImporter } from "../import/FileImporter"
import { DeployOrchestrator } from "../deploy/DeployOrchestrator"
import { CrawlerAgent } from "../crawler/CrawlerAgent"

export class SuperRooOrchestrator {
	readonly memory: MemoryStore
	readonly safety: SafetyManager
	readonly events: EventLog
	readonly queue: TaskQueue
	readonly features: FeatureRegistry
	readonly agents: AgentRegistry

	readonly mlLoop: InfiniteImprovementLoop
	readonly fileImporter: FileImporter
	readonly deploy: DeployOrchestrator | null
	readonly crawler: CrawlerAgent | null

	private running = false
	private currentAbort: AbortController | null = null
	private loopHandle: Promise<void> | null = null

	constructor(private readonly config: OrchestratorConfig) {
		this.memory = new MemoryStore(config.dbPath)
		this.events = new EventLog(this.memory)
		this.safety = new SafetyManager({
			initialMode: config.initialMode,
			blocklistPath: config.blocklistPath,
			selfImprove: config.selfImprove,
		})
		this.queue = new TaskQueue(this.memory, this.events)
		this.features = new FeatureRegistry(this.memory, this.events)
		this.agents = new AgentRegistry()
		this.mlLoop = new InfiniteImprovementLoop(this)
		this.fileImporter = new FileImporter(config.workspaceRoot ?? process.cwd())
		this.deploy = config.githubToken
			? new DeployOrchestrator({
					githubToken: config.githubToken,
					repoOwner: config.repoOwner ?? "",
					repoName: config.repoName ?? "",
					vpsHost: config.vpsHost ?? "",
					vpsUser: config.vpsUser ?? "",
					vpsDeployPath: config.vpsDeployPath ?? "/opt/superroo",
					vpsKeyPath: config.vpsSshKeyPath,
					healthUrl: config.healthUrl ?? "",
					maxRollbackVersions: config.maxRollbackVersions ?? 5,
				})
			: null
		this.crawler = config.crawlerEnabled ? new CrawlerAgent() : null
	}

	// ──────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		const recovered = this.queue.recoverOrphanedRunningTasks()
		this.mlLoop.start()
		this.crawler?.start()
		this.events.info("orchestrator.started", "Super Roo orchestrator started", {
			data: {
				mode: this.safety.getMode(),
				selfImprove: this.safety.getSelfImprove(),
				schemaVersion: this.memory.getSchemaVersion(),
				recoveredOrphans: recovered,
				mlLoop: true,
				crawler: !!this.crawler,
				deploy: !!this.deploy,
			},
		})
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		this.currentAbort?.abort()
		await this.mlLoop.stop()
		await this.crawler?.stop()
		if (this.loopHandle) {
			try {
				await this.loopHandle
			} catch {
				/* loop will have logged */
			}
		}
		this.events.info("orchestrator.stopped", "Super Roo orchestrator stopped")
	}

	close(): void {
		this.memory.close()
	}

	isRunning(): boolean {
		return this.running
	}

	// ──────────────────────────────────────────────────────────────────────
	// Mode shortcuts (delegate to SafetyManager but emit events)
	// ──────────────────────────────────────────────────────────────────────

	setMode(mode: SafetyMode): void {
		const prev = this.safety.getMode()
		if (prev === mode) return
		this.safety.setMode(mode)
		this.events.info("safety.mode_changed", `Safety mode: ${prev} → ${mode}`, {
			data: { from: prev, to: mode },
		})
	}

	enableSelfImprove(): void {
		this.safety.setSelfImprove(true)
		this.events.warn("safety.mode_changed", "Self-improve mode ENABLED. Super Roo can now modify its own codebase.", {
			data: { selfImprove: true },
		})
	}

	disableSelfImprove(): void {
		this.safety.setSelfImprove(false)
		this.events.info("safety.mode_changed", "Self-improve mode disabled.", { data: { selfImprove: false } })
	}

	// ──────────────────────────────────────────────────────────────────────
	// Task submission
	// ──────────────────────────────────────────────────────────────────────

	submit(input: TaskInputRaw): Task {
		// Pre-check capabilities at submit time so we fail fast in OFF/SAFE.
		const agent = this.agents.get(input.agent)
		const capabilities = mergeCapabilities(input.requiredCapabilities ?? [], agent?.requiredCapabilities ?? [])
		const decision = this.safety.checkCapabilities(capabilities)
		if (!decision.allowed) {
			// We still record the task so it appears in the dashboard, but mark it blocked.
			const task = this.queue.enqueue({ ...input, requiredCapabilities: capabilities })
			this.queue.markFinished(task.id, "blocked", { error: decision.reason })
			return this.queue.get(task.id)!
		}
		return this.queue.enqueue({ ...input, requiredCapabilities: capabilities })
	}

	// ──────────────────────────────────────────────────────────────────────
	// Single-step processor
	//
	// Returns one of:
	//   { kind: "idle" }                 — no pending work
	//   { kind: "off" }                  — autonomy is OFF; nothing dispatched
	//   { kind: "blocked", task, reason } — task dequeued but couldn't run
	//   { kind: "ran", task, result }     — agent ran; result returned
	// ──────────────────────────────────────────────────────────────────────

	async processNext(): Promise<ProcessResult> {
		if (this.safety.getMode() === "OFF") {
			return { kind: "off" }
		}

		const task = this.queue.dequeue()
		if (!task) return { kind: "idle" }

		const agent = this.agents.get(task.agent)
		if (!agent) {
			const reason = `Unknown agent: ${task.agent} (Phase 2 will register agents)`
			this.queue.markFinished(task.id, "blocked", { error: reason })
			return { kind: "blocked", task, reason }
		}

		// Re-check capabilities at dispatch time (mode may have changed since submit).
		// Include the registered agent's own required capabilities so tasks cannot
		// omit sensitive capabilities such as database writes by accident.
		const requiredCapabilities = mergeCapabilities(task.requiredCapabilities, agent.requiredCapabilities)
		const cap = this.safety.checkCapabilities(requiredCapabilities)
		if (!cap.allowed) {
			this.queue.markFinished(task.id, "blocked", { error: cap.reason })
			this.events.warn("safety.blocked", `Task blocked by safety: ${cap.reason}`, { taskId: task.id })
			return { kind: "blocked", task, reason: cap.reason }
		}

		// Guard against payload-supplied workspace overrides bypassing the self-improve boundary.
		const workspaceOverride = task.payload?.workspacePathOverride
		if (typeof workspaceOverride === "string") {
			const boundary = this.safety.checkSelfImproveBoundary(workspaceOverride, SuperRooOrchestrator.getSelfRoot())
			if (!boundary.allowed) {
				this.queue.markFinished(task.id, "blocked", { error: boundary.reason })
				this.events.warn("safety.blocked", `Task blocked by self-improve guard: ${boundary.reason}`, { taskId: task.id })
				return { kind: "blocked", task, reason: boundary.reason }
			}
		}

		this.currentAbort = new AbortController()
		const codedBy = task.codedBy ?? this.config.codedBy
		this.events.info("agent.invoked", `Invoking agent: ${agent.name}`, { taskId: task.id, agent: agent.name, codedBy })
		try {
			const result = await agent.run({
				task,
				safetyMode: this.safety.getMode(),
				codedBy,
				signal: this.currentAbort.signal,
				emit: (level, type, message, data) =>
					this.events.emit(level, type, message, { taskId: task.id, agent: agent.name, codedBy, data }),
			})
			this.events.info("agent.completed", `Agent ${agent.name} done: ${result.summary}`, {
				taskId: task.id,
				agent: agent.name,
				data: { ok: result.ok },
			})
			this.queue.markFinished(task.id, result.ok ? "succeeded" : "failed", {
				resultSummary: result.summary,
				error: result.error,
			})
			// Enqueue follow-ups, if any.
			if (result.followups) {
				for (const fu of result.followups) {
					this.submit({ ...fu, parentTaskId: task.id })
				}
			}
			return { kind: "ran", task, result }
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.queue.markFinished(task.id, "failed", { error: msg })
			this.events.error("task.failed", `Agent ${agent.name} threw: ${msg}`, { taskId: task.id, agent: agent.name })
			return { kind: "ran", task, result: { ok: false, summary: "agent threw", error: msg } }
		} finally {
			this.currentAbort = null
		}
	}

	/**
	 * Continuous loop. Calls processNext() until stop() is invoked or the queue
	 * is idle for `idleSleepMs`. Phase 2's autonomous toggle will turn this on.
	 */
	runLoop(opts: { idleSleepMs?: number; maxIterations?: number } = {}): Promise<void> {
		if (this.loopHandle) return this.loopHandle
		const sleep = opts.idleSleepMs ?? 250
		const maxIter = opts.maxIterations ?? Number.POSITIVE_INFINITY

		this.loopHandle = (async () => {
			let iter = 0
			while (this.running && iter < maxIter) {
				const r = await this.processNext()
				if (r.kind === "idle" || r.kind === "off") {
					await new Promise((resolve) => setTimeout(resolve, sleep))
				}
				iter += 1
			}
		})().finally(() => {
			this.loopHandle = null
		})

		return this.loopHandle
	}

	// ──────────────────────────────────────────────────────────────────────
	// Helpers
	// ──────────────────────────────────────────────────────────────────────

	/** Absolute path of super-roo's source dir, used by the self-improve guard. */
	static getSelfRoot(): string {
		return path.resolve(__dirname, "..")
	}
}

function mergeCapabilities(...groups: string[][]): string[] {
	return Array.from(new Set(groups.flat()))
}

export type ProcessResult =
	| { kind: "idle" }
	| { kind: "off" }
	| { kind: "blocked"; task: Task; reason: string }
	| {
			kind: "ran"
			task: Task
			result: { ok: boolean; summary: string; error?: string }
	  }
