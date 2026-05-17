import { OllamaClient } from "./OllamaClient"

export interface LogSummaryInput {
	source: "vs-superroo" | "telegram" | "cloud-ide" | "agent" | string
	project?: string
	command?: string
	logs: string
	changedFiles?: string[]
	maxChars?: number
}

export interface LogSummary {
	source: string
	project?: string
	command?: string
	severity: "info" | "warning" | "error" | "critical" | "unknown"
	oneLine: string
	rootCause: string
	evidence: string[]
	affectedFiles: string[]
	suggestedFix: string
	retrySafe: boolean
	needsSeniorReview: boolean
	rawModelOutput: string
}

const SYSTEM = `You are SuperRoo's local Ollama log summarizer.
Your job is NOT to redesign the app.
Your job is to compress noisy logs into a precise debugging brief.
Be conservative. If uncertain, say unknown.
Return strict JSON only.`

export class LogSummarizer {
	constructor(private ollama = new OllamaClient()) {}

	async summarize(input: LogSummaryInput): Promise<LogSummary> {
		const maxChars = input.maxChars || Number(process.env.OLLAMA_MAX_LOG_CHARS || 30000)
		const trimmedLogs =
			input.logs.length > maxChars
				? `${input.logs.slice(0, Math.floor(maxChars * 0.65))}\n\n...[TRUNCATED MIDDLE]...\n\n${input.logs.slice(-Math.floor(maxChars * 0.35))}`
				: input.logs

		const prompt = `Summarize these logs.\n\nContext:\nsource=${input.source}\nproject=${input.project || "unknown"}\ncommand=${input.command || "unknown"}\nchangedFiles=${(input.changedFiles || []).join(", ") || "unknown"}\n\nReturn JSON with exactly these keys:\nseverity, oneLine, rootCause, evidence, affectedFiles, suggestedFix, retrySafe, needsSeniorReview\n\nRules:\n- evidence must be short strings copied or paraphrased from logs\n- affectedFiles should include only likely relevant files\n- if risky, set needsSeniorReview=true\n\nLogs:\n${trimmedLogs}`

		const raw = await this.ollama.generate({ prompt, system: SYSTEM, format: "json", temperature: 0 })
		const parsed = this.safeJson(raw)

		return {
			source: input.source,
			project: input.project,
			command: input.command,
			severity: parsed.severity || "unknown",
			oneLine: parsed.oneLine || "No summary generated.",
			rootCause: parsed.rootCause || "unknown",
			evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
			affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : input.changedFiles || [],
			suggestedFix: parsed.suggestedFix || "unknown",
			retrySafe: Boolean(parsed.retrySafe),
			needsSeniorReview: parsed.needsSeniorReview !== false,
			rawModelOutput: raw,
		}
	}

	private safeJson(raw: string): any {
		try {
			return JSON.parse(raw)
		} catch {}
		const match = raw.match(/\{[\s\S]*\}/)
		if (match) {
			try {
				return JSON.parse(match[0])
			} catch {}
		}
		return { oneLine: raw.slice(0, 500), raw }
	}
}
