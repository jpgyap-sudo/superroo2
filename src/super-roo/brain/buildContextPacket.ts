import type { AgentRunContext } from "../types"
import type { SharedContextPacket } from "@superroo/memory-core"

/**
 * Build a SharedContextPacket from an AgentRunContext.
 *
 * The packet captures everything the Brain needs to route, retrieve memory,
 * and build RAG context. Most optional fields are sourced from
 * `ctx.task.payload` so callers can inject VS Code / Cloud / Telegram context
 * without changing the agent itself.
 */
export function buildContextPacket(
	ctx: AgentRunContext,
	overrides?: Partial<SharedContextPacket>,
): SharedContextPacket {
	const payload = ctx.task.payload ?? {}

	return {
		source: (payload.source as SharedContextPacket["source"]) ?? "cli",
		projectId: (payload.projectId as string) ?? process.env.SUPERROO_PROJECT_ID ?? "superroo2",
		userId: payload.userId as string | undefined,
		repoPath: payload.repoPath as string | undefined,
		currentFile: payload.currentFile as string | undefined,
		selectedCode: payload.selectedCode as string | undefined,
		openTabs: Array.isArray(payload.openTabs) ? (payload.openTabs as string[]) : undefined,
		activeTaskId: ctx.task.parentTaskId ?? (payload.activeTaskId as string | undefined),
		conversationId: payload.conversationId as string | undefined,
		gitBranch: payload.gitBranch as string | undefined,
		gitDiff: payload.gitDiff as string | undefined,
		recentTerminalErrors: Array.isArray(payload.recentTerminalErrors)
			? (payload.recentTerminalErrors as string[])
			: undefined,
		currentRoute: payload.currentRoute as string | undefined,
		buildStatus: payload.buildStatus as string | undefined,
		testStatus: payload.testStatus as string | undefined,
		userMessage: ctx.task.goal,
		timestamp: new Date().toISOString(),
		...overrides,
	}
}
