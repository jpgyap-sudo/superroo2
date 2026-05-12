/**
 * TaskExecutor — Smart multi-agent task execution for the Cloud Orchestrator.
 *
 * Handles orchestrator-type tasks with:
 *   - Multi-agent breakdown using LLM (like local SuperRooOrchestrator)
 *   - Safety capability checks via SafetyManager
 *   - Agent delegation via AgentRegistry
 *   - BullMQ dispatch for sub-task execution (orchestratorWorker consumes these)
 *   - Healing integration on failures
 *   - Event logging throughout
 *   - Parallel execution via ParallelExecutor
 *   - ML loop integration for learning from past orchestrations
 *   - **HermesClaw integration** for context recall before breakdown planning
 *     and lesson extraction after orchestration completes
 *
 * Ported pattern from src/super-roo/orchestrator/SuperRooOrchestrator.ts processNext()
 *
 * Architecture:
 *   execute() → HermesClaw.recallContext() → LLM/rule-based breakdown
 *   → submit sub-tasks to BullMQ → orchestratorWorker.js → agentRunners.js
 *   → HermesClaw.extractLessons() on completion
 *
 * Previously, sub-tasks were created in the SQLite queue but never consumed
 * by any worker. Now they're dispatched to the "superroo-orchestrator" BullMQ
 * queue where orchestratorWorker picks them up and routes to agentRunners.
 */

const crypto = require("crypto")
const { Queue: BullQueue } = require("bullmq")
const IORedis = require("ioredis")

// ─── Built-in agent definitions for LLM-based delegation ────────────────

const AGENT_DEFINITIONS = [
	{
		id: "planner",
		name: "Planner",
		description: "Create detailed plans and architecture",
		capabilities: ["read_file", "list_files", "search_files", "view_code", "view_diff"],
	},
	{
		id: "coder",
		name: "Coder",
		description: "Write and modify code",
		capabilities: [
			"read_file",
			"list_files",
			"search_files",
			"write_file",
			"apply_diff",
			"execute_command",
			"run_tests",
			"create_branch",
			"commit_changes",
		],
	},
	{
		id: "debugger",
		name: "Debugger",
		description: "Debug and investigate issues",
		capabilities: ["read_file", "list_files", "search_files", "execute_command", "run_tests", "view_logs"],
	},
	{
		id: "tester",
		name: "Tester",
		description: "Run and write tests",
		capabilities: ["read_file", "list_files", "search_files", "execute_command", "run_tests"],
	},
	{
		id: "deployer",
		name: "Deployer",
		description: "Deploy the project",
		capabilities: [
			"read_file",
			"list_files",
			"execute_command",
			"deploy_staging",
			"deploy_production",
			"push_changes",
			"create_pr",
		],
	},
	{
		id: "crawler",
		name: "Crawler",
		description: "Crawl and analyze codebase",
		capabilities: ["read_file", "list_files", "search_files", "execute_safe_command"],
	},
	{
		id: "healer",
		name: "Healer",
		description: "Run self-healing cycles",
		capabilities: ["read_file", "list_files", "search_files", "execute_command", "run_tests", "view_logs"],
	},
]

class TaskExecutor {
	/**
	 * @param {import('../CloudOrchestrator')} orchestrator - CloudOrchestrator instance
	 */
	constructor(orchestrator) {
		this.orchestrator = orchestrator
		this._bullQueue = null
		this._redisConnection = null
		/** @type {import('./HermesClaw').HermesClaw|null} */
		this.hermesClaw = null
	}

	/**
	 * Set the HermesClaw instance for memory/context operations.
	 * @param {import('./HermesClaw').HermesClaw} hermesClaw
	 */
	setHermesClaw(hermesClaw) {
		this.hermesClaw = hermesClaw
	}

	/**
	 * Initialize BullMQ connection for dispatching sub-tasks.
	 * Called once during orchestrator startup.
	 */
	async initBullMQ() {
		if (this._bullQueue) return

		const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
		const QUEUE_NAME = process.env.ORCHESTRATOR_QUEUE_NAME || "superroo-orchestrator"

		this._redisConnection = new IORedis(REDIS_URL, {
			maxRetriesPerRequest: null,
			connectTimeout: 10000,
			retryStrategy: (times) => Math.min(1000 * Math.pow(2, times - 1), 30000),
		})

		this._bullQueue = new BullQueue(QUEUE_NAME, {
			connection: this._redisConnection,
			defaultJobOptions: {
				removeOnComplete: 100,
				removeOnFail: 50,
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 2000,
				},
			},
		})

		console.log(`[TaskExecutor] BullMQ queue initialized: ${QUEUE_NAME}`)
	}

	/**
	 * Close BullMQ connection.
	 */
	async closeBullMQ() {
		if (this._bullQueue) {
			await this._bullQueue.close()
			this._bullQueue = null
		}
		if (this._redisConnection) {
			await this._redisConnection.quit()
			this._redisConnection = null
		}
	}

	/**
	 * Execute an orchestrator-type task with full multi-agent breakdown.
	 *
	 * @param {object} task - The task from the queue
	 * @returns {Promise<{ok: boolean, output: string[], error?: string}>}
	 */
	async execute(task) {
		const { orchestrator } = this
		const input = task.input || {}
		const instruction =
			typeof input === "string" ? input : input.instruction || input.description || JSON.stringify(input)
		const workspace = input.workspace || {}

		// ── Step 1: HermesClaw context recall (before breakdown) ──────────
		// Inject relevant past experiences into the breakdown plan
		let hermesContext = ""
		if (this.hermesClaw) {
			try {
				const contextResult = await this.hermesClaw.recallContext(
					`Planning task: ${instruction.substring(0, 200)}`,
					3,
				)
				if (contextResult.success && contextResult.output) {
					hermesContext = contextResult.output
					orchestrator.eventLog.record({
						type: "hermes.context_recalled",
						source: "TaskExecutor",
						severity: "info",
						payload: { taskId: task.id, contextLength: hermesContext.length },
						taskId: task.id,
					})
				}
			} catch (hermesErr) {
				// Non-blocking — HermesClaw is advisory
				console.error(`[TaskExecutor] HermesClaw context recall failed: ${hermesErr.message}`)
			}
		}

		// ── Step 2: Safety check ──────────────────────────────────────────
		if (orchestrator.safetyManager) {
			const decision = orchestrator.safetyManager.checkCapability("orchestrator")
			if (!decision.allowed) {
				orchestrator.eventLog.record({
					type: "task.blocked",
					source: "TaskExecutor",
					severity: "warning",
					payload: { taskId: task.id, reason: decision.reason },
					taskId: task.id,
				})
				return {
					ok: false,
					output: [`Blocked by safety: ${decision.reason}`],
					error: decision.reason,
				}
			}
		}

		// ── Step 3: Check mode ────────────────────────────────────────────
		if (orchestrator.mode === "off") {
			return {
				ok: false,
				output: ["Orchestrator is in OFF mode. No tasks can be processed."],
				error: "Orchestrator mode is OFF",
			}
		}

		orchestrator.eventLog.record({
			type: "task.executing",
			source: "TaskExecutor",
			severity: "info",
			payload: {
				taskId: task.id,
				instruction: instruction.substring(0, 200),
				mode: orchestrator.mode,
			},
			taskId: task.id,
		})

		try {
			// ── Step 4: Generate multi-agent breakdown plan ───────────────
			// Pass HermesClaw context to the breakdown planner
			const plan = await this._generateBreakdownPlan(instruction, workspace, hermesContext)

			// ── Step 5: Execute each phase ────────────────────────────────
			const output = []
			output.push("╔══════════════════════════════════════════════╗")
			output.push("║     Cloud Orchestrator — Execution Plan     ║")
			output.push("╚══════════════════════════════════════════════╝")
			output.push("")

			for (let i = 0; i < plan.phases.length; i++) {
				const phase = plan.phases[i]
				output.push(`── Phase ${i + 1}: ${phase.title} ──`)
				output.push(`Agent: @${phase.agent}`)
				output.push(`Task: ${phase.description}`)
				output.push(`Success criteria: ${phase.successCriteria}`)
				output.push("")

				// Log phase start
				orchestrator.eventLog.record({
					type: "task.phase_started",
					source: "TaskExecutor",
					severity: "info",
					payload: {
						taskId: task.id,
						phase: i + 1,
						agent: phase.agent,
						title: phase.title,
					},
					taskId: task.id,
				})

				// Check safety for this agent's capabilities
				if (orchestrator.safetyManager) {
					const agentDef = AGENT_DEFINITIONS.find((a) => a.id === phase.agent)
					if (agentDef) {
						const capCheck = orchestrator.safetyManager.checkCapabilities(agentDef.capabilities)
						if (!capCheck.allowed) {
							output.push(`  ⚠️  Phase ${i + 1} blocked by safety: ${capCheck.reason}`)
							output.push("")

							orchestrator.eventLog.record({
								type: "task.phase_blocked",
								source: "TaskExecutor",
								severity: "warning",
								payload: {
									taskId: task.id,
									phase: i + 1,
									agent: phase.agent,
									reason: capCheck.reason,
								},
								taskId: task.id,
							})
							continue
						}
					}
				}

				// Create sub-task for this phase
				// Dispatch to BullMQ queue for actual execution by orchestratorWorker
				const subTaskId = `${task.id}-phase-${i + 1}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
				const subTaskPayload = {
					runnerType: phase.agent,
					instruction: phase.description,
					workspaceDir: workspace.directory || workspace.repoName || "",
					repoName: workspace.repoName || "",
					branch: workspace.branch || "",
					parentTaskId: task.id,
					phase: i + 1,
					totalPhases: plan.phases.length,
					phaseTitle: phase.title,
					successCriteria: phase.successCriteria,
					files: task.input?.files || [],
					filesLikelyInvolved: task.input?.filesLikelyInvolved || [],
					testCommand: task.input?.testCommand || "",
				}

				// Also create in SQLite queue for tracking
				const subTask = orchestrator.submit({
					type: phase.agent,
					input: {
						instruction: phase.description,
						workspace,
						parentTaskId: task.id,
						phase: i + 1,
						totalPhases: plan.phases.length,
					},
					priority: task.priority || 10,
					agent: phase.agent,
					sessionId: task.sessionId,
					parentTaskId: task.id,
					metadata: {
						phase: i + 1,
						phaseTitle: phase.title,
						successCriteria: phase.successCriteria,
						subTaskId,
					},
				})

				// Dispatch to BullMQ for actual execution
				if (this._bullQueue) {
					try {
						await this._bullQueue.add(`phase-${i + 1}-${phase.agent}`, subTaskPayload, {
							jobId: subTaskId,
							priority: task.priority || 10,
							delay: 0,
						})
						output.push(`  📋 Dispatched sub-task to BullMQ: ${subTaskId}`)
					} catch (bullErr) {
						output.push(`  ⚠️  BullMQ dispatch failed (sub-task queued locally): ${bullErr.message}`)
					}
				} else {
					output.push(
						`  📋 Created local sub-task: ${subTask.id} (no BullMQ — will not execute automatically)`,
					)
				}

				// If parallel executor is available, register sub-task for parallel execution
				if (orchestrator.parallelExecutor && orchestrator.agentBus) {
					try {
						orchestrator.agentBus.registerAgent(phase.agent)
						orchestrator.parallelExecutor.submit({
							id: subTaskId,
							type: phase.agent,
							payload: subTaskPayload,
							priority: task.priority || 10,
						})
						output.push(`  🔄 Registered for parallel execution: ${phase.agent}`)
					} catch (parallelErr) {
						// Non-blocking
					}
				}

				output.push(`  🎯 ${phase.successCriteria}`)
				output.push("")

				orchestrator.eventLog.record({
					type: "task.phase_dispatched",
					source: "TaskExecutor",
					severity: "info",
					payload: {
						taskId: task.id,
						phase: i + 1,
						agent: phase.agent,
						subTaskId: subTaskId,
						dispatchedToBullMQ: !!this._bullQueue,
					},
					taskId: task.id,
				})
			}

			// ── Step 6: HermesClaw lesson extraction (after completion) ───
			if (this.hermesClaw) {
				try {
					// Fire-and-forget — don't block on lesson extraction
					this.hermesClaw
						.extractLessons({
							taskId: task.id,
							goal: instruction.substring(0, 500),
							phases: plan.phases.map((p, i) => ({
								number: i + 1,
								phase: p.title,
								result: "dispatched",
							})),
							finalStatus: "completed",
						})
						.catch((err) => {
							console.error(`[TaskExecutor] HermesClaw lesson extraction failed: ${err.message}`)
						})
				} catch (hermesErr) {
					// Non-blocking
				}
			}

			// ── Step 7: Summary ───────────────────────────────────────────
			output.push("╔══════════════════════════════════════════════╗")
			output.push("║     Orchestration Complete                   ║")
			output.push("╚══════════════════════════════════════════════╝")
			output.push(`Total phases: ${plan.phases.length}`)
			output.push(`Agents involved: ${[...new Set(plan.phases.map((p) => `@${p.agent}`))].join(", ")}`)
			output.push("")
			output.push("Use the following commands to check sub-task status:")
			output.push("  /orchestrator/tasks — List all tasks")
			output.push(`  /orchestrator/tasks/${task.id} — Check this task`)

			// Log completion
			orchestrator.eventLog.record({
				type: "task.orchestration_complete",
				source: "TaskExecutor",
				severity: "info",
				payload: {
					taskId: task.id,
					phases: plan.phases.length,
					agents: [...new Set(plan.phases.map((p) => p.agent))],
				},
				taskId: task.id,
			})

			return { ok: true, output }
		} catch (err) {
			// ── Error handling with healing integration ───────────────────
			orchestrator.eventLog.record({
				type: "task.execution_failed",
				source: "TaskExecutor",
				severity: "error",
				payload: { taskId: task.id, error: err.message },
				taskId: task.id,
			})

			// Report to healing bus if available
			if (orchestrator.healingBus) {
				try {
					await orchestrator.healingBus.reportIncident({
						source: "TaskExecutor",
						severity: "error",
						title: `Orchestration failed: ${task.id}`,
						description: err.message,
						taskId: task.id,
						metadata: { instruction: instruction.substring(0, 500) },
					})
				} catch (healErr) {
					console.error("[TaskExecutor] Failed to report incident to healing bus:", healErr.message)
				}
			}

			return {
				ok: false,
				output: [`Orchestration error: ${err.message}`],
				error: err.message,
			}
		}
	}

	/**
	 * Generate a multi-agent breakdown plan using the LLM.
	 * This is the cloud equivalent of the local orchestrator's agent.run() pattern.
	 *
	 * @param {string} instruction - User's instruction
	 * @param {object} workspace - Workspace context
	 * @returns {Promise<{phases: Array<{title: string, agent: string, description: string, successCriteria: string}>}>}
	 */
	async _generateBreakdownPlan(instruction, workspace, hermesContext = "") {
		const { orchestrator } = this

		// Try to use an AI provider for intelligent breakdown
		let provider = null
		try {
			// We need access to resolveProviderForTask — it's in api.js scope
			// The orchestrator can store a reference to the provider resolver
			if (orchestrator._resolveProvider) {
				provider = orchestrator._resolveProvider("coder")
			}
		} catch {
			// No provider available, use rule-based breakdown
		}

		if (provider && provider.callChatCompletion) {
			try {
				return await this._llmBreakdown(instruction, workspace, provider, hermesContext)
			} catch {
				// Fall through to rule-based
			}
		}

		// Fallback: rule-based breakdown
		return this._ruleBasedBreakdown(instruction, workspace)
	}

	/**
	 * LLM-powered breakdown using the configured AI provider.
	 */
	async _llmBreakdown(instruction, workspace, provider, hermesContext = "") {
		const agentDescriptions = AGENT_DEFINITIONS.map(
			(a) => `  @${a.id} — ${a.description} (capabilities: ${a.capabilities.join(", ")})`,
		).join("\n")

		const systemPromptParts = [
			`You are SuperRoo acting as the Cloud Orchestrator agent.`,
			`Your role is to break down complex tasks into clear phases and coordinate multiple agents.`,
			``,
			`Available agents you can delegate to:`,
			agentDescriptions,
			``,
			`For each phase of the task:`,
			`1. Describe what needs to be done`,
			`2. Specify which agent should handle it (using @mentions)`,
			`3. Provide the exact command or instructions for that agent`,
			`4. Define success criteria for each phase`,
			``,
			`Output a JSON object with a "phases" array. Each phase must have:`,
			`  - title: string (short phase name)`,
			`  - agent: string (one of: planner, coder, debugger, tester, deployer, crawler, healer)`,
			`  - description: string (detailed instructions for the agent)`,
			`  - successCriteria: string (how to verify this phase is complete)`,
			``,
			`Example output:`,
			`{`,
			`  "phases": [`,
			`    { "title": "Analyze requirements", "agent": "planner", "description": "...", "successCriteria": "..." },`,
			`    { "title": "Implement solution", "agent": "coder", "description": "...", "successCriteria": "..." }`,
			`  ]`,
			`}`,
			``,
			`Output ONLY valid JSON. No markdown, no code fences, no explanation.`,
		]

		// Inject HermesClaw context if available
		if (hermesContext) {
			systemPromptParts.push(
				``,
				`### Relevant Past Experience (from HermesClaw memory):`,
				hermesContext,
				``,
				`Use this context to avoid repeating past mistakes and leverage proven approaches.`,
			)
		}

		const systemPrompt = systemPromptParts.join("\n")

		const userMessage = [
			`Instruction: ${instruction}`,
			workspace.repoName ? `Workspace: ${workspace.repoName} on branch ${workspace.branch}` : "",
			workspace.directory ? `Directory: ${workspace.directory}` : "",
		]
			.filter(Boolean)
			.join("\n")

		const reply = await provider.callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		])

		// Parse JSON from response
		const jsonMatch = reply.match(/\{[\s\S]*\}/)
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0])
			if (parsed.phases && Array.isArray(parsed.phases) && parsed.phases.length > 0) {
				return parsed
			}
		}

		throw new Error("Failed to parse LLM breakdown plan")
	}

	/**
	 * Rule-based breakdown fallback when no AI provider is available.
	 */
	_ruleBasedBreakdown(instruction, workspace) {
		const lower = instruction.toLowerCase()
		const phases = []

		// Detect task type from instruction keywords
		const needsPlanning =
			lower.includes("plan") ||
			lower.includes("architect") ||
			lower.includes("design") ||
			lower.includes("strategy")
		const needsCoding =
			lower.includes("implement") ||
			lower.includes("code") ||
			lower.includes("write") ||
			lower.includes("create") ||
			lower.includes("add") ||
			lower.includes("feature") ||
			lower.includes("fix") ||
			lower.includes("build")
		const needsDebugging =
			lower.includes("debug") ||
			lower.includes("bug") ||
			lower.includes("issue") ||
			lower.includes("error") ||
			lower.includes("broken") ||
			lower.includes("not working")
		const needsTesting =
			lower.includes("test") || lower.includes("verify") || lower.includes("validate") || lower.includes("qa")
		const needsDeploy =
			lower.includes("deploy") || lower.includes("release") || lower.includes("publish") || lower.includes("ship")
		const needsCrawl =
			lower.includes("analyze") ||
			lower.includes("crawl") ||
			lower.includes("scan") ||
			lower.includes("audit") ||
			lower.includes("review codebase")

		if (needsPlanning) {
			phases.push({
				title: "Planning & Architecture",
				agent: "planner",
				description: `Create a detailed plan for: ${instruction}`,
				successCriteria: "Clear plan with phases, agents, and success criteria defined",
			})
		}

		if (needsCrawl) {
			phases.push({
				title: "Codebase Analysis",
				agent: "crawler",
				description: `Analyze the codebase to understand the current state and identify relevant files for: ${instruction}`,
				successCriteria: "Relevant files and patterns identified",
			})
		}

		if (needsCoding) {
			phases.push({
				title: needsDebugging ? "Bug Fix Implementation" : "Feature Implementation",
				agent: needsDebugging ? "debugger" : "coder",
				description: instruction,
				successCriteria: needsDebugging ? "Bug is fixed and verified" : "Feature is implemented and working",
			})
		}

		if (needsTesting) {
			phases.push({
				title: "Testing & Verification",
				agent: "tester",
				description: `Run tests and verify the implementation for: ${instruction}`,
				successCriteria: "All tests pass and implementation is verified",
			})
		}

		if (needsDeploy) {
			phases.push({
				title: "Deployment",
				agent: "deployer",
				description: `Deploy the changes for: ${instruction}`,
				successCriteria: "Deployment successful and health check passes",
			})
		}

		// If nothing specific detected, use a generic approach
		if (phases.length === 0) {
			phases.push(
				{
					title: "Analysis",
					agent: "planner",
					description: `Analyze the request and create a plan: ${instruction}`,
					successCriteria: "Clear understanding of requirements",
				},
				{
					title: "Implementation",
					agent: "coder",
					description: `Implement the solution for: ${instruction}`,
					successCriteria: "Solution is implemented and functional",
				},
				{
					title: "Verification",
					agent: "tester",
					description: `Verify the implementation for: ${instruction}`,
					successCriteria: "Implementation passes verification",
				},
			)
		}

		return { phases }
	}
}

module.exports = { TaskExecutor, AGENT_DEFINITIONS }
