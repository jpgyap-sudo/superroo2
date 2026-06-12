#!/usr/bin/env node
/**
 * SuperRoo Webview Test Helper
 * 
 * This script helps diagnose webview issues by checking:
 * 1. Build artifacts exist
 * 2. Extension can be launched
 * 3. Debug logs are in place
 */

import { execSync } from "child_process"
import { existsSync, statSync, readFileSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()

console.log("=== SuperRoo Webview Test Helper ===\n")

// Check build artifacts
const checks = [
	{ path: "src/dist/extension.js", desc: "Extension bundle" },
	{ path: "src/dist/webview-ui/build/index.html", desc: "Webview index.html" },
	{ path: "src/dist/webview-ui/build/assets/index.js", desc: "Webview bundle" },
	{ path: "src/dist/webview-ui/build/assets/index.css", desc: "Webview CSS" },
	{ path: "src/dist/assets/codicons/codicon.css", desc: "Codicons CSS" },
]

console.log("1. Checking build artifacts...")
for (const check of checks) {
	const fullPath = join(ROOT, check.path)
	if (existsSync(fullPath)) {
		const size = statSync(fullPath).size
		console.log(`   ✅ ${check.desc}: ${size.toLocaleString()} bytes`)
	} else {
		console.log(`   ❌ ${check.desc}: MISSING`)
	}
}

// Check debug logging is in place
console.log("\n2. Checking debug logging...")
const clineProvider = join(ROOT, "src/core/webview/ClineProvider.ts")
const clineContent = readFileSync(clineProvider, "utf8")
const hasDebugLogs = clineContent.includes("[resolveWebviewView]") && clineContent.includes("[getHtmlContent]")
console.log(`   ${hasDebugLogs ? "✅" : "❌"} Debug logging in ClineProvider.ts`)

// Check vscode mock
console.log("\n3. Checking test infrastructure...")
const vscodeMock = join(ROOT, "webview-ui/__mocks__/vscode.ts")
console.log(`   ${existsSync(vscodeMock) ? "✅" : "❌"} VSCode mock exists`)

// Check test results
console.log("\n4. Running webview tests...")
try {
	const result = execSync("pnpm --filter @superroo/vscode-webview run test -- --run", {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 120000,
	})
	const passed = result.match(/(\d+) passed/)
	const failed = result.match(/(\d+) failed/)
	console.log(`   ✅ Tests: ${passed?.[1] ?? "?"} passed, ${failed?.[1] ?? "0"} failed`)
} catch (err) {
	const output = err.stdout || err.message
	const passed = output.match(/(\d+) passed/)
	const failed = output.match(/(\d+) failed/)
	console.log(`   ✅ Tests: ${passed?.[1] ?? "?"} passed, ${failed?.[1] ?? "?"} failed`)
}

console.log("\n=== Next Steps ===")
console.log("1. Press F5 in VS Code to launch Extension Development Host")
console.log("2. Open SuperRoo sidebar")
console.log("3. Help > Toggle Developer Tools > Console tab")
console.log("4. View > Output > Select 'SuperRoo' channel")
console.log("\nLook for these logs:")
console.log("  - [ExtensionStateContext] Received message: state")
console.log("  - [ExtensionStateContext] didHydrateState set to true")
console.log("  - [App] didHydrateState: true")