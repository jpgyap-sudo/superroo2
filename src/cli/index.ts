#!/usr/bin/env node

import { runAutonomous } from "../core/runAutonomous"

const command = process.argv[2]

async function main() {
	if (!command) {
		console.log(`
SuperRoo CLI

Commands:
  autonomous   Run autonomous coding loop
  deploy       Deploy project
  check-vps    Check VPS deployment
  debug-api    Debug API setup
`)
		return
	}

	if (command === "autonomous") {
		await runAutonomous()
		return
	}

	if (command === "deploy") {
		console.log("Deploy command running...")
		return
	}

	if (command === "check-vps") {
		console.log("Checking VPS...")
		return
	}

	if (command === "debug-api") {
		console.log("Debugging API...")
		return
	}

	console.error(`Unknown command: ${command}`)
	process.exit(1)
}

main().catch((error) => {
	console.error("SuperRoo CLI failed:", error)
	process.exit(1)
})
