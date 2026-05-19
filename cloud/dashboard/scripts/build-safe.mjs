/**
 * Safe dashboard build wrapper.
 *
 * Next.js 14.2.3 instantiates ESLint even when `ignoreDuringBuilds: true` is set.
 * When it finds an eslint.config.mjs (flat config / ESLint v9), it passes legacy
 * options (`useEslintrc`, `extensions`) that ESLint v9 rejects, crashing the build.
 *
 * This wrapper temporarily moves eslint.config.mjs out of the way, runs the
 * normal build pipeline, and restores the file afterwards.
 */

import { renameSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

const eslintConfig = "eslint.config.mjs"
const eslintBackup = "eslint.config.mjs.bak"

let restored = false
function restoreEslint() {
	if (restored) return
	restored = true
	if (existsSync(eslintBackup)) {
		renameSync(eslintBackup, eslintConfig)
		console.log("[build-safe] Restored eslint.config.mjs")
	}
}

// Move config aside
if (existsSync(eslintConfig)) {
	renameSync(eslintConfig, eslintBackup)
	console.log("[build-safe] Temporarily moved eslint.config.mjs out of the way")
}

// Ensure we restore on exit (success or failure)
process.on("exit", restoreEslint)
process.on("SIGINT", () => { restoreEslint(); process.exit(130) })
process.on("SIGTERM", () => { restoreEslint(); process.exit(143) })

// Run the original build pipeline
const steps = [
	["node", ["scripts/clean-next.mjs"]],
	["npx", ["next", "build"]],
	["node", ["scripts/verify-next-css.mjs"]],
	["node", ["scripts/prepare-standalone.mjs"]],
]

let exitCode = 0
for (const [cmd, args] of steps) {
	console.log(`[build-safe] Running: ${cmd} ${args.join(" ")}`)
	const result = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: true,
	})
	if (result.status !== 0) {
		exitCode = result.status || 1
		console.error(`[build-safe] Step failed: ${cmd} ${args.join(" ")}`)
		break
	}
}

restoreEslint()
process.exit(exitCode)
