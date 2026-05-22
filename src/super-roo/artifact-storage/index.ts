/**
 * Super Roo — Artifact Storage System (F9)
 *
 * Inspired by Mastra's S3 vectors store and AWS Remote SWE's S3 artifact storage.
 * Provides S3-compatible artifact storage for large file handling
 * (build artifacts, screenshots, logs) with a local filesystem fallback.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { createWriteStream, createReadStream } from "fs"
import { pipeline } from "stream/promises"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type StorageProviderType = "s3" | "local" | "gcs" | "azure"

export interface StorageProviderConfig {
	type: StorageProviderType
	bucket?: string
	region?: string
	endpoint?: string
	accessKeyId?: string
	secretAccessKey?: string
	basePath?: string
	maxSizeBytes?: number
}

export interface ArtifactMetadata {
	id: string
	filename: string
	mimeType: string
	sizeBytes: number
	checksum: string
	createdAt: number
	updatedAt: number
	tags: string[]
	projectId?: string
	taskId?: string
	description?: string
}

export interface UploadResult {
	success: boolean
	artifact?: ArtifactMetadata
	url?: string
	error?: string
}

export interface DownloadResult {
	success: boolean
	data?: Buffer
	stream?: NodeJS.ReadableStream
	artifact?: ArtifactMetadata
	error?: string
}

export interface ListResult {
	success: boolean
	artifacts: ArtifactMetadata[]
	total: number
	nextToken?: string
	error?: string
}

export interface DeleteResult {
	success: boolean
	error?: string
}

export interface ArtifactStore {
	readonly type: StorageProviderType

	initialize(config: StorageProviderConfig): Promise<void>
	upload(
		filename: string,
		data: Buffer | NodeJS.ReadableStream,
		metadata?: Partial<ArtifactMetadata>,
	): Promise<UploadResult>
	download(artifactId: string): Promise<DownloadResult>
	list(prefix?: string, maxResults?: number, nextToken?: string): Promise<ListResult>
	delete(artifactId: string): Promise<DeleteResult>
	getMetadata(artifactId: string): Promise<ArtifactMetadata | null>
	getUrl(artifactId: string): Promise<string | null>
}

// ──────────────────────────────────────────────────────────────────────────────
// Local Filesystem Store
// ──────────────────────────────────────────────────────────────────────────────

export class LocalArtifactStore implements ArtifactStore {
	readonly type: StorageProviderType = "local"
	private basePath = "./artifacts"
	private maxSizeBytes = 500 * 1024 * 1024 // 500MB default
	private metadata: Map<string, ArtifactMetadata> = new Map()
	private metadataPath = ""

	async initialize(config: StorageProviderConfig): Promise<void> {
		this.basePath = config.basePath || this.basePath
		this.maxSizeBytes = config.maxSizeBytes || this.maxSizeBytes
		this.metadataPath = path.join(this.basePath, ".metadata.json")
		await fs.mkdir(this.basePath, { recursive: true })
		await this._loadMetadata()
	}

	async upload(
		filename: string,
		data: Buffer | NodeJS.ReadableStream,
		metadata?: Partial<ArtifactMetadata>,
	): Promise<UploadResult> {
		try {
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
			const filePath = path.join(this.basePath, `${id}-${safeName}`)

			let sizeBytes = 0
			let checksum = ""

			if (Buffer.isBuffer(data)) {
				sizeBytes = data.length
				checksum = this._simpleHash(data)
				await fs.writeFile(filePath, data)
			} else {
				// Stream mode — write to file and compute size
				const writeStream = createWriteStream(filePath)
				await pipeline(data, writeStream)
				const stat = await fs.stat(filePath)
				sizeBytes = stat.size
				const fileData = await fs.readFile(filePath)
				checksum = this._simpleHash(fileData)
			}

			if (sizeBytes > this.maxSizeBytes) {
				await fs.unlink(filePath)
				return { success: false, error: `File exceeds max size of ${this.maxSizeBytes} bytes` }
			}

			const artifact: ArtifactMetadata = {
				id,
				filename: safeName,
				mimeType: metadata?.mimeType || this._inferMimeType(filename),
				sizeBytes,
				checksum,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				tags: metadata?.tags || [],
				projectId: metadata?.projectId,
				taskId: metadata?.taskId,
				description: metadata?.description,
			}

			this.metadata.set(id, artifact)
			await this._saveMetadata()

			return {
				success: true,
				artifact,
				url: filePath,
			}
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	async download(artifactId: string): Promise<DownloadResult> {
		const meta = this.metadata.get(artifactId)
		if (!meta) {
			return { success: false, error: `Artifact "${artifactId}" not found` }
		}

		const files = await fs.readdir(this.basePath)
		const file = files.find((f) => f.startsWith(artifactId))
		if (!file) {
			return { success: false, error: `File for artifact "${artifactId}" not found on disk` }
		}

		try {
			const data = await fs.readFile(path.join(this.basePath, file))
			return { success: true, data, artifact: meta }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	async list(prefix?: string, maxResults = 100, _nextToken?: string): Promise<ListResult> {
		let artifacts = Array.from(this.metadata.values())
		if (prefix) {
			artifacts = artifacts.filter(
				(a) => a.filename.startsWith(prefix) || a.tags.some((t) => t.startsWith(prefix)),
			)
		}
		artifacts.sort((a, b) => b.createdAt - a.createdAt)
		const sliced = artifacts.slice(0, maxResults)
		return {
			success: true,
			artifacts: sliced,
			total: artifacts.length,
		}
	}

	async delete(artifactId: string): Promise<DeleteResult> {
		const meta = this.metadata.get(artifactId)
		if (!meta) {
			return { success: false, error: `Artifact "${artifactId}" not found` }
		}

		const files = await fs.readdir(this.basePath)
		const file = files.find((f) => f.startsWith(artifactId))
		if (file) {
			await fs.unlink(path.join(this.basePath, file))
		}

		this.metadata.delete(artifactId)
		await this._saveMetadata()
		return { success: true }
	}

	async getMetadata(artifactId: string): Promise<ArtifactMetadata | null> {
		return this.metadata.get(artifactId) || null
	}

	async getUrl(artifactId: string): Promise<string | null> {
		const meta = this.metadata.get(artifactId)
		if (!meta) return null
		return path.join(this.basePath, `${artifactId}-${meta.filename}`)
	}

	private _inferMimeType(filename: string): string {
		const ext = path.extname(filename).toLowerCase()
		const mimeMap: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".svg": "image/svg+xml",
			".pdf": "application/pdf",
			".json": "application/json",
			".zip": "application/zip",
			".tar": "application/x-tar",
			".gz": "application/gzip",
			".log": "text/plain",
			".txt": "text/plain",
			".html": "text/html",
			".css": "text/css",
			".js": "application/javascript",
			".ts": "application/typescript",
		}
		return mimeMap[ext] || "application/octet-stream"
	}

	private _simpleHash(data: Buffer): string {
		let hash = 0
		for (let i = 0; i < data.length && i < 10000; i++) {
			const byte = data[i]
			hash = (hash << 5) - hash + byte
			hash |= 0
		}
		return Math.abs(hash).toString(16).padStart(8, "0")
	}

	private async _loadMetadata(): Promise<void> {
		try {
			const raw = await fs.readFile(this.metadataPath, "utf8")
			const entries = JSON.parse(raw)
			if (Array.isArray(entries)) {
				for (const entry of entries) {
					this.metadata.set(entry.id, entry)
				}
			}
		} catch {
			// No existing metadata — start fresh
		}
	}

	private async _saveMetadata(): Promise<void> {
		const entries = Array.from(this.metadata.values())
		await fs.writeFile(this.metadataPath, JSON.stringify(entries, null, 2), "utf8")
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Artifact Manager
// ──────────────────────────────────────────────────────────────────────────────

export class ArtifactManager {
	private stores: Map<StorageProviderType, ArtifactStore> = new Map()
	private defaultStore: StorageProviderType = "local"

	registerStore(store: ArtifactStore): void {
		this.stores.set(store.type, store)
	}

	getStore(type?: StorageProviderType): ArtifactStore {
		const storeType = type || this.defaultStore
		const store = this.stores.get(storeType)
		if (!store) {
			throw new Error(`Artifact store "${storeType}" not registered`)
		}
		return store
	}

	setDefaultStore(type: StorageProviderType): void {
		if (!this.stores.has(type)) {
			throw new Error(`Cannot set default: store "${type}" not registered`)
		}
		this.defaultStore = type
	}

	listStores(): StorageProviderType[] {
		return Array.from(this.stores.keys())
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let _globalArtifactManager: ArtifactManager | null = null

export function getArtifactManager(): ArtifactManager {
	if (!_globalArtifactManager) {
		_globalArtifactManager = new ArtifactManager()
		const localStore = new LocalArtifactStore()
		_globalArtifactManager.registerStore(localStore)
	}
	return _globalArtifactManager
}
