import type { WorkRecord } from "@superroo/types"

/**
 * Generate a human-readable markdown summary from a WorkRecord.
 *
 * This is intended for export / sharing and provides a concise
 * overview of what the task accomplished.
 */
export function generateWorkRecordMarkdown(record: WorkRecord): string {
	const lines: string[] = []

	const title = record.title ?? "Untitled Task"
	lines.push(`# ${title}`)
	lines.push(``)

	if (record.generatedAt) {
		lines.push(`**Generated:** ${record.generatedAt}`)
		lines.push(``)
	}

	// Cost & token summary
	if (record.cost !== undefined) {
		lines.push(`## Cost`)
		lines.push(`- **Total Cost:** $${record.cost.toFixed(4)}`)
		if (record.tokensIn !== undefined && record.tokensOut !== undefined) {
			lines.push(
				`- **Tokens:** ${record.tokensIn.toLocaleString()} in / ${record.tokensOut.toLocaleString()} out`,
			)
		}
		if (record.cacheWrites !== undefined && record.cacheReads !== undefined) {
			lines.push(
				`- **Cache:** ${record.cacheWrites.toLocaleString()} writes / ${record.cacheReads.toLocaleString()} reads`,
			)
		}
		lines.push(``)
	}

	// Outcome
	if (record.outcome) {
		lines.push(`## Outcome`)
		lines.push(record.outcome)
		lines.push(``)
	}

	// Changed files
	if (record.changedFiles && record.changedFiles.length > 0) {
		lines.push(`## Changed Files (${record.changedFiles.length})`)
		for (const f of record.changedFiles) {
			const icon =
				f.operation === "create"
					? "➕"
					: f.operation === "delete"
						? "🗑️"
						: f.operation === "patch"
							? "🩹"
							: "✏️"
			lines.push(`- ${icon} \`${f.path}\``)
		}
		lines.push(``)
	}

	// Commands
	if (record.commandsRun && record.commandsRun.length > 0) {
		lines.push(`## Commands Run (${record.commandsRun.length})`)
		for (const c of record.commandsRun) {
			const exitBadge = c.exitCode !== undefined ? `(exit ${c.exitCode})` : ""
			lines.push(`- \`\`\`bash`)
			lines.push(`  ${c.command}`)
			lines.push(`  \`\`\` ${exitBadge}`)
		}
		lines.push(``)
	}

	// Checkpoints
	if (record.checkpoints && record.checkpoints.length > 0) {
		lines.push(`## Checkpoints (${record.checkpoints.length})`)
		for (const cp of record.checkpoints) {
			lines.push(`- \`${cp.hash}\` at ${new Date(cp.ts).toISOString()}`)
		}
		lines.push(``)
	}

	// Tool usage
	if (record.toolUsage && record.toolUsage.length > 0) {
		lines.push(`## Tool Usage`)
		for (const tu of record.toolUsage) {
			lines.push(`- **${tu.name}:** ${tu.attempts} attempts, ${tu.failures} failures`)
		}
		lines.push(``)
	}

	// Follow-up tasks
	if (record.followUpTaskIds && record.followUpTaskIds.length > 0) {
		lines.push(`## Follow-up Tasks (${record.followUpTaskIds.length})`)
		for (const id of record.followUpTaskIds) {
			lines.push(`- ${id}`)
		}
		lines.push(``)
	}

	return lines.join("\n")
}
