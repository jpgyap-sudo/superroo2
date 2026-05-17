import type { LogSummary } from "./LogSummarizer"

export function buildDeepSeekImplementationTask(summary: LogSummary): string {
	return (
		`You are the cheap implementation coder for SuperRoo.\n\n` +
		`STRICT RULES:\n` +
		`- Do not redesign architecture.\n` +
		`- Only change files needed for this bug.\n` +
		`- Prefer small patch.\n` +
		`- Return unified diff first, explanation second.\n` +
		`- Include test commands.\n\n` +
		`BUG SUMMARY:\n${summary.oneLine}\n\n` +
		`ROOT CAUSE:\n${summary.rootCause}\n\n` +
		`AFFECTED FILES:\n${summary.affectedFiles.map((f) => `- ${f}`).join("\n") || "- unknown"}\n\n` +
		`IMPLEMENTATION TASK:\n${summary.suggestedFix}\n\n` +
		`EVIDENCE:\n${summary.evidence.map((e) => `- ${e}`).join("\n") || "- none"}\n`
	)
}
