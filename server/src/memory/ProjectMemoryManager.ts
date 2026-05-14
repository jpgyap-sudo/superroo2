/**
 * ProjectMemoryManager — Multi-project namespace isolation for Central Brain.
 *
 * Each project gets its own isolated memory namespace:
 *   - Qdrant collection (or collection prefix)
 *   - PostgreSQL schema prefix
 *   - JSON memory files in project-specific directories
 *   - Task history, bug registry, feature memory, deployment logs
 *
 * The Central Brain routes requests to the correct project namespace
 * based on the `projectId` field in every request.
 *
 * Architecture:
 *   Claude/Codex/VS Code/Telegram
 *        ↓
 *   Central Brain Daemon
 *        ↓
 *   ProjectMemoryManager.selectProject("productgenerator")
 *        ↓
 *   ProjectNamespace {
 *       qdrantCollection: "repo_productgenerator",
 *       memoryDir: "./memory/projects/productgenerator/",
 *       pgSchema: "project_productgenerator",
 *       config: { ... }
 *   }
 */

import * as fs from "node:fs"
import * as path from "node:path"

// ── Types ──

export interface ProjectConfig {
	id: string
	name: string
	repoPath?: string
	description?: string
	embeddingModel?: string
	embeddingDimensions?: number
	indexableExtensions?: string[]
	skipDirectories?: string[]
}

export interface ProjectNamespace {
	projectId: string
	projectName: string
	repoPath?: string
	description?: string
	/** Qdrant collection name for this project's code chunks */
	qdrantCollection: string
	/** Directory for JSON memory files */
	memoryDir: string
	/** PostgreSQL schema name (if using pgvector) */
	pgSchema: string
	/** Embedding model config */
	embeddingModel: string
	embeddingDimensions: number
	/** File indexing config */
	indexableExtensions: string[]
	skipDirectories: string[]
}

export interface ProjectMemorySummary {
	projectId: string
	projectName: string
	description?: string
	featureCount: number
	bugCount: number
	taskCount: number
	deployCount: number
	lastIndexedAt?: string
	lastActivityAt?: string
}

// ── Default Configuration ──

const DEFAULT_PROJECTS: ProjectConfig[] = [
	{
		id: "superroo2",
		name: "SuperRoo 2",
		repoPath: process.env.SUPERROO_WORKSPACE_ROOT || "/opt/superroo2",
		description: "SuperRoo VS Code extension + Central Brain monorepo",
		embeddingModel: "nomic-embed-text",
		embeddingDimensions: 768,
		indexableExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html", ".yaml", ".yml"],
		skipDirectories: ["node_modules", ".git", "dist", "build", ".turbo", "pnpm-lock.yaml"],
	},
	{
		id: "productgenerator",
		name: "Product Generator",
		description: "AI product image/video generation pipeline",
		embeddingModel: "nomic-embed-text",
		embeddingDimensions: 768,
		indexableExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md", ".yaml", ".yml"],
		skipDirectories: ["node_modules", ".git", "dist", "build", "__pycache__", ".venv"],
	},
	{
		id: "trading-bot",
		name: "Trading Bot",
		description: "Automated cryptocurrency trading bot",
		embeddingModel: "nomic-embed-text",
		embeddingDimensions: 768,
		indexableExtensions: [".ts", ".js", ".py", ".json", ".md", ".yaml", ".yml"],
		skipDirectories: ["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "data"],
	},
]

// ── ProjectMemoryManager ──

export class ProjectMemoryManager {
	private projects = new Map<string, ProjectConfig>()
	private baseMemoryDir: string

	constructor(baseMemoryDir?: string) {
		this.baseMemoryDir = baseMemoryDir || path.join(process.cwd(), "memory", "projects")
		this._loadConfig()
	}

	/**
	 * Load project configurations from environment and defaults.
	 * Can be overridden by SUPERROO_PROJECTS_CONFIG env var (JSON path).
	 */
	private _loadConfig(): void {
		// Try loading from config file
		const configPath = process.env.SUPERROO_PROJECTS_CONFIG
		if (configPath && fs.existsSync(configPath)) {
			try {
				const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
				const projects: ProjectConfig[] = Array.isArray(raw) ? raw : raw.projects || []
				for (const p of projects) {
					if (p.id) this.projects.set(p.id, p)
				}
				console.log(`[project-memory] Loaded ${this.projects.size} projects from ${configPath}`)
				return
			} catch (err) {
				console.error(`[project-memory] Failed to load config from ${configPath}:`, err)
			}
		}

		// Fall back to defaults
		for (const p of DEFAULT_PROJECTS) {
			this.projects.set(p.id, p)
		}
		console.log(`[project-memory] Loaded ${this.projects.size} default projects`)
	}

	/**
	 * Register a new project at runtime.
	 */
	registerProject(config: ProjectConfig): void {
		if (!config.id) throw new Error("Project config must have an 'id'")
		this.projects.set(config.id, config)
		// Ensure memory directory exists
		this._ensureMemoryDir(config.id)
		console.log(`[project-memory] Registered project: ${config.id}`)
	}

	/**
	 * Get all registered projects.
	 */
	listProjects(): ProjectConfig[] {
		return Array.from(this.projects.values())
	}

	/**
	 * Get a project config by ID.
	 */
	getProject(projectId: string): ProjectConfig | undefined {
		return this.projects.get(projectId)
	}

	/**
	 * Select a project namespace for use.
	 * This creates the full namespace object with all derived paths.
	 */
	selectProject(projectId: string): ProjectNamespace {
		const config = this.projects.get(projectId)
		if (!config) {
			throw new Error(`Unknown project: ${projectId}. Available: ${Array.from(this.projects.keys()).join(", ")}`)
		}

		const memoryDir = this._ensureMemoryDir(projectId)

		return {
			projectId: config.id,
			projectName: config.name,
			repoPath: config.repoPath,
			description: config.description,
			qdrantCollection: `repo_${config.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
			memoryDir,
			pgSchema: `project_${config.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
			embeddingModel: config.embeddingModel || "nomic-embed-text",
			embeddingDimensions: config.embeddingDimensions || 768,
			indexableExtensions: config.indexableExtensions || [".ts", ".tsx", ".js", ".jsx", ".json", ".md"],
			skipDirectories: config.skipDirectories || ["node_modules", ".git", "dist", "build"],
		}
	}

	/**
	 * Detect which project a message refers to by keyword matching.
	 * Returns the best-matching project ID, or the default.
	 */
	detectProject(userMessage: string, defaultProject = "superroo2"): string {
		const lower = userMessage.toLowerCase()

		// Score each project by keyword matches
		let bestScore = 0
		let bestProject = defaultProject

		for (const [id, config] of this.projects) {
			let score = 0

			// Direct project ID/name mention
			if (lower.includes(id.toLowerCase())) score += 10
			if (config.name && lower.includes(config.name.toLowerCase())) score += 8

			// Description keywords
			if (config.description) {
				const keywords = config.description.toLowerCase().split(/\s+/)
				for (const kw of keywords) {
					if (kw.length > 3 && lower.includes(kw)) score += 2
				}
			}

			// Specific domain keywords
			if (id === "productgenerator") {
				if (lower.includes("product") || lower.includes("render") || lower.includes("image") ||
					lower.includes("video") || lower.includes("generat") || lower.includes("pipeline")) {
					score += 5
				}
			}
			if (id === "trading-bot") {
				if (lower.includes("trade") || lower.includes("bot") || lower.includes("crypto") ||
					lower.includes("market") || lower.includes("order") || lower.includes("exchange")) {
					score += 5
				}
			}

			if (score > bestScore) {
				bestScore = score
				bestProject = id
			}
		}

		return bestProject
	}

	/**
	 * Get a summary of all project memory states.
	 */
	getAllMemorySummaries(): ProjectMemorySummary[] {
		return Array.from(this.projects.values()).map((config) => {
			const ns = this.selectProject(config.id)
			return {
				projectId: config.id,
				projectName: config.name,
				description: config.description,
				featureCount: this._countJsonArray(path.join(ns.memoryDir, "features.json")),
				bugCount: this._countJsonArray(path.join(ns.memoryDir, "bugs.json")),
				taskCount: this._countJsonArray(path.join(ns.memoryDir, "tasks.json")),
				deployCount: this._countJsonArray(path.join(ns.memoryDir, "deploys.json")),
				lastIndexedAt: this._getFileTimestamp(path.join(ns.memoryDir, "last-indexed.txt")),
				lastActivityAt: this._getFileTimestamp(path.join(ns.memoryDir, "last-activity.txt")),
			}
		})
	}

	/**
	 * Ensure a project's memory directory exists.
	 */
	private _ensureMemoryDir(projectId: string): string {
		const dir = path.join(this.baseMemoryDir, projectId)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		return dir
	}

	private _countJsonArray(filePath: string): number {
		try {
			if (!fs.existsSync(filePath)) return 0
			const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
			return Array.isArray(data) ? data.length : 0
		} catch {
			return 0
		}
	}

	private _getFileTimestamp(filePath: string): string | undefined {
		try {
			if (!fs.existsSync(filePath)) return undefined
			return fs.readFileSync(filePath, "utf-8").trim()
		} catch {
			return undefined
		}
	}
}

// ── Singleton ──

let _instance: ProjectMemoryManager | null = null

export function getProjectMemoryManager(baseMemoryDir?: string): ProjectMemoryManager {
	if (!_instance) {
		_instance = new ProjectMemoryManager(baseMemoryDir)
	}
	return _instance
}
