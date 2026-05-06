/**
 * Script to record the Settings & API Keys upgrade commit in the CommitDeployLog.
 * Run with: node scripts/record-settings-upgrade-commit.mjs
 */
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs/promises"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logPath = path.resolve(__dirname, "../server/src/memory/commit-deploy-log.json")

async function main() {
	const raw = await fs.readFile(logPath, "utf-8")
	const log = JSON.parse(raw)

	log.commits.push({
		commitSha: "settings-upgrade-001",
		agent: "Roo Code",
		type: "feature",
		title: "Add Settings & API Keys system — dashboard views, secret vault, provider testers, agent routing sync",
		filesChanged: [
			"cloud/dashboard/src/components/views/api-keys.tsx",
			"cloud/dashboard/src/components/views/settings.tsx",
			"cloud/dashboard/src/components/sidebar.tsx",
			"cloud/dashboard/src/app/page.tsx",
			"cloud/api/api.js",
			"cloud/config/providers.ts",
			"cloud/config/agent-routing.ts",
			"docs/resources/working-tree.md",
		],
		featuresAffected: [
			"settings-api-keys",
			"dashboard",
			"api-server",
			"agent-routing",
			"secret-vault",
			"working-tree",
		],
		bugsFixed: [],
		timestamp: Date.now(),
	})

	await fs.writeFile(logPath, JSON.stringify(log, null, 2), "utf-8")
	console.log("✅ Commit recorded in commit-deploy-log.json")
}

main().catch(console.error)
