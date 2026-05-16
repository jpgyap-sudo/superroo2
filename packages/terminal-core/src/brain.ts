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
} from "./types.js"

import { scanWorkspace, quickScan } from "../../repo-scanner/src/scanner.js"
import { planCommands, detectIntent, detectIntentRegex, planBuildFix, planSafeDeploy } from "./planner.js"
import { executeCommand } from "../../command-runner/src/runner.js"
import { analyzeOutput, getPrimaryError } from "../../log-parser/src/parser.js"
import { checkCommand } from "../../safety-guard/src/guard.js"
import { TerminalMemory, getTerminalMemory, PersistentTerminalMemory, type ITerminalMemory } from "./memory.js"

export interface BrainOptions {
	workspaceRoot: string
	sessionId?: string
	memory?: ITerminalMemory
	userId?: string
}

export class TerminalBrain {
	private context: ProjectContext | null = null
	private workspaceRoot: string
	private sessionId: string
	private memory: ITerminalMemory
	private userId?: string

	constructor(opts: BrainOptions) {
		this.workspaceRoot = opts.workspaceRoot
		this.memory = opts.memory || getTerminalMemory()
		this.sessionId = opts.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		this.userId = opts.userId
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
			case "snippets":
				return this.handleSnippets(request)
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
					sessions: await this.memory.getSessions(),
					commands: await this.memory.getCommands(this.sessionId),
					errors: await this.memory.getRecentErrors(10),
					fixes: await this.memory.getFixes(),
					deployments: await this.memory.getDeployments(),
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
			const intent = await detectIntent(query)

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
					output: planned
						.map((c, i) => `  ${i + 1}. [${c.requiresApproval ? "⚠️" : "✅"}] ${c.description}`)
						.join("\n"),
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
			const cmdRecord = await this.memory.recordCommand(this.sessionId, command)

			// Execute
			const detected = await detectIntent(command)
			const planned: PlannedCommand = {
				id: cmdRecord.id,
				intent: detected.intent,
				command,
				description: `Execute: ${command}`,
				requiresApproval: false,
			}

			const result: CommandResult = await executeCommand(planned, safety)

			// Analyze output for errors
			const errors = analyzeOutput(result.output)
			const primaryError = errors.length > 0 ? errors[0] : null

			// Complete command record
			await this.memory.completeCommand(
				cmdRecord.id,
				result.exitCode ?? -1,
				result.output.slice(0, 10).join("\n"),
				primaryError?.rootCause || null,
				primaryError?.relatedFiles || [],
			)

			// Record error if found
			let errorId: string | null = null
			if (primaryError) {
				const errRecord = await this.memory.recordError(
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
					verification:
						result.exitCode === 0 ? "Command completed successfully" : `Exit code: ${result.exitCode}`,
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
					output: errors
						.map((e) => `[${e.errorType}] ${e.rootCause} (${Math.round(e.confidence * 100)}%)`)
						.join("\n"),
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
				sessions: await this.memory.getSessions(),
				commands: await this.memory.getCommands(this.sessionId),
				errors: await this.memory.getRecentErrors(50),
				fixes: await this.memory.getFixes(),
				deployments: await this.memory.getDeployments(),
			},
		}
	}

	// ─── Snippets Handler ───────────────────────────────────────────────

	private async handleSnippets(request: TerminalBrainRequest): Promise<TerminalBrainResponse> {
		try {
			const workspaceId = request.workspaceId || this.workspaceRoot
			const popular = await this.memory.getPopularCommands(workspaceId, 10)
			const recent = await this.memory.getRecentCommands(workspaceId, 10)
			return {
				ok: true,
				memory: {
					sessions: [],
					commands: recent.map((r) => ({
						id: `snippet-${r.startedAt}`,
						sessionId: "",
						command: r.command,
						exitCode: null,
						outputSummary: "",
						errorSummary: null,
						filesChanged: [],
						startedAt: r.startedAt,
						finishedAt: null,
						durationMs: null,
					})) as any,
					errors: [],
					fixes: [],
					deployments: [],
				},
				feedback: {
					plan: `Found ${popular.length} popular and ${recent.length} recent commands`,
					command: "",
					exitCode: null,
					output: popular.map((p) => `${p.command} (${p.count} uses)`).join("\n"),
					errors: [],
					fixes: [],
					verification: "Snippet discovery complete",
					status: "success",
					memory: { sessionId: this.sessionId, commandId: "", errorId: null },
				},
			}
		} catch (err) {
			return { ok: false, error: `Snippet discovery failed: ${err}` }
		}
	}

	// ─── Stats ──────────────────────────────────────────────────────────

	async getStats() {
		return this.memory.getStats()
	}
}
