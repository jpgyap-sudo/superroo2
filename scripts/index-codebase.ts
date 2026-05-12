import fs from "node:fs/promises"
import path from "node:path"
import { MemoryClient } from "@superroo/memory-core"

const PROJECT_ID = process.env.SUPERROO_PROJECT_ID || "superroo2"
const REPO_PATH = process.env.SUPERROO_REPO_PATH || process.cwd()

const INCLUDE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yml", ".yaml", ".sql"])
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", "out", "bin"])

async function walk(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const out: string[] = []
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (!IGNORE_DIRS.has(entry.name)) out.push(...(await walk(path.join(dir, entry.name))))
		} else if (INCLUDE_EXT.has(path.extname(entry.name).toLowerCase())) {
			out.push(path.join(dir, entry.name))
		}
	}
	return out
}

function chunks(content: string, size = 4000): string[] {
	const result: string[] = []
	for (let i = 0; i < content.length; i += size) result.push(content.slice(i, i + size))
	return result
}

async function main() {
	const memory = new MemoryClient()
	const files = await walk(REPO_PATH)
	let indexed = 0

	for (const file of files) {
		const rel = path.relative(REPO_PATH, file)
		const content = await fs.readFile(file, "utf8")
		const language = path.extname(file).replace(".", "")
		let chunkIndex = 0

		for (const chunk of chunks(content)) {
			try {
				await memory.indexCodeChunk({
					projectId: PROJECT_ID,
					filePath: rel,
					language,
					content: chunk,
					summary: `Code chunk ${chunkIndex} from ${rel}`,
					metadata: { chunkIndex, totalLength: content.length },
				})
				chunkIndex++
			} catch (err) {
				console.error(
					`Failed to index chunk ${chunkIndex} of ${rel}:`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		indexed++
		console.log(`Indexed ${rel} (${chunkIndex} chunks)`)
	}

	console.log(`\nIndexing complete: ${indexed} files indexed.`)
	await memory.close()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
