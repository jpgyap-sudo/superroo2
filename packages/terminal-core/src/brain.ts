/**
 * Terminal Brain — The Orchestrator
 *
 * Ties together the Repo Scanner, Command Planner, Safe Executor,
 * Log Parser, Safety Guard, and Terminal Memory into a single
 * Plan → Run → Verify loop.
 */

import type {
	ProjectContext,
	PlannedCommand,
	CommandResult,
	TerminalFeedback,
	ErrorAnalysis,
	SafetyDecision,
	CommandIntent,
	TerminalBrainRequest,
	TerminalBrainResponse,
} from "./types"

import { scanWorkspace, quickScan } from "../../repo-scanner/src/scanner"
import { planCommands, detectIntent, planBuildFix, planSafeDeploy } from "./planner"
import { executeCommand } from "../../command-runner/src/runner"
import { analyzeOutput, getPrimaryError } from "../../log-parser/src/parser"
import { checkCommand } from "../../safety-guard/src/guard"
import { getTerminalMemory } from "./memory"

export interface BrainOptions {
	workspaceRoot: string
	sessionId?: string
}

export class TerminalBrain {
	private context: ProjectContext | null = null
	private workspaceRoot: string
	private sessionId: string
	private memory = getTerminalMemory()

	constructor(opts: BrainOptions) {
		this.workspaceRoot = opts.workspaceRoot
		this.sessionId = opts.sessionId || this.memory.createSession("default").id
	}

	// ─── Context Loading ────────────────────────────────────────────────

	async loadContext(fullScan = false): Promise<ProjectContext> {
		if (fullScan) {
			const result = await scanWorkspace({ workspaceRoot: this.workspaceRoot })
			this.context = result.context
		} else {
			this.context = await quickScan(this.workspaceRoot)
		}
		return this.context
	}

	getContext(): ProjectContext | null {
		return this.context
	}

	// ─── Main Entry Point ───────────────────────────────────────────────

	async process(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		switch (request.action) {
			case "context":
				return this.handleContext(request)
			case "plan":
				return this.handlePlan(request)
			case "execute":
				return this.handleExecute(request)
			case "analyze":
				return this.handleAnalyze(request)
			case "fix":
				return this.handleFix(request)
			case "memory":
				return this.handleMemory(request)
			default:
				return { ok: false, error: `Unknown action: ${request.action}` }
		}
	}

	// ─── Context Handler ────────────────────────────────────────────────

	private async handleContext(_request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			const context = await this.loadContext(true)
			return {
				ok: true,
				context,
				memory: {
					sessions: this.memory.getSessions(),
					commands: this.memory.getCommands(this.sessionId),
					errors: this.memory.getRecentErrors(10),
					fixes: this.memory.getFixes(),
					deployments: this.memory.getDeployments(),
				},
			}
		} catch (err) {
			return { ok: false, error: `Failed to load context: ${err}` }
		}
	}

	// ─── Plan Handler ───────────────────────────────────────────────────

	private async handlePlan(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			if (!this.context) {
				await this.loadContext()
			}

			const query = request.nlQuery || request.command || ""
			const intent = detectIntent(query)

			let planned: PlannedCommand[]

			if (query.toLowerCase().includes("fix") && query.toLowerCase().includes("build")) {
				planned = planBuildFix(this.context!)
			} else if (query.toLowerCase().includes("deploy")) {
				planned = planSafeDeploy(this.context!)
			} else {
				planned = planCommands(intent.intent, this.context!, query)
			}

			return {
				ok: true,
				feedback: {
					plan: `Planned ${planned.length} step(s) for intent: ${intent.intent} (${Math.round(intent.confidence * 100)}% confidence)`,
					command: planned.map((c) => c.command).join(" && "),
					exitCode: null,
					output: planned.map((c, i) => `  ${i + 1}. [${c.requiresApproval ? "⚠️" : "✅"}] ${c.description}`).join("\n"),
					errors: [],
					fixes: [],
					verification: "Plan created — awaiting execution",
					status: "needs_approval" as const,
					memory: { sessionId: this.sessionId, commandId: "", errorId: null },
				},
			}
		} catch (err) {
			return { ok: false, error: `Failed to plan: ${err}` }
		}
	}

	// ─── Execute Handler ────────────────────────────────────────────────

	private async handleExecute(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			if (!this.context) {
				await this.loadContext()
			}

			const command = request.command || ""
			if (!command.trim()) {
				return { ok: false, error: "No command provided" }
			}

			// Check safety
			const safety = checkCommand(command)
			if (!safety.allowed && safety.requiresApproval) {
				return {
					ok: true,
					feedback: {
						plan: `Command requires approval`,
						command,
						exitCode: null,
						output: `[BLOCKED] ${safety.reason}`,
						errors: [],
						fixes: [],
						verification: "Awaiting approval",
						status: "needs_approval",
						memory: { sessionId: this.sessionId, commandId: "", errorId: null },
					},
				}
			}

			// Record command in memory
			const cmdRecord = this.memory.recordCommand(this.sessionId, command)

			// Execute
			const planned: PlannedCommand = {
				id: cmdRecord.id,
				intent: detectIntent(command).intent,
				command,
				description: `Execute: ${command}`,
				requiresApproval: false,
			}

			const result: CommandResult = await executeCommand(planned, safety)

			// Analyze output for errors
			const errors = analyzeOutput(result.output)
			const primaryError = errors.length > 0 ? errors[0] : null

			// Complete command record
			this.memory.completeCommand(
				cmdRecord.id,
				result.exitCode ?? -1,
				result.output.slice(0, 10).join("\n"),
				primaryError?.rootCause || null,
				primaryError?.relatedFiles || [],
			)

			// Record error if found
			let errorId: string | null = null
			if (primaryError) {
				const errRecord = this.memory.recordError(
					cmdRecord.id,
					primaryError.errorType,
					primaryError.errorMessage,
					primaryError.rootCause,
					primaryError.relatedFiles,
					primaryError.fixSuggestion,
				)
				errorId = errRecord.id
			}

			const status = result.exitCode === 0 ? "success" : errors.length > 0 ? "failed" : "success"

			return {
				ok: true,
				feedback: {
					plan: `Execute: ${command}`,
					command,
					exitCode: result.exitCode,
					output: result.output.slice(0, 20).join("\n"),
					errors,
					fixes: [],
					verification: result.exitCode === 0 ? "Command completed successfully" : `Exit code: ${result.exitCode}`,
					status,
					memory: {
						sessionId: this.sessionId,
						commandId: cmdRecord.id,
						errorId,
					},
				},
			}
		} catch (err) {
			return { ok: false, error: `Execution failed: ${err}` }
		}
	}

	// ─── Analyze Handler ────────────────────────────────────────────────

	private async handleAnalyze(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			const output = request.command ? request.command.split("\n") : []
			const errors = analyzeOutput(output)
			const primary = getPrimaryError(output)

			return {
				ok: true,
				feedback: {
					plan: "Analyze terminal output for errors",
					command: "",
					exitCode: null,
					output: errors.map((e) => `[${e.errorType}] ${e.rootCause} (${Math.round(e.confidence * 100)}%)`).join("\n"),
					errors,
					fixes: errors.filter((e) => e.fixSuggestion).map((e) => e.fixSuggestion!),
					verification: primary ? `Primary error: ${primary.errorType}` : "No errors detected",
					status: errors.length > 0 ? "failed" : "success",
					memory: { sessionId: this.sessionId, commandId: "", errorId: null },
				},
			}
		} catch (err) {
			return { ok: false, error: `Analysis failed: ${err}` }
		}
	}

	// ─── Fix Handler ────────────────────────────────────────────────────

	private async handleFix(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			const output = request.command ? request.command.split("\n") : []
			const errors = analyzeOutput(output)
			const primary = getPrimaryError(output)

			if (!primary) {
				return {
					ok: true,
					feedback: {
						plan: "No errors to fix",
						command: "",
						exitCode: null,
						output: "No errors detected in the provided output.",
						errors: [],
						fixes: [],
						verification: "Nothing to fix",
						status: "success",
						memory: { sessionId: this.sessionId, commandId: "", errorId: null },
					},
				}
			}

			// Record the fix
			const fixRecord = this.memory.recordFix(
				"auto",
				primary.fixSuggestion || "Auto-fix applied",
				primary.relatedFiles,
				"",
				"success",
			)

			return {
				ok: true,
				feedback: {
					plan: `Fix: ${primary.rootCause}`,
					command: primary.fixSuggestion || "",
					exitCode: null,
					output: `Suggested fix: ${primary.fixSuggestion || "No automatic fix available"}`,
					errors: [primary],
					fixes: [primary.fixSuggestion || "Manual fix required"],
					verification: "Fix suggested — apply and re-run to verify",
					status: "needs_approval",
					memory: {
						sessionId: this.sessionId,
						commandId: "",
						errorId: null,
					},
				},
			}
		} catch (err) {
			return { ok: false, error: `Fix failed: ${err}` }
		}
	}

	// ─── Memory Handler ─────────────────────────────────────────────────

	private async handleMemory(_request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		return {
			ok: true,
			memory: {
				sessions: this.memory.getSessions(),
				commands: this.memory.getCommands(this.sessionId),
				errors: this.memory.getRecentErrors(50),
				fixes: this.memory.getFixes(),
				deployments: this.memory.getDeployments(),
			},
		}
	}

	// ─── Stats ──────────────────────────────────────────────────────────

	getStats() {
		return this.memory.getStats()
	}
}
