import { OllamaClient } from "./OllamaClient"
import { LogSummarizer, type LogSummaryInput } from "./LogSummarizer"
import { buildCodexBrief } from "./CodexBriefBuilder"
import { buildDeepSeekImplementationTask } from "./DeepSeekTaskBuilder"

export interface OllamaPipelineResult {
	summary: Awaited<ReturnType<LogSummarizer["summarize"]>>
	codexBrief: string
	deepseekTask: string
}

export class OllamaPipeline {
	private client: OllamaClient
	private summarizer: LogSummarizer

	constructor(client = new OllamaClient()) {
		this.client = client
		this.summarizer = new LogSummarizer(client)
	}

	async health() {
		return this.client.health()
	}

	async processLogs(input: LogSummaryInput): Promise<OllamaPipelineResult> {
		const summary = await this.summarizer.summarize(input)
		return {
			summary,
			codexBrief: buildCodexBrief(summary),
			deepseekTask: buildDeepSeekImplementationTask(summary),
		}
	}
}
