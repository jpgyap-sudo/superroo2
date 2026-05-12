import fs from "node:fs/promises"
import path from "node:path"
import { MemoryClient } from "@superroo/memory-core"

const PROJECT_ID = process.env.SUPERROO_PROJECT_ID || "superroo2"
const REPO_PATH = process.env.SUPERROO_REPO_PATH || process.cwd()

const CANDIDATE_PATHS = [
	"memory",
	"server/src/memory",
	"CLAUDE.md",
	"instructions.md",
	"skills.md",
	"agents.md",
	"resources.md",
	"commissioning.md",
	"CODERS_CHANGELOG.md",
	"CHANGELOG.md",
	"AGENTS.md",
]

async function exists(p: string) {
	try {
		await fs.access(p)
		return true
	} catch {
		return false
	}
}

async function walk(p: string): Promise<string[]> {
	const stat = await fs.stat(p)
	if (stat.isFile()) return [p]
	const entries = await fs.readdir(p)
	const out: string[] = []
	for (const entry of entries) {
		const child = path.join(p, entry)
		const childStat = await fs.stat(child)
		if (childStat.isDirectory()) out.push(...(await walk(child)))
		else out.push(child)
	}
	return out
}

function sourceTypeFor(file: string): string {
	if (file.includes("/memory/") || file.includes("server/src/memory")) return "existing_json_memory"
	if (file.endsWith(".md")) return "project_rule_or_skill_md"
	if (file.endsWith(".json")) return "json_memory"
	return "legacy_memory"
}

async function main() {
	const memory = new MemoryClient()
	const files: string[] = []

	for (const rel of CANDIDATE_PATHS) {
		const abs = path.join(REPO_PATH, rel)
		if (await exists(abs)) files.push(...(await walk(abs)))
	}

	let migrated = 0
	for (const file of files) {
		const ext = path.extname(file).toLowerCase()
		if (![".json", ".md", ".txt", ".log"].includes(ext)) continue

		const content = await fs.readFile(file, "utf8")
		if (!content.trim()) continue

		const rel = path.relative(REPO_PATH, file)
		try {
			await memory.saveMemory({
				projectId: PROJECT_ID,
				sourceType: sourceTypeFor(file),
				sourcePath: rel,
				title: rel,
				content: content.slice(0, 20000),
				tags: ["migration", ext.replace(".", "")],
				metadata: { migratedFrom: rel },
				importance: rel.toLowerCase().includes("skill") ? 5 : 3,
				trustScore: 0.75,
			})
			migrated++
			console.log(`Migrated ${rel}`)
		} catch (err) {
			console.error(`Failed to migrate ${rel}:`, err instanceof Error ? err.message : err)
		}
	}

	console.log(`\nMigration complete: ${migrated} files migrated.`)
	await memory.close()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
