import fs from "node:fs/promises"
import path from "node:path"
import { SuperRooCore } from "../SuperRooCore"
import { logHeader, logStep, logWarn } from "../utils/logger"

interface DebugApiOptions {
	project?: string
}

const ENV_NAMES = [
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
	"MOONSHOT_API_KEY",
	"KIMI_API_KEY",
	"OPENAI_API_KEY",
]

export async function runDebugApiCommand(options: DebugApiOptions): Promise<void> {
	logHeader("SuperRoo API Debugger")

	const core = new SuperRooCore({ projectPath: options.project })
	await core.verifyProject()

	logStep("Checking process environment keys")
	for (const name of ENV_NAMES) {
		console.log(`${name}: ${process.env[name] ? "present" : "missing"}`)
	}

	logStep("Checking local .env file")
	const envPath = path.join(core.projectPath, ".env")
	try {
		const envText = await fs.readFile(envPath, "utf8")
		for (const name of ENV_NAMES) {
			console.log(`.env ${name}: ${envText.includes(name) ? "found" : "not found"}`)
		}
	} catch {
		logWarn("No .env file found in project root.")
	}

	logStep("Common API problems to check")
	console.log(`
1. Wrong model name
2. Wrong provider base URL
3. Missing API key in VPS environment
4. Key exists locally but not in deployment server
5. CORS or server-side proxy issue
6. Rate limit or billing issue
7. Kimi/Moonshot key used in Anthropic-compatible endpoint without correct adapter
`)
}
