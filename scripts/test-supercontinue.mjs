#!/usr/bin/env node
/**
 * SuperContinue Test Script
 * Verifies Ollama connectivity and Central Brain integration.
 */

import { getSuperContinueBrain, MODEL_ROLES, defaultConfig } from "../packages/supercontinue/dist/index.js"

async function main() {
	console.log("=== SuperContinue Verification ===\n")

	// 1. Check Ollama connectivity
	console.log("1. Checking Ollama connectivity...")
	try {
		const res = await fetch("http://localhost:11434/api/tags")
		const data = await res.json()
		const models = data.models?.map((m) => m.name) || []
		console.log("   Available models:", models.join(", "))

		const required = [
			MODEL_ROLES.PLANNER,
			MODEL_ROLES.ARCHITECT,
			MODEL_ROLES.CODING,
			MODEL_ROLES.COMPLEX_CODING,
			MODEL_ROLES.SEARCH_EMBEDDINGS,
		]
		const missing = required.filter((m) => !models.includes(m))
		if (missing.length > 0) {
			console.log("   ⚠️ Missing models:", missing.join(", "))
		} else {
			console.log("   ✅ All required models available")
		}
	} catch (err) {
		console.log("   ❌ Ollama not reachable:", err.message)
		process.exit(1)
	}

	// 2. Test SuperContinue config
	console.log("\n2. Testing SuperContinue config...")
	console.log("   Models configured:", defaultConfig.models.length)
	console.log("   Telemetry disabled:", defaultConfig.disableTelemetry)
	console.log("   Remote config disabled:", !defaultConfig.allowRemoteConfig)

	// 3. Test Central Brain connectivity
	console.log("\n3. Testing Central Brain connectivity...")
	const brain = getSuperContinueBrain()
	try {
		await brain.registerLessonIntent("Verification test")
		console.log("   ✅ Lesson intent registered")
	} catch (err) {
		console.log("   ⚠️ Central Brain not reachable (expected in offline mode)")
	}

	// 4. Test model query
	console.log("\n4. Testing model query...")
	try {
		const res = await fetch("http://localhost:11434/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: MODEL_ROLES.CODING,
				prompt: "Hello, I am SuperContinue testing Ollama connectivity.",
				stream: false,
			}),
		})
		const data = await res.json()
		console.log("   ✅ Model response received:", data.response?.slice(0, 50) + "...")
	} catch (err) {
		console.log("   ❌ Model query failed:", err.message)
	}

	console.log("\n=== Verification Complete ===")
}

main().catch((err) => {
	console.error("Fatal error:", err)
	process.exit(1)
})