#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const required = [
	"AGENTS.md",
	".codex/config.toml",
	"docs/agent-workflow/codex-deepseek-ollama.md",
	"memory/lessons-learned.md",
	"memory/bugs-fixed.md",
	"memory/model-decisions.md",
	"memory/feature-knowledge.md",
	"commissioning/test-results.md",
]

for (const file of required) {
	const full = path.resolve(process.cwd(), file)
	fs.mkdirSync(path.dirname(full), { recursive: true })
	if (!fs.existsSync(full)) {
		fs.writeFileSync(full, `# ${path.basename(file)}\n\nInitialized by SuperRoo workflow check.\n`, "utf8")
		console.log(`created ${file}`)
	} else {
		console.log(`ok ${file}`)
	}
}

console.log("\nSuperRoo Codex -> DeepSeek -> Ollama workflow files are present.")
