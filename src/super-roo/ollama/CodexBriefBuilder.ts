import type { LogSummary } from "./LogSummarizer"

export function buildCodexBrief(summary: LogSummary): string {
	return (
		`# Codex Debug Brief\n\n` +
		`## Source\n${summary.source}${summary.project ? ` / ${summary.project}` : ""}\n\n` +
		`## Severity\n${summary.severity}\n\n` +
		`## One-line Problem\n${summary.oneLine}\n\n` +
		`## Likely Root Cause\n${summary.rootCause}\n\n` +
		`## Evidence\n${summary.evidence.map((e) => `- ${e}`).join("\n") || "- none"}\n\n` +
		`## Affected Files\n${summary.affectedFiles.map((f) => `- ${f}`).join("\n") || "- unknown"}\n\n` +
		`## Suggested Direction\n${summary.suggestedFix}\n\n` +
		`## Instruction\nAct as senior debugger/reviewer. Do not do broad redesign. Produce a repair plan, risky assumptions, test command, and rollback notes.\n\n` +
		`## Ollama Raw Output\n${summary.rawModelOutput}\n`
	)
}
