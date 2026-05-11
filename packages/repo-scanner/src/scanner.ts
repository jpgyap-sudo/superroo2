/**
 * Repo Scanner — Project Context Loader
 *
 * Scans the workspace for project configuration files and builds
 * a comprehensive ProjectContext object that the Terminal Brain
 * uses to make informed command decisions.
 */

import * as fs from "node:fs"
import * as path from "node:path"

export interface ScannerOptions {
	workspaceRoot: string
	/** Max files to scan (prevents hangs on huge repos) */
	maxFiles?: number
	/** File patterns to skip */
	skipPatterns?: RegExp[]
}

export interface ScanResult {
	context: import("../../terminal-core/src/types").ProjectContext
	files: string[]
	errors: string[]
}

const DEFAULT_SKIP = [/node_modules/, /\.git/, /dist/, /\.next/, /\.cache/, /coverage/]

/**
 * Scan a workspace directory and build project context.
 * Returns both the structured context and the list of detected files.
 */
export async function scanWorkspace(opts: ScannerOptions): Promise<ScanResult> {
	const { workspaceRoot, maxFiles = 5000, skipPatterns = DEFAULT_SKIP } = opts
	const errors: string[] = []
	const files: string[] = []

	// Walk files
	async function walk(dir: string): Promise<void> {
		if (files.length >= maxFiles) return
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				if (files.length >= maxFiles) return
				const fullPath = path.join(dir, entry.name)
				const relPath = path.relative(workspaceRoot, fullPath)
				if (skipPatterns.some((p) => p.test(relPath))) continue
				if (entry.isDirectory()) {
					await walk(fullPath)
				} else {
					files.push(relPath)
				}
			}
		} catch (err) {
			errors.push(`Failed to read ${dir}: ${err}`)
		}
	}

	await walk(workspaceRoot)

	// Detect package manager
	const hasPnpmLock = files.some((f) => f === "pnpm-lock.yaml")
	const hasYarnLock = files.some((f) => f === "yarn.lock")
	const hasNpmLock = files.some((f) => f === "package-lock.json")
	const packageManager = hasPnpmLock ? "pnpm" : hasYarnLock ? "yarn" : hasNpmLock ? "npm" : "unknown"

	// Read package.json
	let scripts: Record<string, string> = {}
	let detectedFramework: import("../../terminal-core/src/types").ProjectContext["framework"] = "unknown"
	let devCommand: string | null = null
	let buildCommand: string | null = null
	let testCommand: string | null = null
	let lintCommand: string | null = null

	try {
		const pkgRaw = await fs.promises.readFile(path.join(workspaceRoot, "package.json"), "utf8")
		const pkg = JSON.parse(pkgRaw)
		scripts = pkg.scripts || {}

		// Detect framework
		if (pkg.dependencies?.next || pkg.devDependencies?.next) {
			detectedFramework = "nextjs"
		} else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
			detectedFramework = "vite"
		} else if (pkg.dependencies?.express) {
			detectedFramework = "express"
		} else if (pkg.dependencies?.react || pkg.devDependencies?.react) {
			detectedFramework = "react"
		} else if (pkg.dependencies?.["@angular/core"]) {
			detectedFramework = "angular"
		}

		// Map common scripts
		devCommand = scripts.dev || scripts.develop || scripts.start || null
		buildCommand = scripts.build || scripts.compile || null
		testCommand = scripts.test || scripts["test:run"] || null
		lintCommand = scripts.lint || scripts["lint:check"] || null
	} catch {
		errors.push("Failed to read package.json")
	}

	// Detect Docker
	const hasDocker = files.some((f) => f === "Dockerfile" || f.endsWith("/Dockerfile"))
	const hasDockerCompose = files.some((f) => f === "docker-compose.yml" || f === "docker-compose.yaml")

	// Detect TypeScript
	const hasTypeScript = files.some((f) => f === "tsconfig.json")

	// Detect .env.example
	const hasEnvExample = files.some((f) => f === ".env.example")

	// Read .env.example for env vars
	let envVars: string[] = []
	if (hasEnvExample) {
		try {
			const envContent = await fs.promises.readFile(path.join(workspaceRoot, ".env.example"), "utf8")
			envVars = envContent
				.split("\n")
				.filter((l) => l.trim() && !l.startsWith("#"))
				.map((l) => l.split("=")[0].trim())
				.filter(Boolean)
		} catch {
			// ignore
		}
	}

	// Detect port from config files
	let port: number | null = null
	if (detectedFramework === "nextjs") {
		port = 3000
	} else if (detectedFramework === "vite") {
		port = 5173
	} else if (detectedFramework === "express") {
		port = 3001
	}

	// Try to read port from env or config
	try {
		const envRaw = await fs.promises.readFile(path.join(workspaceRoot, ".env"), "utf8")
		const portMatch = envRaw.match(/PORT=(\d+)/)
		if (portMatch) port = parseInt(portMatch[1], 10)
	} catch {
		// ignore
	}

	// Get git info
	let branch = "unknown"
	try {
		const headRef = await fs.promises.readFile(path.join(workspaceRoot, ".git", "HEAD"), "utf8")
		const refMatch = headRef.match(/ref: refs\/heads\/(.+)/)
		if (refMatch) branch = refMatch[1].trim()
	} catch {
		// not a git repo or no HEAD
	}

	const context = {
		packageManager,
		framework: detectedFramework,
		hasDocker,
		hasDockerCompose,
		hasEnvExample,
		hasTypeScript,
		scripts,
		devCommand,
		buildCommand,
		testCommand,
		lintCommand,
		port,
		branch,
		repoName: path.basename(workspaceRoot),
		workspaceRoot,
		detectedFiles: files.slice(0, 100), // limit to 100 for context
		envVars,
	}

	return { context: context as import("../../terminal-core/src/types").ProjectContext, files, errors }
}

/**
 * Quick scan — just detect package manager, framework, and scripts.
 * Much faster than a full walk.
 */
export async function quickScan(workspaceRoot: string): Promise<import("../../terminal-core/src/types").ProjectContext> {
	const context: import("../../terminal-core/src/types").ProjectContext = {
		packageManager: "unknown",
		framework: "unknown",
		hasDocker: false,
		hasDockerCompose: false,
		hasEnvExample: false,
		hasTypeScript: false,
		scripts: {},
		devCommand: null,
		buildCommand: null,
		testCommand: null,
		lintCommand: null,
		port: null,
		branch: "unknown",
		repoName: path.basename(workspaceRoot),
		workspaceRoot,
		detectedFiles: [],
		envVars: [],
	}

	// Check lockfiles
	try {
		await fs.promises.access(path.join(workspaceRoot, "pnpm-lock.yaml"))
		context.packageManager = "pnpm"
	} catch {
		try {
			await fs.promises.access(path.join(workspaceRoot, "yarn.lock"))
			context.packageManager = "yarn"
		} catch {
			try {
				await fs.promises.access(path.join(workspaceRoot, "package-lock.json"))
				context.packageManager = "npm"
			} catch {
				// unknown
			}
		}
	}

	// Read package.json
	try {
		const pkgRaw = await fs.promises.readFile(path.join(workspaceRoot, "package.json"), "utf8")
		const pkg = JSON.parse(pkgRaw)
		context.scripts = pkg.scripts || {}
		context.devCommand = context.scripts.dev || context.scripts.develop || context.scripts.start || null
		context.buildCommand = context.scripts.build || context.scripts.compile || null
		context.testCommand = context.scripts.test || null
		context.lintCommand = context.scripts.lint || null

		if (pkg.dependencies?.next || pkg.devDependencies?.next) context.framework = "nextjs"
		else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) context.framework = "vite"
		else if (pkg.dependencies?.express) context.framework = "express"
		else if (pkg.dependencies?.react || pkg.devDependencies?.react) context.framework = "react"
	} catch {
		// no package.json
	}

	// Check Docker
	try {
		await fs.promises.access(path.join(workspaceRoot, "Dockerfile"))
		context.hasDocker = true
	} catch {
		// no Dockerfile
	}
	try {
		await fs.promises.access(path.join(workspaceRoot, "docker-compose.yml"))
		context.hasDockerCompose = true
	} catch {
		// no docker-compose
	}

	// Check tsconfig
	try {
		await fs.promises.access(path.join(workspaceRoot, "tsconfig.json"))
		context.hasTypeScript = true
	} catch {
		// no tsconfig
	}

	// Check .env.example
	try {
		await fs.promises.access(path.join(workspaceRoot, ".env.example"))
		context.hasEnvExample = true
	} catch {
		// no .env.example
	}

	// Get branch
	try {
		const headRef = await fs.promises.readFile(path.join(workspaceRoot, ".git", "HEAD"), "utf8")
		const refMatch = headRef.match(/ref: refs\/heads\/(.+)/)
		if (refMatch) context.branch = refMatch[1].trim()
	} catch {
		// not a git repo
	}

	return context
}
