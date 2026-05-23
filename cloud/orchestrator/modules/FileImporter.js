/**
 * Super Roo — Cloud File Importer
 *
 * Port of src/super-roo/import/FileImporter.ts
 *
 * Handles importing and extracting files to speed up coding:
 *   - Archives: zip, tar, tar.gz, tgz
 *   - Images: png, jpg, jpeg, webp, gif, svg, bmp, ico
 *   - Documents: pdf, doc, docx, txt, md, json, csv, xml, yaml, yml
 *   - Code: any text-based source file
 */

const fs = require("fs")
const path = require("path")

/** @typedef {"archive"|"image"|"document"|"code"|"unknown"} ImportableFileType */

/**
 * @typedef {Object} ImportedFile
 * @property {string} originalPath
 * @property {string} fileName
 * @property {string} ext
 * @property {ImportableFileType} type
 * @property {string|string[]} [data] - For images: base64 data URI. For archives: list of extracted files.
 * @property {number} size - Size in bytes
 */

/**
 * @typedef {Object} ImportResult
 * @property {boolean} ok
 * @property {ImportedFile[]} files
 * @property {string[]} errors
 */

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2"])
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".ico"])
const DOC_EXTS = new Set([
	".pdf",
	".doc",
	".docx",
	".txt",
	".md",
	".json",
	".csv",
	".xml",
	".yaml",
	".yml",
	".html",
	".htm",
	".css",
	".scss",
	".less",
])

/**
 * @param {string} filePath
 * @returns {ImportableFileType}
 */
function detectType(filePath) {
	const ext = path.extname(filePath).toLowerCase()
	if (ARCHIVE_EXTS.has(ext) || filePath.endsWith(".tar.gz")) return "archive"
	if (IMAGE_EXTS.has(ext)) return "image"
	if (DOC_EXTS.has(ext)) return "document"
	return "code"
}

class FileImporter {
	/**
	 * @param {string} workspaceRoot
	 */
	constructor(workspaceRoot) {
		this.workspaceRoot = workspaceRoot
		/** @type {Map<string, (src: string, dest: string) => Promise<string[]>>} */
		this.extractors = new Map()
		this.extractors.set(".zip", this._extractZip.bind(this))
		this.extractors.set(".tar", this._extractTar.bind(this))
		this.extractors.set(".gz", this._extractTarGz.bind(this))
		this.extractors.set(".tgz", this._extractTarGz.bind(this))

		// Stats tracking
		this._totalImports = 0
		this._totalFiles = 0
		this._totalErrors = 0
		this._lastImport = null
		this._importedPaths = []
		this._recentImports = []
	}

	/**
	 * Import one or more file paths.
	 * @param {string[]} paths
	 * @returns {Promise<ImportResult>}
	 */
	async importPaths(paths) {
		const files = []
		const errors = []

		for (const p of paths) {
			try {
				const stat = fs.statSync(p)
				if (stat.isDirectory()) {
					const inner = await this._importDirectory(p)
					files.push(...inner.files)
					errors.push(...inner.errors)
					continue
				}

				const imported = await this._importSingle(p)
				if (imported) files.push(imported)
			} catch (err) {
				errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		// Update stats
		this._totalImports++
		this._totalFiles += files.length
		this._totalErrors += errors.length
		this._lastImport = new Date().toISOString()
		const importedPaths = files.map((f) => f.originalPath)
		this._importedPaths.push(...importedPaths)
		// Keep only last 1000 paths
		if (this._importedPaths.length > 1000) {
			this._importedPaths = this._importedPaths.slice(-1000)
		}

		const importRecord = {
			timestamp: this._lastImport,
			paths: importedPaths,
			successCount: files.length,
			errorCount: errors.length,
		}
		this._recentImports.unshift(importRecord)
		// Keep only last 50 records
		if (this._recentImports.length > 50) {
			this._recentImports = this._recentImports.slice(0, 50)
		}

		return { ok: errors.length === 0, files, errors }
	}

	/**
	 * Import a dropped file buffer (e.g. from drag-and-drop).
	 * @param {string} fileName
	 * @param {Buffer} buffer
	 * @returns {Promise<ImportResult>}
	 */
	async importBuffer(fileName, buffer) {
		const tmpPath = path.join(this.workspaceRoot, ".super-roo", "tmp", fileName)
		fs.mkdirSync(path.dirname(tmpPath), { recursive: true })
		fs.writeFileSync(tmpPath, buffer)
		const result = await this.importPaths([tmpPath])
		try {
			fs.unlinkSync(tmpPath)
		} catch {
			// tmp cleanup best effort
		}
		return result
	}

	/**
	 * Get stats about the importer.
	 * @returns {{
	 *   totalImports: number,
	 *   totalFiles: number,
	 *   totalErrors: number,
	 *   lastImport: string | null,
	 *   importedPaths: string[],
	 *   recentImports: Array<{timestamp: string, paths: string[], successCount: number, errorCount: number}>,
	 *   workspaceRoot: string,
	 *   extractorCount: number,
	 * }}
	 */
	getStats() {
		return {
			totalImports: this._totalImports,
			totalFiles: this._totalFiles,
			totalErrors: this._totalErrors,
			lastImport: this._lastImport,
			importedPaths: this._importedPaths.slice(-50),
			recentImports: this._recentImports.slice(0, 20),
			workspaceRoot: this.workspaceRoot,
			extractorCount: this.extractors.size,
		}
	}

	/**
	 * @param {string} filePath
	 * @returns {Promise<ImportedFile|null>}
	 * @private
	 */
	async _importSingle(filePath) {
		const type = detectType(filePath)
		const size = fs.statSync(filePath).size
		const fileName = path.basename(filePath)

		if (type === "archive") {
			const extracted = await this._extractArchive(filePath)
			return {
				originalPath: filePath,
				fileName,
				ext: path.extname(fileName),
				type,
				data: extracted,
				size,
			}
		}

		if (type === "image") {
			const buf = fs.readFileSync(filePath)
			const mime = this._mimeForExt(path.extname(fileName))
			const b64 = buf.toString("base64")
			return {
				originalPath: filePath,
				fileName,
				ext: path.extname(fileName),
				type,
				data: `data:${mime};base64,${b64}`,
				size,
			}
		}

		// Document or code — read as UTF-8 text
		const content = fs.readFileSync(filePath, "utf-8")
		return {
			originalPath: filePath,
			fileName,
			ext: path.extname(fileName),
			type: type === "document" ? "document" : "code",
			data: content,
			size,
		}
	}

	/**
	 * @param {string} dir
	 * @returns {Promise<ImportResult>}
	 * @private
	 */
	async _importDirectory(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true })
		const files = []
		const errors = []

		for (const ent of entries) {
			const full = path.join(dir, ent.name)
			try {
				if (ent.isDirectory()) {
					const inner = await this._importDirectory(full)
					files.push(...inner.files)
					errors.push(...inner.errors)
				} else {
					const imported = await this._importSingle(full)
					if (imported) files.push(imported)
				}
			} catch (err) {
				errors.push(`${full}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		return { ok: errors.length === 0, files, errors }
	}

	/**
	 * @param {string} archivePath
	 * @returns {Promise<string[]>}
	 * @private
	 */
	async _extractArchive(archivePath) {
		const ext = path.extname(archivePath).toLowerCase()
		const destDir = path.join(this.workspaceRoot, ".super-roo", "extracted", path.basename(archivePath, ext))
		fs.mkdirSync(destDir, { recursive: true })

		const extractor = this.extractors.get(ext)
		if (!extractor) {
			const dest = path.join(destDir, path.basename(archivePath))
			fs.copyFileSync(archivePath, dest)
			return [dest]
		}

		return extractor(archivePath, destDir)
	}

	/**
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string[]>}
	 * @private
	 */
	async _extractZip(src, dest) {
		try {
			const AdmZip = require("adm-zip")
			const zip = new AdmZip(src)
			zip.extractAllTo(dest, true)
			return this._listFilesRecursive(dest)
		} catch {
			const destFile = path.join(dest, path.basename(src))
			fs.copyFileSync(src, destFile)
			return [destFile]
		}
	}

	/**
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string[]>}
	 * @private
	 */
	async _extractTar(src, dest) {
		try {
			const { spawnSync } = require("child_process")
			const result = spawnSync("tar", ["-xf", src, "-C", dest], { stdio: "inherit" })
			if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`)
			return this._listFilesRecursive(dest)
		} catch {
			const destFile = path.join(dest, path.basename(src))
			fs.copyFileSync(src, destFile)
			return [destFile]
		}
	}

	/**
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string[]>}
	 * @private
	 */
	async _extractTarGz(src, dest) {
		try {
			const { spawnSync } = require("child_process")
			const result = spawnSync("tar", ["-xzf", src, "-C", dest], { stdio: "inherit" })
			if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`)
			return this._listFilesRecursive(dest)
		} catch {
			const destFile = path.join(dest, path.basename(src))
			fs.copyFileSync(src, destFile)
			return [destFile]
		}
	}

	/**
	 * @param {string} dir
	 * @returns {string[]}
	 * @private
	 */
	_listFilesRecursive(dir) {
		const out = []
		for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, ent.name)
			if (ent.isDirectory()) out.push(...this._listFilesRecursive(full))
			else out.push(full)
		}
		return out
	}

	/**
	 * @param {string} ext
	 * @returns {string}
	 * @private
	 */
	_mimeForExt(ext) {
		const map = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".webp": "image/webp",
			".gif": "image/gif",
			".svg": "image/svg+xml",
			".bmp": "image/bmp",
			".ico": "image/x-icon",
		}
		return map[ext.toLowerCase()] ?? "application/octet-stream"
	}
}

module.exports = { FileImporter }
