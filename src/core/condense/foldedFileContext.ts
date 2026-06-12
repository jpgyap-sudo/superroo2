import * as path from "path"
import * as fs from "fs/promises"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { RooIgnoreController } from "../ignore/RooIgnoreController"

const FOLDED_FILE_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const FOLDED_FILE_CONTEXT_CACHE_MAX_SIZE = 200

type CachedFoldedFileContext = {
	result: FoldedFileContextResult
	cachedAt: number
}

// LRU cache with size limit
const foldedFileContextCache = new Map<string, string>()
const foldedFileContextAccessOrder = new Map<string, number>() // Track access time for LRU eviction
let foldedFileContextAccessCounter = 0

function evictIfNecessary(): void {
	if (foldedFileContextCache.size >= FOLDED_FILE_CONTEXT_CACHE_MAX_SIZE) {
		// Find the least recently used entry
		let oldestKey: string | undefined
		let oldestTime = Infinity
		for (const [key, accessTime] of foldedFileContextAccessOrder) {
			if (accessTime < oldestTime) {
				oldestTime = accessTime
				oldestKey = key
			}
		}
		if (oldestKey) {
			foldedFileContextCache.delete(oldestKey)
			foldedFileContextAccessOrder.delete(oldestKey)
		}
	}
}

export function invalidateFoldedFileContextCache(filePath?: string): void {
	if (filePath) {
		// Remove all cache entries for this file (any mtime)
		for (const key of foldedFileContextCache.keys()) {
			if (key.startsWith(`${filePath}:`)) {
				foldedFileContextCache.delete(key)
				foldedFileContextAccessOrder.delete(key)
			}
		}
	} else {
		foldedFileContextCache.clear()
		foldedFileContextAccessOrder.clear()
	}
}

async function getCachedFoldedFileContext(
	absolutePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<string | null> {
	try {
		const stat = await fs.stat(absolutePath)
		const cacheKey = `${absolutePath}:${stat.mtimeMs}`
		const cached = foldedFileContextCache.get(cacheKey)

		if (cached) {
			// Update access time for LRU
			foldedFileContextAccessOrder.set(cacheKey, ++foldedFileContextAccessCounter)
			return cached
		}

		// Evict oldest entry if cache is full
		evictIfNecessary()

		const result = await parseSourceCodeDefinitionsForFile(absolutePath, rooIgnoreController)
		if (!result || isTreeSitterErrorString(result)) {
			foldedFileContextCache.set(cacheKey, "")
			foldedFileContextAccessOrder.set(cacheKey, ++foldedFileContextAccessCounter)
			return ""
		}

		foldedFileContextCache.set(cacheKey, result)
		foldedFileContextAccessOrder.set(cacheKey, ++foldedFileContextAccessCounter)
		return result
	} catch {
		return null
	}
}

/**
 * Checks if a definitions string is actually an error message from tree-sitter
 * rather than valid code definitions. These error strings should not be embedded
 * in the folded file context - instead, the file should be skipped.
 */
function isTreeSitterErrorString(definitions: string): boolean {
	// These are known error messages from parseSourceCodeDefinitionsForFile
	const errorPatterns = ["This file does not exist", "do not have permission", "Unsupported file type:"]
	return errorPatterns.some((pattern) => definitions.includes(pattern))
}

/**
 * Result of generating folded file context.
 */
export interface FoldedFileContextResult {
	/** The formatted string containing all folded file definitions (joined) */
	content: string
	/** Individual file sections, each in its own <system-reminder> block */
	sections: string[]
	/** Number of files successfully processed */
	filesProcessed: number
	/** Number of files that failed or were skipped */
	filesSkipped: number
	/** Total character count of the folded content */
	characterCount: number
}

/**
 * Options for generating folded file context.
 */
export interface FoldedFileContextOptions {
	/** Maximum total characters for the folded content (default: 50000) */
	maxCharacters?: number
	/** The current working directory for resolving relative paths */
	cwd: string
	/** Optional RooIgnoreController for file access validation */
	rooIgnoreController?: RooIgnoreController
}

/**
 * Generates folded (signatures-only) file context for a list of files using tree-sitter.
 *
 * This function takes file paths that were read during a conversation and produces
 * a condensed representation showing only function signatures, class declarations,
 * and other important structural definitions - hiding implementation bodies.
 *
 * Each file is wrapped in its own `<system-reminder>` block during context condensation,
 * allowing the model to retain awareness of file structure without consuming excessive tokens.
 *
 * @param filePaths - Array of file paths to process (relative to cwd)
 * @param options - Configuration options including cwd and max characters
 * @returns FoldedFileContextResult with the formatted content and statistics
 *
 * @example
 * ```typescript
 * const result = await generateFoldedFileContext(
 *   ['src/utils/helpers.ts', 'src/api/client.ts'],
 *   { cwd: '/project', maxCharacters: 30000 }
 * )
 * // result.content contains individual <system-reminder> blocks for each file:
 * // <system-reminder>
 * // ## File Context: src/utils/helpers.ts
 * // 1--15 | export function formatDate(...)
 * // 17--45 | export class DateHelper {...}
 * // </system-reminder>
 * // <system-reminder>
 * // ## File Context: src/api/client.ts
 * // ...
 * // </system-reminder>
 * ```
 */
export async function generateFoldedFileContext(
	filePaths: string[],
	options: FoldedFileContextOptions,
): Promise<FoldedFileContextResult> {
	const { maxCharacters = 50000, cwd, rooIgnoreController } = options

	const result: FoldedFileContextResult = {
		content: "",
		sections: [],
		filesProcessed: 0,
		filesSkipped: 0,
		characterCount: 0,
	}

	if (filePaths.length === 0) {
		return result
	}

	const foldedSections: string[] = []
	let currentCharCount = 0
	const failedFiles: string[] = []

	const parsePromises = filePaths.map(async (filePath, i) => {
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
		const cached = await getCachedFoldedFileContext(absolutePath, rooIgnoreController)
		return { filePath, absolutePath, cached, index: i }
	})

	const parsed = await Promise.all(parsePromises)

	for (const item of parsed) {
		const { filePath, cached, index } = item

		if (!cached) {
			result.filesSkipped++
			failedFiles.push(filePath)
			continue
		}

		const definitions = cached
		const sectionContent = `<system-reminder>
## File Context: ${filePath}
${definitions}
</system-reminder>`

		if (currentCharCount + sectionContent.length > maxCharacters) {
			const remainingChars = maxCharacters - currentCharCount
			if (remainingChars < 200) {
				result.filesSkipped += filePaths.length - index
				break
			}

			const truncatedDefinitions = definitions.substring(0, remainingChars - 100) + "\n... (truncated)"
			const truncatedContent = `<system-reminder>
## File Context: ${filePath}
${truncatedDefinitions}
</system-reminder>`
			foldedSections.push(truncatedContent)
			currentCharCount += truncatedContent.length
			result.filesProcessed++
			result.filesSkipped += filePaths.length - result.filesProcessed - result.filesSkipped
			break
		}

		foldedSections.push(sectionContent)
		currentCharCount += sectionContent.length
		result.filesProcessed++
	}

	// Log failed files as a single batch summary instead of per-file errors
	if (failedFiles.length > 0) {
		console.warn(
			`Folded context generation: skipped ${failedFiles.length} file(s) due to errors: ${failedFiles.slice(0, 5).join(", ")}${failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : ""}`,
		)
	}

	if (foldedSections.length > 0) {
		result.sections = foldedSections
		result.content = foldedSections.join("\n")
		result.characterCount = result.content.length
	}

	return result
}
