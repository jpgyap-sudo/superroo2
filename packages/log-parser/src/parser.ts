/**
 * Log Parser — Error Reader & Classifier
 *
 * Parses terminal output to detect errors, classify them,
 * extract root causes, and suggest fixes.
 */

import type { ErrorAnalysis, ErrorType } from "../../terminal-core/src/types"

// ─── Error Detection Patterns ────────────────────────────────────────────

interface ErrorPattern {
	type: ErrorType
	patterns: RegExp[]
	confidence: number
	extractRootCause: (match: RegExpExecArray, lines: string[]) => string
	extractFiles: (match: RegExpExecArray, lines: string[]) => string[]
	suggestFix: (match: RegExpExecArray, lines: string[]) => string | null
}

const ERROR_PATTERNS: ErrorPattern[] = [
	// TypeScript errors
	{
		type: "typescript",
		patterns: [
			/TS\d{1,6}:\s*(.+)/i,
			/TypeScript\s+error/i,
			/Cannot find module\s+'(.+?)'/i,
			/Type\s+'(.+?)'\s+is not assignable/i,
			/Property\s+'(.+?)'\s+does not exist/i,
		],
		confidence: 0.9,
		extractRootCause: (match) => match[1] || "TypeScript compilation error",
		extractFiles: (_match, lines) => {
			return lines
				.filter((l) => l.includes(".ts:") || l.includes(".tsx:"))
				.map((l) => l.split(":")[0].trim())
				.filter(Boolean)
		},
		suggestFix: (match) => {
			const msg = match[1]?.toLowerCase() || ""
			if (msg.includes("cannot find module")) return "Install missing dependency or fix import path"
			if (msg.includes("not assignable")) return "Fix type mismatch — check the expected vs actual types"
			if (msg.includes("does not exist")) return "Add the missing property to the type definition"
			return "Run `pnpm typecheck` for full error list"
		},
	},

	// Missing environment variables
	{
		type: "missing_env",
		patterns: [
			/(\w+_URL|DATABASE_URL|API_KEY|SECRET|TOKEN)\s+(is not defined|is not set|not found|missing)/i,
			/Missing\s+environment\s+variable/i,
			/Environment\s+variable\s+(\w+)\s+not/i,
		],
		confidence: 0.85,
		extractRootCause: (match) => `Missing environment variable: ${match[1] || "unknown"}`,
		extractFiles: () => [".env.example"],
		suggestFix: (match) => `Set the ${match[1] || "missing"} environment variable in .env or deployment config`,
	},

	// Dependency errors
	{
		type: "dependency",
		patterns: [
			/ERR_PNPM/i,
			/MODULE_NOT_FOUND/i,
			/Cannot find module/i,
			/not found.*node_modules/i,
			/dependency\s+not\s+found/i,
			/peer\s+dependencies?.*missing/i,
		],
		confidence: 0.8,
		extractRootCause: (match) => match[0] || "Dependency resolution error",
		extractFiles: () => ["package.json"],
		suggestFix: () => "Run `pnpm install` to reinstall dependencies",
	},

	// Docker errors
	{
		type: "docker",
		patterns: [
			/Error response from daemon/i,
			/Cannot connect to the Docker daemon/i,
			/Container\s+(\w+)\s+exited/i,
			/docker:\s+.*not found/i,
			/port\s+is\s+already\s+allocated/i,
		],
		confidence: 0.85,
		extractRootCause: (match) => match[0] || "Docker operation failed",
		extractFiles: () => ["Dockerfile", "docker-compose.yml"],
		suggestFix: (match) => {
			const msg = match[0].toLowerCase()
			if (msg.includes("connect to the docker daemon")) return "Start Docker Desktop or Docker daemon"
			if (msg.includes("already allocated")) return "Stop the conflicting container or change the port mapping"
			return "Check Docker logs with `docker logs <container>`"
		},
	},

	// Port conflicts
	{
		type: "port_conflict",
		patterns: [
			/EADDRINUSE/i,
			/port\s+\d+\s+already\s+in\s+use/i,
			/address\s+already\s+in\s+use/i,
			/cannot\s+bind\s+to\s+port/i,
		],
		confidence: 0.9,
		extractRootCause: (match) => {
			const portMatch = match[0].match(/(\d+)/)
			return `Port ${portMatch ? portMatch[1] : "unknown"} is already in use`
		},
		extractFiles: () => [],
		suggestFix: (match) => {
			const portMatch = match[0].match(/(\d+)/)
			const port = portMatch ? portMatch[1] : "the"
			return `Kill the process using port ${port} or change the port in config`
		},
	},

	// Build failures
	{
		type: "build_failure",
		patterns: [
			/Build failed/i,
			/error during build/i,
			/Failed to compile/i,
			/build.*error/i,
			/Module build failed/i,
		],
		confidence: 0.85,
		extractRootCause: (match) => match[0] || "Build process failed",
		extractFiles: (_match, lines) => {
			return lines
				.filter((l) => l.includes("Error:") || l.includes("error:"))
				.map((l) => {
					const parts = l.split(":")
					return parts.length > 1 ? parts[0].trim() : ""
				})
				.filter(Boolean)
		},
		suggestFix: () => "Check the build output above for specific errors and fix them",
	},

	// Runtime crashes
	{
		type: "runtime_crash",
		patterns: [
			/Uncaught\s+(Exception|Error|TypeError|ReferenceError)/i,
			/Unhandled\s+Promise\s+Rejection/i,
			/Cannot\s+read\s+properties?\s+of\s+(undefined|null)/i,
			/segmentation\s+fault/i,
			/abort\s+was\s+called/i,
		],
		confidence: 0.8,
		extractRootCause: (match) => match[0] || "Runtime crash",
		extractFiles: (_match, lines) => {
			return lines
				.filter((l) => l.includes("at ") && (l.includes(".ts:") || l.includes(".js:")))
				.map((l) => {
					const atMatch = l.match(/at\s+(.+?)\s+\((.+?):/)
					return atMatch ? atMatch[2] : ""
				})
				.filter(Boolean)
		},
		suggestFix: () => "Check the stack trace above and fix the failing function",
	},

	// Git conflicts
	{
		type: "git_conflict",
		patterns: [
			/Merge conflict/i,
			/CONFLICT/i,
			/Automatic merge failed/i,
			/Your branch and '.*' have diverged/i,
			/Failed to merge/i,
		],
		confidence: 0.9,
		extractRootCause: (match) => match[0] || "Git merge conflict",
		extractFiles: (_match, lines) => {
			return lines
				.filter((l) => l.includes("CONFLICT") || l.includes("both modified:"))
				.map((l) => {
					const parts = l.split(" ")
					return parts[parts.length - 1]
				})
				.filter(Boolean)
		},
		suggestFix: () => "Resolve conflicts manually, then `git add` and `git commit`",
	},

	// Permission errors
	{
		type: "permission",
		patterns: [
			/Permission denied/i,
			/EACCES/i,
			/EPERM/i,
			/not\s+authorized/i,
			/access\s+denied/i,
		],
		confidence: 0.85,
		extractRootCause: (match) => match[0] || "Permission denied",
		extractFiles: () => [],
		suggestFix: () => "Check file permissions or run with appropriate credentials",
	},

	// Network errors
	{
		type: "network",
		patterns: [
			/ECONNREFUSED/i,
			/ENOTFOUND/i,
			/ETIMEDOUT/i,
			/network\s+error/i,
			/connect\s+ECONNREFUSED/i,
			/request\s+failed/i,
		],
		confidence: 0.8,
		extractRootCause: (match) => match[0] || "Network connection error",
		extractFiles: () => [],
		suggestFix: () => "Check network connectivity and service availability",
	},
]

// ─── Analysis Functions ──────────────────────────────────────────────────

/**
 * Analyze terminal output lines for errors.
 * Returns a list of error analyses sorted by confidence.
 */
export function analyzeOutput(lines: string[]): ErrorAnalysis[] {
	const errors: ErrorAnalysis[] = []
	const seen = new Set<string>()

	for (const pattern of ERROR_PATTERNS) {
		for (const line of lines) {
			for (const re of pattern.patterns) {
				const match = re.exec(line)
				if (match) {
					const errorMessage = match[0]
					const fingerprint = `${pattern.type}:${errorMessage.slice(0, 100)}`
					if (seen.has(fingerprint)) continue
					seen.add(fingerprint)

					errors.push({
						errorType: pattern.type,
						errorMessage,
						rootCause: pattern.extractRootCause(match, lines),
						relatedFiles: pattern.extractFiles(match, lines),
						confidence: pattern.confidence,
						fixSuggestion: pattern.suggestFix(match, lines),
					})
				}
			}
		}
	}

	// Sort by confidence descending
	return errors.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Quick check if output contains any error.
 */
export function hasError(lines: string[]): boolean {
	return analyzeOutput(lines).length > 0
}

/**
 * Get the most confident error from output.
 */
export function getPrimaryError(lines: string[]): ErrorAnalysis | null {
	const errors = analyzeOutput(lines)
	return errors.length > 0 ? errors[0] : null
}

/**
 * Classify a raw error message string.
 */
export function classifyError(errorMessage: string): ErrorType {
	for (const pattern of ERROR_PATTERNS) {
		for (const re of pattern.patterns) {
			if (re.test(errorMessage)) {
				return pattern.type
			}
		}
	}
	return "unknown"
}
