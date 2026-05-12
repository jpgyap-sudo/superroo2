import { CentralBrain } from "./CentralBrain.js"
import type { CentralBrainOptions } from "./CentralBrain.js"
import { buildContextPacket } from "./buildContextPacket.js"
import type { Agent, AgentRunContext, AgentRunResult } from "../types"
import type { SharedContextPacket } from "@superroo/memory-core"

export interface UnifiedTask {
	source: "vscode" | "cloud" | "telegram" | "cli"
	userId?: string
	projectId: string
	repoPath?: string
	currentFile?: string
	selectedCode?: string
	openTabs?: string[]
	gitBranch?: string
	gitDiff?: string
	recentTerminalErrors?: string[]
	buildStatus?: string
	testStatus?: string
	currentRoute?: string
	userMessage: string
	goal: string
	agent: string
	priority?: "low" | "normal" | "high" | "critical"
	conversationId?: string
	activeTaskId?: string
	payload?: Record<string, unknown>
}

export interface UnifiedTaskResult {
	ok: boolean
	summary: string
	route: string
	routeReason: string
	memorySaved: boolean
	contextPacket: SharedContextPacket
	ragContextText: string
	replyTo?: {
		vscodePanelId?: string
		telegramChatId?: string
		cloudSessionId?: string
	}
}

/**
 * UnifiedTaskRouter is the single entry point for ALL interfaces.
 *
 * VS Code, Cloud IDE, Telegram, and CLI all call `routeTask()`.
 * The router:
 *   1. Builds a SharedContextPacket from the UnifiedTask
 *   2. Queries RAG memory
 *   3. Routes via BrainRouter
 *   4. Executes the agent through CentralBrain
 *   5. Saves experience to memory
 *   6. Returns a UnifiedTaskResult
 *
 * This ensures every interface gets the SAME brain, memory, and routing.
 */
export class UnifiedTaskRouter {
	private readonly brain: CentralBrain
	private agentRegistry = new Map<string, Agent>()

	getAgent(name: string): Agent | undefined {
		return this.agentRegistry.get(name)
	}

	hasAgent(name: string): boolean {
		return this.agentRegistry.has(name)
	}

	constructor(options: CentralBrainOptions = {}) {
		this.brain = new CentralBrain(options)
	}

	/**
	 * Register an agent by name so the router can dispatch to it.
	 */
	registerAgent(name: string, agent: Agent): void {
		this.agentRegistry.set(name, agent)
	}

	/**
	 * The ONE method all interfaces call.
	 */
	async routeTask(task: UnifiedTask): Promise<UnifiedTaskResult> {
		const agent = this.agentRegistry.get(task.agent)
		if (!agent) {
			return {
				ok: false,
				summary: `Unknown agent: ${task.agent}`,
				route: "none",
				routeReason: "Agent not registered",
				memorySaved: false,
				contextPacket: this._toPacket(task),
				ragContextText: "",
			}
		}

		// Build AgentRunContext
		const ctx = this._toAgentRunContext(task)

		// Run through CentralBrain
		const result = await this.brain.run(agent, ctx)

		return {
			ok: result.ok,
			summary: result.summary,
			route: result.route,
			routeReason: result.routeReason,
			memorySaved: result.memorySaved,
			contextPacket: this._toPacket(task),
			ragContextText: result.ragContextText,
			replyTo: task.payload?.replyTo as UnifiedTaskResult["replyTo"],
		}
	}

	/**
	 * VS Code Extension calls this when the user sends a message.
	 */
	async handleVscodeMessage(args: {
		userMessage: string
		currentFile?: string
		selectedCode?: string
		openTabs?: string[]
		gitBranch?: string
		gitDiff?: string
		recentTerminalErrors?: string[]
		buildStatus?: string
		testStatus?: string
		vscodePanelId?: string
		agent?: string
	}): Promise<UnifiedTaskResult> {
		return this.routeTask({
			source: "vscode",
			projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
			userMessage: args.userMessage,
			goal: args.userMessage,
			agent: args.agent ?? "coder",
			currentFile: args.currentFile,
			selectedCode: args.selectedCode,
			openTabs: args.openTabs,
			gitBranch: args.gitBranch,
			gitDiff: args.gitDiff,
			recentTerminalErrors: args.recentTerminalErrors,
			buildStatus: args.buildStatus,
			testStatus: args.testStatus,
			payload: { replyTo: { vscodePanelId: args.vscodePanelId } },
		})
	}

	/**
	 * Cloud IDE calls this when the user sends a chat message.
	 */
	async handleCloudMessage(args: {
		userMessage: string
		currentFile?: string
		selectedCode?: string
		openTabs?: string[]
		terminalOutput?: string[]
		gitBranch?: string
		gitDiff?: string
		buildStatus?: string
		testStatus?: string
		cloudSessionId?: string
		agent?: string
	}): Promise<UnifiedTaskResult> {
		return this.routeTask({
			source: "cloud",
			projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
			userMessage: args.userMessage,
			goal: args.userMessage,
			agent: args.agent ?? "coder",
			currentFile: args.currentFile,
			selectedCode: args.selectedCode,
			openTabs: args.openTabs,
			recentTerminalErrors: args.terminalOutput,
			gitBranch: args.gitBranch,
			gitDiff: args.gitDiff,
			buildStatus: args.buildStatus,
			testStatus: args.testStatus,
			payload: { replyTo: { cloudSessionId: args.cloudSessionId } },
		})
	}

	/**
	 * Telegram Bot calls this for every command.
	 */
	async handleTelegramCommand(args: {
		command: string
		chatId: number
		userId: number
		messageId: number
		agent?: string
	}): Promise<UnifiedTaskResult> {
		const goal = args.command.replace(/^\/[a-zA-Z0-9_]+\b/, "").trim() || args.command
		return this.routeTask({
			source: "telegram",
			projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
			userMessage: goal,
			goal,
			agent: args.agent ?? "coder",
			conversationId: String(args.chatId),
			activeTaskId: `telegram-${args.chatId}-${args.messageId}`,
			payload: { replyTo: { telegramChatId: String(args.chatId) } },
		})
	}

	/**
	 * CLI calls this for command-line tasks.
	 */
	async handleCliTask(args: { goal: string; agent?: string }): Promise<UnifiedTaskResult> {
		return this.routeTask({
			source: "cli",
			projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
			userMessage: args.goal,
			goal: args.goal,
			agent: args.agent ?? "coder",
		})
	}

	async close(): Promise<void> {
		await this.brain.close()
	}

	private _toPacket(task: UnifiedTask): SharedContextPacket {
		return {
			source: task.source,
			userId: task.userId,
			projectId: task.projectId,
			repoPath: task.repoPath,
			currentFile: task.currentFile,
			selectedCode: task.selectedCode,
			openTabs: task.openTabs,
			activeTaskId: task.activeTaskId,
			conversationId: task.conversationId,
			gitBranch: task.gitBranch,
			gitDiff: task.gitDiff,
			recentTerminalErrors: task.recentTerminalErrors,
			currentRoute: task.currentRoute,
			buildStatus: task.buildStatus,
			testStatus: task.testStatus,
			userMessage: task.userMessage,
			timestamp: new Date().toISOString(),
		}
	}

	private _toAgentRunContext(task: UnifiedTask): AgentRunContext {
		return {
			task: {
				id: task.activeTaskId ?? `task-${Date.now()}`,
				agent: task.agent,
				goal: task.goal,
				priority: task.priority ?? "normal",
				requiredCapabilities: [],
				payload: {
					...task.payload,
					source: task.source,
					projectId: task.projectId,
					userMessage: task.userMessage,
				},
				maxIterations: 5,
				status: "running" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				attempts: 0,
			},
			safetyMode: "AUTO" as const,
			signal: new AbortController().signal,
			emit: (level, event, message, data?) => {
				console.log(`[unified-router][${level}] ${event}: ${message}`, data ?? "")
			},
		}
	}
}
