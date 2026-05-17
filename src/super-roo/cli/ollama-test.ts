import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { OllamaPipeline } from "../ollama"

async function main() {
	const logFile = process.argv[2]
	if (!logFile) {
		console.error("Usage: tsx src/super-roo/cli/ollama-test.ts <log-file>")
		process.exit(1)
	}

	const logs = readFileSync(resolve(logFile), "utf8")
	const pipeline = new OllamaPipeline()
	const health = await pipeline.health()
	if (!health.ok) throw new Error(`Ollama not ready: ${health.error}`)

	const result = await pipeline.processLogs({
		source: "vs-superroo",
		project: process.env.SUPERROO_PROJECT || "superroo2",
		command: process.env.SUPERROO_LAST_COMMAND || "manual-test",
		logs,
	})

	const outDir = resolve("tmp/ollama")
	mkdirSync(outDir, { recursive: true })
	writeFileSync(`${outDir}/summary.json`, JSON.stringify(result.summary, null, 2))
	writeFileSync(`${outDir}/codex-brief.md`, result.codexBrief)
	writeFileSync(`${outDir}/deepseek-task.md`, result.deepseekTask)

	console.log("Ollama summary created:")
	console.log(`- ${outDir}/summary.json`)
	console.log(`- ${outDir}/codex-brief.md`)
	console.log(`- ${outDir}/deepseek-task.md`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
