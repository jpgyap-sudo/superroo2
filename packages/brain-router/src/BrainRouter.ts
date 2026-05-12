import type { BrainDecision, BrainRequest, ModelRunMetrics } from "./types.js"

const OLLAMA_TASKS = new Set([
	"summarize",
	"classify_error",
	"tag_memory",
	"compress_memory",
	"telegram_short_reply",
	"title_generation",
	"embedding",
	"summarize_log",
])

const HIGH_RISK_PATTERNS = ["delete", "remove", "production", "drop", "deploy", "rollback", "permission", "security"]

export interface BrainRouterOptions {
	ollamaModel?: string
	cloudModel?: string
	enableHermes?: boolean
	enableOpenClaw?: boolean
	cheapFirst?: boolean
}

export class BrainRouter {
	private readonly ollamaModel: string
	private readonly cloudModel: string
	private readonly enableHermes: boolean
	private readonly enableOpenClaw: boolean
	private readonly cheapFirst: boolean
	private metrics: ModelRunMetrics[] = []

	constructor(options: BrainRouterOptions = {}) {
		this.ollamaModel = options.ollamaModel ?? process.env.OLLAMA_CHEAP_TEXT_MODEL ?? "qwen2.5:0.5b"
		this.cloudModel = options.cloudModel ?? "best-available-coding-model"
		this.enableHermes = options.enableHermes ?? process.env.SUPERROO_ENABLE_HERMES === "true"
		this.enableOpenClaw = options.enableOpenClaw ?? process.env.SUPERROO_ENABLE_OPENCLAW === "true"
		this.cheapFirst = options.cheapFirst ?? true
	}

	choose(req: BrainRequest): BrainDecision {
		const text = req.packet.userMessage.toLowerCase()
		const taskType = req.taskType?.toLowerCase() ?? ""

		if (req.riskLevel === "high") {
			return {
				route: "cloud",
				model: this.cloudModel,
				reason: "High-risk task requires stronger reasoning and review.",
				requiresApproval: true,
			}
		}

		if (taskType && OLLAMA_TASKS.has(taskType)) {
			return {
				route: "ollama",
				model: this.ollamaModel,
				reason: "Cheap repetitive task suitable for local Ollama.",
			}
		}

		if (
			this.enableHermes &&
			(text.includes("plan") ||
				text.includes("architecture") ||
				text.includes("break down") ||
				text.includes("strategy"))
		) {
			return {
				route: "hermes",
				reason: "Planning/reflection task suitable for Hermes planner.",
				requiresApproval: true,
			}
		}

		if (
			this.enableOpenClaw &&
			(text.includes("edit") ||
				text.includes("run") ||
				text.includes("execute") ||
				text.includes("open browser") ||
				text.includes("deploy"))
		) {
			return {
				route: "openclaw",
				reason: "Execution-oriented task suitable for OpenClaw through Tool Registry.",
				requiresApproval: true,
			}
		}

		if (this._isHighRisk(text)) {
			return {
				route: "cloud",
				model: this.cloudModel,
				reason: "Detected high-risk keywords — route to strongest model with approval.",
				requiresApproval: true,
			}
		}

		if (this.cheapFirst && req.riskLevel === "low" && this._isCheapTask(text)) {
			return {
				route: "ollama",
				model: this.ollamaModel,
				reason: "Low-risk simple task — try cheap Ollama first, fallback to cloud if needed.",
			}
		}

		return {
			route: "cloud",
			model: this.cloudModel,
			reason: "Default to cloud coding model for general coding/debugging.",
		}
	}

	recordMetrics(m: ModelRunMetrics): void {
		this.metrics.push(m)
		if (this.metrics.length > 1000) this.metrics = this.metrics.slice(-1000)
	}

	getMetrics(): ModelRunMetrics[] {
		return [...this.metrics]
	}

	getBestModelFor(taskType: string): string {
		const relevant = this.metrics.filter((m) => m.taskType === taskType)
		if (relevant.length === 0) return this.cloudModel

		const byModel = new Map<string, { success: number; total: number; cost: number; latency: number }>()
		for (const m of relevant) {
			const key = `${m.modelProvider}/${m.modelName}`
			const cur = byModel.get(key) ?? { success: 0, total: 0, cost: 0, latency: 0 }
			cur.total++
			if (m.success) cur.success++
			cur.cost += m.costUsd
			cur.latency += m.latencyMs
			byModel.set(key, cur)
		}

		let best = this.cloudModel
		let bestScore = -Infinity
		for (const [key, stats] of byModel) {
			const score = (stats.success / stats.total) * 100 - stats.cost * 10 - stats.latency * 0.001
			if (score > bestScore) {
				bestScore = score
				best = key
			}
		}
		return best
	}

	private _isHighRisk(text: string): boolean {
		return HIGH_RISK_PATTERNS.some((p) => text.includes(p))
	}

	private _isCheapTask(text: string): boolean {
		const cheapPatterns = ["summarize", "explain", "what is", "how to", "tag", "classify", "title", "short"]
		return cheapPatterns.some((p) => text.includes(p))
	}
}
