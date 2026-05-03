import type {
	ClineMessage,
	FileChange,
	CommandRun,
	CheckpointRecord,
	ToolUsageSummary,
	WorkRecord,
	ToolUsage,
} from "@superroo/types"

/**
 * Extract a WorkRecord from a task's ClineMessages and metadata.
 *
 * This transforms raw chat history into a structured work artifact that
 * can be displayed in the UI, exported, or used for analytics.
 */
export function buildWorkRecord({
	title,
	messages,
	toolUsage,
	cost,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	childIds,
}: {
	title: string
	messages: ClineMessage[]
	toolUsage: ToolUsage
	cost: number
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	childIds?: string[]
}): WorkRecord {
	const changedFiles: FileChange[] = []
	const commandsRun: CommandRun[] = []
	const checkpoints: CheckpointRecord[] = []
	let outcome: string | undefined

	for (const msg of messages) {
		if (msg.type !== "say") continue

		switch (msg.say) {
			case "checkpoint_saved": {
				if (msg.text) {
					checkpoints.push({ hash: msg.text, ts: msg.ts })
				}
				break
			}
			case "completion_result": {
				if (msg.text) {
					outcome = msg.text
				}
				break
			}
			case "tool": {
				// Tool results are stored as JSON strings in `text`
				if (!msg.text) break
				try {
					const toolData = JSON.parse(msg.text) as Record<string, unknown>
					if (toolData.tool === "newFileCreated" && typeof toolData.path === "string") {
						changedFiles.push({ path: toolData.path, operation: "create", ts: msg.ts })
					}
					if (toolData.tool === "editedExistingFile" && typeof toolData.path === "string") {
						changedFiles.push({ path: toolData.path, operation: "update", ts: msg.ts })
					}
					if (toolData.tool === "appliedDiff" && typeof toolData.path === "string") {
						changedFiles.push({ path: toolData.path, operation: "patch", ts: msg.ts })
					}
					if (toolData.tool === "executeCommand" && typeof toolData.command === "string") {
						commandsRun.push({ command: toolData.command, ts: msg.ts })
					}
				} catch {
					// Not JSON or unexpected shape — ignore
				}
				break
			}
			case "command_output": {
				// Command output messages may also carry the command info
				if (msg.text) {
					try {
						const outputData = JSON.parse(msg.text) as Record<string, unknown>
						if (typeof outputData.command === "string" && typeof outputData.output === "string") {
							commandsRun.push({ command: outputData.command, ts: msg.ts })
						}
					} catch {
						// plain text output — ignore
					}
				}
				break
			}
		}
	}

	// Deduplicate files by path (keep first occurrence / earliest ts)
	const seenFiles = new Set<string>()
	const uniqueFiles: FileChange[] = []
	for (const f of changedFiles) {
		if (!seenFiles.has(f.path)) {
			seenFiles.add(f.path)
			uniqueFiles.push(f)
		}
	}

	// Deduplicate commands (keep first occurrence)
	const seenCommands = new Set<string>()
	const uniqueCommands: CommandRun[] = []
	for (const c of commandsRun) {
		if (!seenCommands.has(c.command)) {
			seenCommands.add(c.command)
			uniqueCommands.push(c)
		}
	}

	const toolUsageSummary: ToolUsageSummary[] = Object.entries(toolUsage).map(([name, stats]) => ({
		name,
		attempts: stats.attempts,
		failures: stats.failures,
	}))

	return {
		title: title.trim() || undefined,
		changedFiles: uniqueFiles.length > 0 ? uniqueFiles : undefined,
		commandsRun: uniqueCommands.length > 0 ? uniqueCommands : undefined,
		checkpoints: checkpoints.length > 0 ? checkpoints : undefined,
		cost,
		tokensIn,
		tokensOut,
		cacheWrites,
		cacheReads,
		outcome,
		followUpTaskIds: childIds && childIds.length > 0 ? childIds : undefined,
		followUpTaskCount: childIds?.length,
		toolUsage: toolUsageSummary.length > 0 ? toolUsageSummary : undefined,
		generatedAt: new Date().toISOString(),
	}
}
