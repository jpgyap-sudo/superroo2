/**
 * Command Planner — Translates natural language or intents into planned commands
 *
 * Takes a user's intent (e.g., "fix the build", "run tests", "deploy safely")
 * and produces a sequence of PlannedCommand objects that the Safe Executor
 * can run through the Plan → Run → Verify loop.
 */

import type { PlannedCommand, CommandIntent, ProjectContext } from "./types"

// ─── Intent Detection ────────────────────────────────────────────────────

interface IntentMatch {
	intent: CommandIntent
	confidence: number
}

const INTENT_PATTERNS: Array<{ intent: CommandIntent; patterns: RegExp[] }> = [
	{
		intent: "build",
		patterns: [
			/\bbuild\b/i,
			/\bcompile\b/i,
			/\btypecheck\b/i,
			/\btype.?check\b/i,
			/\bbundle\b/i,
		],
	},
	{
		intent: "test",
		patterns: [
			/\btest(s|ing)?\b/i,
			/\brun tests\b/i,
			/\bvitest\b/i,
			/\bjest\b/i,
			/\bcheck tests\b/i,
		],
	},
	{
		intent: "dev",
		patterns: [
			/\bdev\b/i,
			/\bdevelop\b/i,
			/\bstart\b/i,
			/\brun\s+(the\s+)?(app|server|frontend|backend)\b/i,
		],
	},
	{
		intent: "deploy",
		patterns: [
			/\bdeploy\b/i,
			/\brelease\b/i,
			/\bship\b/i,
			/\bpublish\b/i,
			/\bpush to prod\b/i,
		],
	},
	{
		intent: "install",
		patterns: [
			/\binstall\b/i,
			/\badd\s+dependency\b/i,
			/\bnpm\s+i\b/i,
			/\bpnpm\s+add\b/i,
			/\byarn\s+add\b/i,
		],
	},
	{
		intent: "lint",
		patterns: [
			/\blint\b/i,
			/\beslint\b/i,
			/\bprettier\b/i,
			/\bformat\b/i,
		],
	},
	{
		intent: "docker",
		patterns: [
			/\bdocker\b/i,
			/\bcontainer\b/i,
			/\bcompose\b/i,
		],
	},
	{
		intent: "git",
		patterns: [
			/\bgit\b/i,
			/\bcommit\b/i,
			/\bpush\b/i,
			/\bpull\b/i,
			/\bmerge\b/i,
			/\brebase\b/i,
		],
	},
]

/**
 * Detect the intent of a natural language query.
 */
export function detectIntent(query: string): IntentMatch {
	const best: IntentMatch = { intent: "unknown", confidence: 0 }

	for (const entry of INTENT_PATTERNS) {
		for (const pattern of entry.patterns) {
			if (pattern.test(query)) {
				// Longer matches = higher confidence
				const match = query.match(pattern)
				const matchLength = match ? match[0].length : 0
				const confidence = Math.min(0.5 + matchLength * 0.05, 0.95)

				if (confidence > best.confidence) {
					best.intent = entry.intent
					best.confidence = confidence
				}
			}
		}
	}

	return best
}

// ─── Command Planning ────────────────────────────────────────────────────

let commandCounter = 0

function nextId(): string {
	commandCounter++
	return `cmd-${Date.now()}-${commandCounter}`
}

/**
 * Plan a sequence of commands based on intent and project context.
 */
export function planCommands(
	intent: CommandIntent,
	context: ProjectContext,
	nlQuery?: string,
): PlannedCommand[] {
	const commands: PlannedCommand[] = []

	switch (intent) {
		case "build": {
			if (context.buildCommand) {
				commands.push({
					id: nextId(),
					intent: "build",
					command: `${context.packageManager} ${context.buildCommand}`,
					description: `Run ${context.packageManager} ${context.buildCommand}`,
					requiresApproval: false,
				})
			} else {
				commands.push({
					id: nextId(),
					intent: "build",
					command: `${context.packageManager} run build`,
					description: "Run build script",
					requiresApproval: false,
				})
			}
			break
		}

		case "test": {
			if (context.testCommand) {
				commands.push({
					id: nextId(),
					intent: "test",
					command: `${context.packageManager} ${context.testCommand}`,
					description: `Run ${context.packageManager} ${context.testCommand}`,
					requiresApproval: false,
				})
			} else {
				commands.push({
					id: nextId(),
					intent: "test",
					command: `${context.packageManager} test`,
					description: "Run tests",
					requiresApproval: false,
				})
			}
			break
		}

		case "dev": {
			if (context.devCommand) {
				commands.push({
					id: nextId(),
					intent: "dev",
					command: `${context.packageManager} ${context.devCommand}`,
					description: `Start dev server with ${context.packageManager} ${context.devCommand}`,
					requiresApproval: false,
				})
			} else {
				commands.push({
					id: nextId(),
					intent: "dev",
					command: `${context.packageManager} run dev`,
					description: "Start dev server",
					requiresApproval: false,
				})
			}
			break
		}

		case "deploy": {
			// Deploy requires a multi-step plan
			commands.push({
				id: nextId(),
				intent: "build",
				command: `${context.packageManager} run build`,
				description: "Step 1: Build the project",
				requiresApproval: false,
			})
			commands.push({
				id: nextId(),
				intent: "test",
				command: `${context.packageManager} test`,
				description: "Step 2: Run tests before deploy",
				requiresApproval: false,
			})
			commands.push({
				id: nextId(),
				intent: "deploy",
				command: "echo 'Ready to deploy — use /deploy for full deployment'",
				description: "Step 3: Deploy (requires approval)",
				requiresApproval: true,
			})
			break
		}

		case "install": {
			commands.push({
				id: nextId(),
				intent: "install",
				command: `${context.packageManager} install`,
				description: `Install dependencies with ${context.packageManager}`,
				requiresApproval: false,
			})
			break
		}

		case "lint": {
			if (context.lintCommand) {
				commands.push({
					id: nextId(),
					intent: "lint",
					command: `${context.packageManager} ${context.lintCommand}`,
					description: `Run ${context.packageManager} ${context.lintCommand}`,
					requiresApproval: false,
				})
			} else {
				commands.push({
					id: nextId(),
					intent: "lint",
					command: `${context.packageManager} run lint`,
					description: "Run linter",
					requiresApproval: false,
				})
			}
			break
		}

		case "docker": {
			if (context.hasDockerCompose) {
				commands.push({
					id: nextId(),
					intent: "docker",
					command: "docker compose up -d",
					description: "Start Docker Compose services",
					requiresApproval: true,
				})
			} else if (context.hasDocker) {
				commands.push({
					id: nextId(),
					intent: "docker",
					command: "docker build -t app .",
					description: "Build Docker image",
					requiresApproval: true,
				})
			} else {
				commands.push({
					id: nextId(),
					intent: "docker",
					command: "docker ps",
					description: "List Docker containers",
					requiresApproval: false,
				})
			}
			break
		}

		case "git": {
			commands.push({
				id: nextId(),
				intent: "git",
				command: "git status",
				description: "Check git status",
				requiresApproval: false,
			})
			break
		}

		default: {
			// Unknown intent — just echo the query as a command
			if (nlQuery) {
				commands.push({
					id: nextId(),
					intent: "unknown",
					command: nlQuery,
					description: `Execute: ${nlQuery}`,
					requiresApproval: true,
				})
			}
			break
		}
	}

	return commands
}

/**
 * Plan a "fix the build" sequence — the most common smart terminal action.
 */
export function planBuildFix(context: ProjectContext): PlannedCommand[] {
	const commands: PlannedCommand[] = []

	// Step 1: Check package manager
	commands.push({
		id: nextId(),
		intent: "install",
		command: `${context.packageManager} install`,
		description: "Step 1: Ensure dependencies are installed",
		requiresApproval: false,
	})

	// Step 2: TypeScript check if applicable
	if (context.hasTypeScript) {
		commands.push({
			id: nextId(),
			intent: "typecheck",
			command: `${context.packageManager} run typecheck 2>&1 || npx tsc --noEmit 2>&1`,
			description: "Step 2: Run TypeScript type check",
			requiresApproval: false,
		})
	}

	// Step 3: Build
	commands.push({
		id: nextId(),
		intent: "build",
		command: `${context.packageManager} run build`,
		description: "Step 3: Run build",
		requiresApproval: false,
	})

	return commands
}

/**
 * Plan a "deploy safely" sequence.
 */
export function planSafeDeploy(context: ProjectContext): PlannedCommand[] {
	const commands: PlannedCommand[] = []

	// Step 1: Check git status
	commands.push({
		id: nextId(),
		intent: "git",
		command: "git status",
		description: "Step 1: Check git status",
		requiresApproval: false,
	})

	// Step 2: Build
	commands.push({
		id: nextId(),
		intent: "build",
		command: `${context.packageManager} run build`,
		description: "Step 2: Build project",
		requiresApproval: false,
	})

	// Step 3: Test
	if (context.testCommand) {
		commands.push({
			id: nextId(),
			intent: "test",
			command: `${context.packageManager} test`,
			description: "Step 3: Run tests",
			requiresApproval: false,
		})
	}

	// Step 4: Deploy (requires approval)
	commands.push({
		id: nextId(),
		intent: "deploy",
		command: "echo 'Deploy ready — run /deploy to proceed'",
		description: "Step 4: Deploy (requires approval)",
		requiresApproval: true,
	})

	return commands
}
