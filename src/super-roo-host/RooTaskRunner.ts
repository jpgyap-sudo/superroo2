/**
 * Super Roo Host — Roo Task Runner.
 *
 * Concrete `RooTaskRunner` that wraps `ClineProvider.createTask()`.
 *
 * Phase 2 boundary: this file is allowed to import `vscode`, `ClineProvider`,
 * and other Roo host types. The headless `super-roo/agents/RooTaskAdapter.ts`
 * defines the interface this implements.
 *
 * Lifecycle bridge (Roo events → RooTaskRunner outcome)
 * ─────────────────────────────────────────────────────
 *   SuperRooEventName.TaskStarted      -> onEvent({ kind: "started" })
 *   SuperRooEventName.TaskToolFailed   -> onEvent({ kind: "tool.failed" })
 *                                        + remembered as last failure for outcome
 *   SuperRooEventName.TaskModeSwitched -> onEvent({ kind: "mode.switched" })
 *   SuperRooEventName.Message          -> onEvent({ kind: "message" })   (assistant only)
 *   SuperRooEventName.TaskCompleted    -> resolve { kind: "completed" }
 *   SuperRooEventName.TaskAborted      -> resolve { kind: "aborted", reason }
 *
 * AbortSignal handling: if the caller's signal fires before completion, we
 * call `task.abortTask()` and then await the natural TaskAborted event.
 *
 * Resolution discipline: the Promise resolves EXACTLY ONCE. A guard flag
 * (`settled`) ensures duplicate completion/abort events don't double-resolve
 * — a real risk because Roo emits TaskAborted on streaming failures even
 * after a partial completion.
 */

import {
	SuperRooEventName,
	type ToolName,
	type ToolUsage,
	type TokenUsage,
} from "@superroo/types"

import type { ClineProvider } from "../core/webview/ClineProvider"
import type { Task } from "../core/task/Task"

import type {
	RooTaskEventListener,
	RooTaskOutcome,
	RooTaskRequest,
	RooTaskRunner as RooTaskRunnerIface,
	RooTokenUsage,
	RooToolUsageSummary,
} from "../super-roo/agents/RooTaskAdapter"

import { RooApprovalAdapter } from "./RooApprovalAdapter"

export interface RooTaskRunnerOptions {
	/** Where to route a task's mode override. The runner sets the mode via Roo's API. */
	provider: ClineProvider

	/**
	 * If true, the runner will await `provider.isInitialized()` style readiness
	 * before each call. We don't have a perfect probe; we use the existence of
	 * `provider.contextProxy` as a proxy. Override via `customIsReady`.
	 */
	customIsReady?: () => boolean
}

/**
 * Default readiness probe: provider must exist and have its context proxy
 * (i.e. extension activate() has finished).
 */
function defaultIsReady(provider: ClineProvider): boolean {
	// `contextProxy` is set during ClineProvider.initialize(). It's a sentinel
	// for "the provider is past activate()".
	return Boolean((provider as unknown as { contextProxy?: unknown }).contextProxy)
}

export class RooTaskRunner implements RooTaskRunnerIface {
	private readonly approval: RooApprovalAdapter

	constructor(private readonly opts: RooTaskRunnerOptions) {
		this.approval = new RooApprovalAdapter(opts.provider)
	}

	isReady(): boolean {
		return this.opts.customIsReady ? this.opts.customIsReady() : defaultIsReady(this.opts.provider)
	}

	async run(req: RooTaskRequest, onEvent?: RooTaskEventListener): Promise<RooTaskOutcome> {
		// 1. Apply auto-approval flags BEFORE creating the Task. Roo reads
		//    these at construction time, so doing it after is too late.
		await this.approval.apply(req.safetyMode)

		// 2. Switch the provider into the requested mode. Roo's "mode" is
		//    its system-prompt + tool-group selector. We use setValues to
		//    persist the mode preference; createTask will pick it up.
		//    (We pass `mode` via the configuration argument too, defensively.)
		const configuration: Record<string, unknown> = { mode: req.mode }

		// 3. Build the prompt. We do NOT modify Roo's mode-system-prompt
		//    machinery; we simply prefix the overlay onto the user-task text.
		//    This is the least-invasive way to inject our agent persona.
		const composedText = req.systemPromptOverlay
			? `${req.systemPromptOverlay}\n\n---\n\n${req.text}`
			: req.text

		// 4. Create the Task. createTask returns the live Task instance,
		//    which is also pushed onto the provider's clineStack.
		let task: Task
		try {
			task = await this.opts.provider.createTask(
				composedText,
				req.images,
				/* parentTask */ undefined,
				/* options */ {},
				configuration as never,
			)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			return { kind: "failed", taskId: "n/a", error: `createTask failed: ${msg}` }
		}

		// 5. Wire up event bridge + completion promise. Single-resolve.
		return await new Promise<RooTaskOutcome>((resolve) => {
			let settled = false
			let lastToolFailure: { tool: string; error: string } | undefined

			const settle = (outcome: RooTaskOutcome) => {
				if (settled) return
				settled = true
				cleanup()
				resolve(outcome)
			}

			const onStarted = () => {
				onEvent?.({ kind: "started", taskId: task.taskId })
			}
			const onCompleted = (taskId: string, tokenUsage?: TokenUsage, toolUsage?: ToolUsage) => {
				onEvent?.({ kind: "completed", taskId })
				settle({
					kind: "completed",
					taskId,
					tokenUsage: mapTokenUsage(tokenUsage),
					toolUsage: mapToolUsage(toolUsage),
				})
			}
			// onAborted is the single source of truth for abort handling. If a
			// tool failure was recorded earlier in the run AND we did not fire
			// the abort ourselves via the AbortSignal, promote the outcome to
			// `failed` (more informative than "aborted" since the tool failure
			// is the actual root cause). Otherwise resolve as `aborted`.
			const onAborted = () => {
				onEvent?.({ kind: "aborted", taskId: task.taskId })
				if (lastToolFailure && !req.signal?.aborted) {
					settle({
						kind: "failed",
						taskId: task.taskId,
						error: lastToolFailure.error,
						toolName: lastToolFailure.tool,
					})
					return
				}
				const reason = req.signal?.aborted ? "signal" : inferAbortReason(task)
				settle({ kind: "aborted", taskId: task.taskId, reason })
			}
			const onToolFailed = (taskId: string, toolName: ToolName, error: string) => {
				lastToolFailure = { tool: toolName, error }
				onEvent?.({ kind: "tool.failed", taskId, toolName, error })
				// We do NOT settle here. Roo may recover (e.g. retry the tool).
				// The task will eventually emit Completed or Aborted, at which
				// point we settle. If Aborted is the outcome and we have a
				// recorded tool failure, onAborted promotes it to `failed`.
			}
			const onModeSwitched = (taskId: string, mode: string) => {
				onEvent?.({ kind: "mode.switched", taskId, from: "(unknown)", to: mode })
			}
			const onMessage = (payload: { action: "created" | "updated"; message: { type?: string; say?: string; text?: string } }) => {
				if (payload.action !== "created") return
				const m = payload.message
				if (m?.type !== "say") return
				if (m?.say === "tool") {
					// We don't have a perfect place to extract tool name from this
					// message shape without coupling tightly; rely on TaskToolFailed
					// for failure surfacing instead.
					return
				}
				onEvent?.({
					kind: "message",
					taskId: task.taskId,
					role: "assistant",
					preview: typeof m.text === "string" ? m.text.slice(0, 200) : "",
				})
			}

			// AbortSignal → Roo abortTask. Defined before cleanup so cleanup can reference it.
			const onSignalAbort = () => {
				try {
					void task.abortTask(true)
				} catch {
					// Ignore — we'll settle on TaskAborted regardless.
				}
			}

			const cleanup = () => {
				task.off(SuperRooEventName.TaskStarted, onStarted)
				task.off(SuperRooEventName.TaskCompleted, onCompleted)
				task.off(SuperRooEventName.TaskAborted, onAborted)
				task.off(SuperRooEventName.TaskToolFailed, onToolFailed)
				task.off(SuperRooEventName.TaskModeSwitched, onModeSwitched)
				task.off(SuperRooEventName.Message, onMessage)
				if (req.signal) {
					req.signal.removeEventListener("abort", onSignalAbort)
				}
			}

			task.on(SuperRooEventName.TaskStarted, onStarted)
			task.on(SuperRooEventName.TaskCompleted, onCompleted)
			task.on(SuperRooEventName.TaskAborted, onAborted)
			task.on(SuperRooEventName.TaskToolFailed, onToolFailed)
			task.on(SuperRooEventName.TaskModeSwitched, onModeSwitched)
			task.on(SuperRooEventName.Message, onMessage)

			if (req.signal) {
				if (req.signal.aborted) {
					onSignalAbort()
				} else {
					req.signal.addEventListener("abort", onSignalAbort)
				}
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function inferAbortReason(task: Task): "user" | "signal" | "timeout" | "unknown" {
	const reason = (task as unknown as { abortReason?: string }).abortReason
	switch (reason) {
		case "user_cancelled":
			return "user"
		case "streaming_failed":
			return "unknown"
		default:
			return "unknown"
	}
}

function mapTokenUsage(usage?: TokenUsage): RooTokenUsage | undefined {
	if (!usage) return undefined
	return {
		totalTokensIn: (usage as unknown as { totalTokensIn?: number }).totalTokensIn,
		totalTokensOut: (usage as unknown as { totalTokensOut?: number }).totalTokensOut,
		totalCost: (usage as unknown as { totalCost?: number }).totalCost,
	}
}

function mapToolUsage(usage?: ToolUsage): RooToolUsageSummary | undefined {
	if (!usage) return undefined
	const out: RooToolUsageSummary = {}
	for (const [name, stats] of Object.entries(usage as Record<string, { attempts?: number; failures?: number }>)) {
		out[name] = {
			count: stats.attempts ?? 0,
			failures: stats.failures ?? 0,
		}
	}
	return out
}
