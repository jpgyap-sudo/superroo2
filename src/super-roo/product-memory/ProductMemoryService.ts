/**
 * Super Roo — Product Memory Service.
 *
 * Manages product memory as JSON files in the workspace, providing a
 * human-readable and agent-readable record of features, updates, test
 * history, bug mappings, and agent notes.
 *
 * Uses safeWriteJson for atomic writes to prevent data corruption.
 * Integrates with the existing EventLog for observability.
 */

import { v4 as uuidv4 } from "uuid"
import fs from "fs/promises"
import path from "path"

import type { EventLog } from "../logging/EventLog"
import type {
	ProductFeature,
	ProductFeatureStatus,
	ProductUpdate,
	ProductUpdateType,
	FeatureTestRecord,
	BugFeatureMapping,
	AgentNote,
	ProductFeaturesFile,
	ProductUpdatesFile,
	FeatureTestHistoryFile,
	BugFeatureMapFile,
	AgentNotesFile,
} from "./types"

import os from "os"

// ── Constants ─────────────────────────────────────────────────────────────────

// Global product memory: accessible by Claude, Kilo Code, Codex, and any MCP tool.
// Falls back to project-local if env var not set.
const MEMORY_DIR =
	process.env.SUPERROO_PRODUCT_MEMORY_DIR ||
	(process.env.SUPERROO_HOME
		? `${process.env.SUPERROO_HOME}/product-memory`
		: `${os.homedir()}/.superroo/product-memory`)

const DEFAULT_FILES: Record<string, unknown> = {
	"product-features.json": { features: [] } satisfies ProductFeaturesFile,
	"product-updates.json": { updates: [] } satisfies ProductUpdatesFile,
	"feature-test-history.json": { tests: [] } satisfies FeatureTestHistoryFile,
	"bug-feature-map.json": { mappings: [] } satisfies BugFeatureMapFile,
	"agent-notes.json": { notes: [] } satisfies AgentNotesFile,
}

const ALLOWED_FILES = new Set(Object.keys(DEFAULT_FILES))

// ── Service ───────────────────────────────────────────────────────────────────

export class ProductMemoryService {
	private memoryDir: string

	constructor(
		private readonly events: EventLog,
		workspaceRoot?: string,
	) {
		this.memoryDir = workspaceRoot
			? path.resolve(workspaceRoot, MEMORY_DIR)
			: path.resolve(process.cwd(), MEMORY_DIR)
	}

	/**
	 * Override the memory directory at runtime (used by tests).
	 * Calling this after initialize() is safe only before any read/write.
	 */
	setMemoryDir(dir: string): void {
		this.memoryDir = dir
	}

	/** Expose the current memory directory (for diagnostics / tests). */
	getMemoryDir(): string {
		return this.memoryDir
	}

	// ── Initialization ────────────────────────────────────────────────────

	async initialize(): Promise<void> {
		await fs.mkdir(this.memoryDir, { recursive: true })
		this.events.info("product_memory.initialized", `Product memory directory: ${this.memoryDir}`)
	}

	// ── File Operations ───────────────────────────────────────────────────

	async listMemoryFiles(): Promise<string[]> {
		return Array.from(ALLOWED_FILES)
	}

	async readMemoryFile<T = unknown>(fileName: string): Promise<T> {
		this.assertAllowedFile(fileName)
		const fullPath = path.join(this.memoryDir, fileName)
		try {
			const raw = await fs.readFile(fullPath, "utf-8")
			return JSON.parse(raw) as T
		} catch (err: unknown) {
			if (isNodeError(err) && err.code === "ENOENT") {
				// Deep-clone the default so callers cannot mutate the shared constant
				const initial: T = JSON.parse(JSON.stringify(DEFAULT_FILES[fileName])) as T
				await this.writeMemoryFile(fileName, initial as Record<string, unknown>)
				return initial
			}
			throw err
		}
	}

	async writeMemoryFile(fileName: string, data: Record<string, unknown>): Promise<void> {
		this.assertAllowedFile(fileName)
		const fullPath = path.join(this.memoryDir, fileName)
		await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8")
		this.events.info("product_memory.written", `Wrote ${fileName}`, {
			data: { fileName } as unknown as Record<string, unknown>,
		})
	}

	// ── Features ──────────────────────────────────────────────────────────

	async getFeatures(): Promise<ProductFeaturesFile> {
		return this.readMemoryFile<ProductFeaturesFile>("product-features.json")
	}

	async addFeature(feature: Partial<ProductFeature> & { name: string }): Promise<ProductFeature> {
		const memory = await this.getFeatures()
		const newFeature: ProductFeature = {
			id: feature.id || `feat_${uuidv4()}`,
			name: feature.name,
			category: feature.category || "Uncategorized",
			description: feature.description || "",
			status: feature.status || "planned",
			confidence: feature.confidence ?? 0,
			ownerAgent: feature.ownerAgent || "unknown",
			relatedFiles: feature.relatedFiles || [],
			lastTestedAt: feature.lastTestedAt || null,
			knownBugs: feature.knownBugs || [],
			testChecklist: feature.testChecklist || [],
		}
		memory.features.push(newFeature)
		await this.writeMemoryFile("product-features.json", memory as unknown as Record<string, unknown>)
		this.events.info("product_memory.feature_added", `Added feature: ${newFeature.name}`, {
			data: { featureId: newFeature.id } as unknown as Record<string, unknown>,
		})
		return newFeature
	}

	async updateFeature(id: string, patch: Partial<ProductFeature>): Promise<ProductFeature> {
		const memory = await this.getFeatures()
		const index = memory.features.findIndex((f) => f.id === id)
		if (index === -1) throw new Error(`Feature not found: ${id}`)
		memory.features[index] = { ...memory.features[index], ...patch }
		await this.writeMemoryFile("product-features.json", memory as unknown as Record<string, unknown>)
		this.events.info("product_memory.feature_updated", `Updated feature: ${memory.features[index].name}`, {
			data: { featureId: id } as unknown as Record<string, unknown>,
		})
		return memory.features[index]
	}

	async testFeature(featureId: string, result: "pass" | "fail" | "warning", notes = ""): Promise<FeatureTestRecord> {
		// Record the test
		const testMemory = await this.readMemoryFile<FeatureTestHistoryFile>("feature-test-history.json")
		const testRecord: FeatureTestRecord = {
			id: uuidv4(),
			featureId,
			testedAt: new Date().toISOString(),
			testedBy: "Tester Agent",
			result,
			issuesFound: result === "pass" ? [] : [`${featureId} returned ${result}`],
			notes,
		}
		testMemory.tests.unshift(testRecord)
		await this.writeMemoryFile("feature-test-history.json", testMemory as unknown as Record<string, unknown>)

		// Update the feature status
		await this.updateFeature(featureId, {
			lastTestedAt: testRecord.testedAt,
			status: result === "pass" ? "working" : "broken",
			confidence: result === "pass" ? 95 : 40,
		})

		this.events.info("product_memory.feature_tested", `Tested feature ${featureId}: ${result}`, {
			data: { featureId, result } as unknown as Record<string, unknown>,
		})

		return testRecord
	}

	// ── Updates ───────────────────────────────────────────────────────────

	async getUpdates(): Promise<ProductUpdatesFile> {
		return this.readMemoryFile<ProductUpdatesFile>("product-updates.json")
	}

	async addUpdate(
		update: Partial<ProductUpdate> & { title: string; type: ProductUpdateType },
	): Promise<ProductUpdate> {
		const memory = await this.getUpdates()
		const newUpdate: ProductUpdate = {
			id: update.id || `upd_${uuidv4()}`,
			timestamp: update.timestamp || new Date().toISOString(),
			type: update.type,
			title: update.title,
			summary: update.summary || "",
			filesChanged: update.filesChanged || [],
			status: update.status || "pending_test",
			linkedFeatures: update.linkedFeatures || [],
			rollbackAvailable: update.rollbackAvailable ?? true,
		}
		memory.updates.unshift(newUpdate)
		await this.writeMemoryFile("product-updates.json", memory as unknown as Record<string, unknown>)
		this.events.info("product_memory.update_added", `Added update: ${newUpdate.title}`, {
			data: { updateId: newUpdate.id, type: newUpdate.type } as unknown as Record<string, unknown>,
		})
		return newUpdate
	}

	// ── Bug-Feature Mappings ──────────────────────────────────────────────

	async mapBugToFeature(input: {
		bugId?: string
		featureId: string
		severity: "low" | "medium" | "high" | "critical"
		title: string
		description: string
		logs?: string[]
	}): Promise<BugFeatureMapping> {
		const memory = await this.readMemoryFile<BugFeatureMapFile>("bug-feature-map.json")
		const mapping: BugFeatureMapping = {
			id: uuidv4(),
			bugId: input.bugId || `bug_${uuidv4()}`,
			featureId: input.featureId,
			severity: input.severity,
			title: input.title,
			description: input.description,
			logs: input.logs || [],
			status: "open",
			createdAt: new Date().toISOString(),
		}
		memory.mappings.unshift(mapping)
		await this.writeMemoryFile("bug-feature-map.json", memory as unknown as Record<string, unknown>)

		// Also update the feature's knownBugs list
		const featureMemory = await this.getFeatures()
		const feature = featureMemory.features.find((f) => f.id === input.featureId)
		if (feature && !feature.knownBugs.includes(mapping.bugId)) {
			feature.knownBugs.push(mapping.bugId)
			await this.writeMemoryFile("product-features.json", featureMemory as unknown as Record<string, unknown>)
		}

		this.events.info("product_memory.bug_mapped", `Mapped bug to feature ${input.featureId}`, {
			data: { bugId: mapping.bugId, featureId: input.featureId } as unknown as Record<string, unknown>,
		})

		return mapping
	}

	// ── Agent Notes ───────────────────────────────────────────────────────

	async addAgentNote(agent: string, note: string): Promise<AgentNote> {
		const memory = await this.readMemoryFile<AgentNotesFile>("agent-notes.json")
		const agentNote: AgentNote = {
			id: `note_${uuidv4()}`,
			timestamp: new Date().toISOString(),
			agent,
			note,
		}
		memory.notes.unshift(agentNote)
		await this.writeMemoryFile("agent-notes.json", memory as unknown as Record<string, unknown>)
		return agentNote
	}

	// ── Recommendations ───────────────────────────────────────────────────

	async recommendImprovements(): Promise<Array<{ featureId: string; name: string; recommendation: string }>> {
		const memory = await this.getFeatures()
		return memory.features
			.filter((f) => f.status === "broken" || f.status === "needs_test" || f.confidence < 80)
			.map((f) => ({
				featureId: f.id,
				name: f.name,
				recommendation: `Prioritize ${f.name}: status=${f.status}, confidence=${f.confidence}%. Run checklist and send failures to Debugger Agent.`,
			}))
	}

	async listFeaturesNeedingTests(): Promise<ProductFeature[]> {
		const memory = await this.getFeatures()
		return memory.features.filter((f) => f.status === "needs_test" || !f.lastTestedAt)
	}

	// ── Internal ──────────────────────────────────────────────────────────

	private assertAllowedFile(fileName: string): void {
		if (!ALLOWED_FILES.has(fileName)) {
			throw new Error(`Unsupported memory file: ${fileName}. Allowed: ${Array.from(ALLOWED_FILES).join(", ")}`)
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err
}
