/**
 * Super Roo — OpenClaw Adapter
 *
 * OpenClaw is an ANALYSIS-ONLY agent. It NEVER writes code or makes changes.
 * Its role is repo investigation, dependency tracing, config inspection,
 * static code reading, and planning — all read-only operations.
 *
 * Restrictions (enforced):
 *   - --plan-only flag is always passed
 *   - No direct production edits
 *   - No system cleanup/migration without snapshot
 *   - No file writes, no code generation
 *
 * Strengths:
 *   - Static code reading & understanding
 *   - Dependency tracing & broken import detection
 *   - Config/environment inspection (package.json, tsconfig, Dockerfile, env)
 *   - Route & API endpoint discovery
 *   - Database schema analysis
 *   - Finding duplicate logic
 *   - Generating analysis reports for the Chief Engineer
 */

import { execa } from "execa"
import { EventEmitter } from "events"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type OpenClawAnalysisType =
	| "repo_investigation"
	| "dependency_trace"
	| "config_inspection"
	| "code_reading"
	| "route_discovery"
	| "schema_analysis"
	| "duplicate_detection"
	| "impact_analysis"
	| "risk_assessment"

export interface OpenClawAnalysisRequest {
	/** What to analyze */
	topic: string
	/** Type of analysis */
	type: OpenClawAnalysisType
	/** Repo path or identifier */
	repoPath?: string
	/** Specific files to focus on */
	files?: string[]
	/** Additional context for the analysis */
	context?: string
	/** Whether to include full file contents in the report (default: false) */
	includeFileContents?: boolean
}

export interface OpenClawAnalysisResult {
	/** The analysis report text */
	report: string
	/** Duration in ms */
	durationMs: number
	/** Whether the analysis was successful */
	success: boolean
	/** Error message if failed */
	error?: string
	/** Files that were analyzed */
	filesAnalyzed: string[]
	/** Key findings extracted from the report */
	keyFindings: string[]
	/** Risk flags identified */
	riskFlags: string[]
}

export interface OpenClawAdapterConfig {
	/** CLI command for OpenClaw. Default: "openclaw" or env OPENCLAW_CLI */
	cliPath: string
	/** Timeout per analysis in ms. Default: 120000 (2 min) */
	timeoutMs: number
	/** Whether to enable sandbox mode. Default: true */
	useSandbox: boolean
	/** Max files to analyze per request. Default: 20 */
	maxFilesPerRequest: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OpenClawAdapterConfig = {
	cliPath: process.env.OPENCLAW_CLI || "openclaw",
	timeoutMs: 120_000,
	useSandbox: true,
	maxFilesPerRequest: 20,
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenClawAdapter
// ──────────────────────────────────────────────────────────────────────────────

export class OpenClawAdapter extends EventEmitter {
	private config: OpenClawAdapterConfig
	private analysisCount = 0
	private totalDurationMs = 0

	constructor(config: Partial<OpenClawAdapterConfig> = {}) {
		super()
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Run an analysis. This is READ-ONLY — no code is ever written.
	 * The --plan-only flag is always enforced.
	 */
	async analyze(request: OpenClawAnalysisRequest): Promise<OpenClawAnalysisResult> {
		const startTime = Date.now()
		this.analysisCount++
		const analysisId = `openclaw_${Date.now()}_${this.analysisCount}`

		this.emit("analysis:start", { analysisId, topic: request.topic, type: request.type })

		try {
			// Build the analysis prompt
			const prompt = this.buildAnalysisPrompt(request)

			// Call OpenClaw with --plan-only (analysis mode, never coding)
			const cliArgs = ["run", "--plan-only"]
			if (this.config.useSandbox) {
				cliArgs.push("--sandbox")
			}
			cliArgs.push(prompt)

			const result = await execa(this.config.cliPath, cliArgs, {
				reject: false,
				timeout: this.config.timeoutMs,
			})

			const durationMs = Date.now() - startTime
			this.totalDurationMs += durationMs

			const output = result.stdout || result.stderr || `OpenClaw exited ${result.exitCode}`
			const success = result.exitCode === 0

			// Parse findings from output
			const keyFindings = this.extractFindings(output)
			const riskFlags = this.extractRiskFlags(output)

			const analysisResult: OpenClawAnalysisResult = {
				report: output,
				durationMs,
				success,
				error: success ? undefined : `OpenClaw exited with code ${result.exitCode}`,
				filesAnalyzed: request.files ?? [],
				keyFindings,
				riskFlags,
			}

			this.emit("analysis:complete", { analysisId, ...analysisResult })
			return analysisResult
		} catch (err) {
			const durationMs = Date.now() - startTime
			this.totalDurationMs += durationMs
			const errorMsg = err instanceof Error ? err.message : String(err)

			this.emit("analysis:error", { analysisId, error: errorMsg })

			return {
				report: "",
				durationMs,
				success: false,
				error: errorMsg,
				filesAnalyzed: request.files ?? [],
				keyFindings: [],
				riskFlags: [],
			}
		}
	}

	/**
	 * Quick repo investigation — checks structure, config, dependencies.
	 */
	async investigateRepo(repoPath: string): Promise<OpenClawAnalysisResult> {
		return this.analyze({
			topic: `Investigate repository at ${repoPath}`,
			type: "repo_investigation",
			repoPath,
			context:
				"Analyze the repo structure, identify the tech stack, " +
				"check package.json for dependencies, check tsconfig for TypeScript config, " +
				"check Dockerfile if present, and report any issues found. " +
				"This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Trace dependencies for a specific file or feature.
	 */
	async traceDependencies(filePath: string, repoPath?: string): Promise<OpenClawAnalysisResult> {
		return this.analyze({
			topic: `Trace dependencies for ${filePath}`,
			type: "dependency_trace",
			repoPath,
			files: [filePath],
			context:
				"Trace all imports, requires, and references for the given file. " +
				"Identify broken imports, circular dependencies, and unused dependencies. " +
				"This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Inspect configuration files for issues.
	 */
	async inspectConfig(repoPath: string): Promise<OpenClawAnalysisResult> {
		return this.analyze({
			topic: `Inspect configuration for ${repoPath}`,
			type: "config_inspection",
			repoPath,
			context:
				"Inspect package.json, tsconfig.json, .env.example, Dockerfile, " +
				"and any other config files. Report misconfigurations, missing env vars, " +
				"and potential issues. This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Read and analyze specific code files.
	 */
	async readCode(files: string[], repoPath?: string): Promise<OpenClawAnalysisResult> {
		const limitedFiles = files.slice(0, this.config.maxFilesPerRequest)
		return this.analyze({
			topic: `Read and analyze ${limitedFiles.length} file(s)`,
			type: "code_reading",
			repoPath,
			files: limitedFiles,
			context:
				"Read the specified files and provide a summary of their purpose, " +
				"key functions/classes, and any issues found. " +
				"This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Discover routes and API endpoints.
	 */
	async discoverRoutes(repoPath: string): Promise<OpenClawAnalysisResult> {
		return this.analyze({
			topic: `Discover routes and API endpoints in ${repoPath}`,
			type: "route_discovery",
			repoPath,
			context:
				"Scan the codebase for route definitions, API endpoints, " +
				"and middleware configurations. Map out the API surface. " +
				"This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Analyze impact of a potential change.
	 */
	async analyzeImpact(files: string[], goal: string, repoPath?: string): Promise<OpenClawAnalysisResult> {
		const limitedFiles = files.slice(0, this.config.maxFilesPerRequest)
		return this.analyze({
			topic: `Impact analysis for: ${goal}`,
			type: "impact_analysis",
			repoPath,
			files: limitedFiles,
			context:
				`Analyze the impact of making changes to achieve: "${goal}". ` +
				`Files to consider: ${limitedFiles.join(", ")}. ` +
				"Identify which other files would be affected, potential risks, " +
				"and suggest the safest approach. This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	/**
	 * Assess risks for a planned change.
	 */
	async assessRisk(goal: string, affectedFiles: string[], repoPath?: string): Promise<OpenClawAnalysisResult> {
		return this.analyze({
			topic: `Risk assessment for: ${goal}`,
			type: "risk_assessment",
			repoPath,
			files: affectedFiles,
			context:
				`Assess the risk level of implementing: "${goal}". ` +
				`Affected files: ${affectedFiles.join(", ")}. ` +
				"Consider: regression risk, data integrity, security implications, " +
				"deployment risk, and rollback complexity. " +
				"This is READ-ONLY analysis. Do NOT modify any files.",
		})
	}

	// ── Stats ──────────────────────────────────────────────────────────────

	getStats() {
		return {
			analysisCount: this.analysisCount,
			totalDurationMs: this.totalDurationMs,
			averageDurationMs: this.analysisCount > 0 ? Math.round(this.totalDurationMs / this.analysisCount) : 0,
		}
	}

	resetStats(): void {
		this.analysisCount = 0
		this.totalDurationMs = 0
	}

	// ── Private ────────────────────────────────────────────────────────────

	private buildAnalysisPrompt(request: OpenClawAnalysisRequest): string {
		const parts: string[] = [
			`[ANALYSIS REQUEST]`,
			`Topic: ${request.topic}`,
			`Type: ${request.type}`,
			``,
			`RULES:`,
			`- This is ANALYSIS ONLY. Do NOT write, edit, or create any files.`,
			`- Do NOT execute any commands that modify the system.`,
			`- Do NOT install any packages.`,
			`- Do NOT run any build or test commands.`,
			`- Only read files and report findings.`,
			`- If you find issues, describe them — do NOT fix them.`,
		]

		if (request.repoPath) {
			parts.push(``, `Repo path: ${request.repoPath}`)
		}

		if (request.files && request.files.length > 0) {
			parts.push(``, `Files to analyze:`, ...request.files.map((f) => `  - ${f}`))
		}

		if (request.context) {
			parts.push(``, `Context:`, request.context)
		}

		if (request.includeFileContents) {
			parts.push(``, `Include full file contents in the report.`)
		}

		parts.push(
			``,
			`OUTPUT FORMAT:`,
			`Provide your analysis in the following sections:`,
			`1. Summary — brief overview of findings`,
			`2. Key Findings — bullet list of important discoveries`,
			`3. Risk Flags — any potential issues or concerns`,
			`4. Recommendations — suggested next steps (do NOT implement them)`,
		)

		return parts.join("\n")
	}

	private extractFindings(output: string): string[] {
		const findings: string[] = []
		const lines = output.split("\n")
		let inFindings = false

		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed.toLowerCase().includes("key findings") || trimmed.toLowerCase().includes("findings:")) {
				inFindings = true
				continue
			}
			if (inFindings) {
				if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
					findings.push(trimmed.replace(/^[-*]\s*/, ""))
				} else if (trimmed === "" && findings.length > 0) {
					break
				}
			}
		}

		return findings.length > 0 ? findings : ["No structured findings extracted"]
	}

	private extractRiskFlags(output: string): string[] {
		const flags: string[] = []
		const lines = output.split("\n")
		let inFlags = false

		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed.toLowerCase().includes("risk flag") || trimmed.toLowerCase().includes("risk:")) {
				inFlags = true
				continue
			}
			if (inFlags) {
				if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
					flags.push(trimmed.replace(/^[-*]\s*/, ""))
				} else if (trimmed === "" && flags.length > 0) {
					break
				}
			}
		}

		return flags
	}
}
