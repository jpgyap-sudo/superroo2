/**
 * Super Roo — Roo Task Adapter (headless interface).
 *
 * This module is the **headless seam** between Super Roo's agents and Roo's
 * actual Task loop. Agents talk to this interface only. The concrete
 * implementation lives at `src/super-roo-host/RooTaskRunner.ts` and is
 * injected at orchestrator construction.
 *
 * Strict rules for this file:
 *   - NO `vscode` imports
 *   - NO imports from Roo's `ClineProvider` or other host-bound modules
 *   - Only types from `../types`
 *
 * Why a runner interface instead of just calling `provider.createTask()`?
 *   - Headlessness: super-roo/* must remain reusable from the CLI app, tests,
 *     and a future sidecar process. None of those have a ClineProvider.
 *   - Testability: agent unit tests can pass a fake runner. See
 *     `__tests__/CoderAgent.test.ts`.
 *   - Boundary: makes the host/headless boundary explicit and reviewable.
 *     If a PR adds a `vscode` import to this directory, that's a bug.
 */

import type { Capability, SafetyMode } from "../types"

// ──────────────────────────────────────────────────────────────────────────────
// Request the agent sends down to the runner.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * What the runner needs to start a Roo Task on behalf of an agent.
 *
 * `mode` corresponds to a Roo mode slug (e.g. "code", "debug", "architect").
 * `text` is the natural-language goal — equivalent to what a user would type
 * into Roo's chat.
 *
 * `systemPromptOverlay` is appended to (or merged with) the mode's existing
 * system prompt. This is how each Super Roo agent injects its persona/rules
 * (e.g. the Coder Agent's "you are operating inside an autonomous loop"
 * preamble) without forking Roo's prompt builder.
 *
 * `safetyMode` is informational for the runner — actual translation to SuperRoo's
 * `SuperRooSettings` flags happens in `RooApprovalAdapter` on the host side.
 */
export interface RooTaskRequest {
	/** Roo mode slug. */
	mode: string

	/** The user-equivalent prompt that drives the task. */
	text: string

	/** Optional images (Roo's createTask supports image input). Base64 or URI. */
	images?: string[]

	/** Capabilities the calling agent needs. The host adapter uses these to set Roo flags. */
	capabilities: Capability[]

	/** Current safety mode at dispatch time. Host translates to SuperRooSettings. */
	safetyMode: SafetyMode

	/** Appended/merged into the mode's system prompt by the host adapter. */
	systemPromptOverlay?: string

	/** Cap on Roo's internal iteration loop. Mirrors the Task's `maxIterations`. */
	maxIterations?: number

	/**
	 * Override the workspace path for this Task. Optional. If unset, the host
	 * uses the editor's current workspace. Used by the future self-improve mode
	 * (Phase 4+) to point the Task at Super Roo's own repo deliberately.
	 */
	workspacePathOverride?: string

	/**
	 * Cooperative cancellation. Agents pass through their `AgentRunContext.signal`.
	 * The runner should wire this up to `Task.abortTask()` on abort.
	 */
	signal?: AbortSignal
}

// ──────────────────────────────────────────────────────────────────────────────
// Outcome the runner returns to the agent.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Why a Task ended. Mirrors Roo's TaskCompleted / TaskAborted / failed flow,
 * but shaped to be agent-friendly.
 */
export type RooTaskOutcome =
	| { kind: "completed"; taskId: string; tokenUsage?: RooTokenUsage; toolUsage?: RooToolUsageSummary }
	| { kind: "aborted"; taskId: string; reason: "user" | "signal" | "timeout" | "unknown" }
	| { kind: "failed"; taskId: string; error: string; toolName?: string }

/** Optional metadata propagated from Roo's TaskCompleted event. Kept loose. */
export interface RooTokenUsage {
	totalTokensIn?: number
	totalTokensOut?: number
	totalCost?: number
}

/** Optional tool-usage summary. Kept loose so Roo's internal shape can evolve. */
export type RooToolUsageSummary = Record<string, { count: number; failures: number }>

// ──────────────────────────────────────────────────────────────────────────────
// Lifecycle events emitted by the runner during a Task run.
//
// Agents typically `await runner.run(...)` and ignore these, but the
// orchestrator subscribes via `onEvent` to forward into the EventLog so the
// dashboard sees real-time progress.
// ──────────────────────────────────────────────────────────────────────────────

export type RooTaskEvent =
	| { kind: "started"; taskId: string }
	| { kind: "message"; taskId: string; role: "assistant" | "user"; preview: string }
	| { kind: "tool.invoked"; taskId: string; toolName: string }
	| { kind: "tool.failed"; taskId: string; toolName: string; error: string }
	| { kind: "mode.switched"; taskId: string; from: string; to: string }
	| { kind: "completed"; taskId: string }
	| { kind: "aborted"; taskId: string }

export type RooTaskEventListener = (ev: RooTaskEvent) => void

// ──────────────────────────────────────────────────────────────────────────────
// The runner interface itself.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The headless contract Super Roo agents call into. The host implementation
 * (`src/super-roo-host/RooTaskRunner.ts`) wraps `ClineProvider.createTask()`
 * and bridges Roo's EventEmitter into this Promise+events shape.
 *
 * Implementations MUST:
 *   - Resolve the returned promise exactly once with a single {@link RooTaskOutcome}.
 *   - Forward Roo lifecycle events via `onEvent` until the task ends.
 *   - Honor `req.signal` by aborting the underlying Roo Task and resolving
 *     with a `{ kind: "aborted", reason: "signal" }` outcome.
 *   - Apply `safetyMode` to Roo's auto-approval BEFORE the Task is constructed,
 *     not during the run (Roo reads these flags at construction).
 */
export interface RooTaskRunner {
	/**
	 * Start a Roo Task, await its resolution, and return the outcome.
	 *
	 * The promise resolves (never rejects) under normal conditions — failures
	 * are encoded in the {@link RooTaskOutcome}. The promise CAN reject only on
	 * setup errors (e.g. provider not yet initialized, invalid mode slug).
	 */
	run(req: RooTaskRequest, onEvent?: RooTaskEventListener): Promise<RooTaskOutcome>

	/**
	 * Optional readiness probe. The orchestrator checks this before dispatching
	 * to detect "extension activated but provider not ready yet" cases. A
	 * runner that is always ready (e.g. a fake) can return `true` immediately.
	 */
	isReady(): boolean
}
