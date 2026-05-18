#!/usr/bin/env node
/**
 * Install Global Git Hook for SuperRoo Cross-Project Learning Layer
 *
 * Installs a global post-commit hook that auto-extracts lessons
 * from ANY git repository and stores them in the Central Brain.
 *
 * Usage:
 *   node tools/install-global-hook.mjs
 *   node tools/install-global-hook.mjs --uninstall
 *
 * What it does:
 *   1. Creates ~/.superroo/git-hooks/ directory
 *   2. Copies the global-post-commit hook template there
 *   3. Also copies superroo-learn.mjs to ~/.superroo/bin/
 *   4. Sets git config --global core.hooksPath to ~/.superroo/git-hooks/
 *   5. Preserves any existing global hooks by migrating them
 */

import fs from "fs/promises"
import path from "path"
import { execSync } from "child_process"
import os from "os"

const HOOKS_DIR = path.join(os.homedir(), ".superroo", "git-hooks")
const BIN_DIR = path.join(os.homedir(), ".superroo", "bin")
const HOOK_FILE = path.join(HOOKS_DIR, "post-commit")
// On Windows, import.meta.url gives file:///c:/... which .pathname gives /c:/...
// Use fileURLToPath to get a proper platform-specific path
import { fileURLToPath } from "url"
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR = __dirname

async function getCurrentHooksPath() {
	try {
		const result = execSync("git config --global core.hooksPath", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		})
		return result.trim() || null
	} catch {
		return null
	}
}

async function install() {
	console.log("🔧 Installing SuperRoo Global Git Hook...\n")

	// Check current hooks path
	const currentHooksPath = await getCurrentHooksPath()
	if (currentHooksPath) {
		console.log(`   Current global hooksPath: ${currentHooksPath}`)
		if (currentHooksPath === HOOKS_DIR) {
			console.log("   ✅ Already installed. Updating hook file...")
		} else {
			console.log(`   ⚠️  A global hooksPath is already set: ${currentHooksPath}`)
			console.log("   The existing hooks will be migrated to the new location.")
		}
	} else {
		console.log("   No global hooksPath currently set.")
	}

	// Create directories
	await fs.mkdir(HOOKS_DIR, { recursive: true })
	await fs.mkdir(BIN_DIR, { recursive: true })
	console.log(`   📁 Created ${HOOKS_DIR}`)

	// Copy the hook template (Node.js version — cross-platform)
	const hookTemplate = path.resolve(TOOLS_DIR, "global-post-commit.mjs")
	const hookContent = await fs.readFile(hookTemplate, "utf-8")
	await fs.writeFile(HOOK_FILE, hookContent, { mode: 0o755 })
	console.log(`   📝 Installed post-commit hook: ${HOOK_FILE}`)

	// Copy superroo-learn CLI to ~/.superroo/bin/
	const cliSource = path.resolve(TOOLS_DIR, "superroo-learn.mjs")
	const cliDest = path.join(BIN_DIR, "superroo-learn.mjs")
	const cliContent = await fs.readFile(cliSource, "utf-8")
	await fs.writeFile(cliDest, cliContent, { mode: 0o755 })
	console.log(`   📝 Installed CLI: ${cliDest}`)

	// Also create a wrapper script for PATH (cross-platform)
	const wrapperPath = path.join(BIN_DIR, "superroo-learn")
	const isWindows = process.platform === "win32"
	let wrapperContent
	if (isWindows) {
		// Windows batch wrapper
		wrapperContent = `@echo off
node "${cliDest}" %*
`
	} else {
		// Unix shell wrapper
		wrapperContent = `#!/bin/sh
node "${cliDest}" "$@"
`
	}
	await fs.writeFile(wrapperPath, wrapperContent, { mode: 0o755 })
	console.log(`   📝 Installed wrapper: ${wrapperPath}`)

	// Migrate existing global hooks if any
	if (currentHooksPath && currentHooksPath !== HOOKS_DIR) {
		try {
			const existingFiles = await fs.readdir(currentHooksPath)
			for (const file of existingFiles) {
				const src = path.join(currentHooksPath, file)
				const dst = path.join(HOOKS_DIR, file)
				if (file !== "post-commit" || !fs.access(dst).then(() => true).catch(() => false)) {
					await fs.copyFile(src, dst)
					console.log(`   📋 Migrated existing hook: ${file}`)
				}
			}
		} catch (err) {
			console.log(`   ⚠️  Could not migrate existing hooks: ${err.message}`)
		}
	}

	// Set git config
	execSync(`git config --global core.hooksPath "${HOOKS_DIR}"`, { stdio: "inherit" })
	console.log(`   ✅ Set git config --global core.hooksPath = ${HOOKS_DIR}`)

	// Scan for repos with local hooksPath overrides that block the global hook
	console.log("\n   🔍 Scanning for repos with local hooksPath overrides...")
	try {
		const scannedDirs = [
			os.homedir(),
			path.join(os.homedir(), "superroo"),
			path.join(os.homedir(), "projects"),
			path.join(os.homedir(), "code"),
		]
		const blockedRepos = []
		for (const dir of scannedDirs) {
			try {
				const entries = await fs.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					if (!entry.isDirectory()) continue
					const gitDir = path.join(dir, entry.name, ".git")
					try {
						await fs.access(gitDir)
						const localHooks = execSync(
							`git config --local core.hooksPath`,
							{ cwd: path.join(dir, entry.name), encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
						).trim()
						if (localHooks) {
							blockedRepos.push({ repo: entry.name, path: path.join(dir, entry.name), hooksPath: localHooks })
						}
					} catch {
						// Not a git repo or no local hooksPath
					}
				}
			} catch {
				// Directory doesn't exist
			}
		}
		if (blockedRepos.length > 0) {
			console.log(`   ⚠️  Found ${blockedRepos.length} repo(s) with local hooksPath that may block the global hook:`)
			for (const r of blockedRepos) {
				console.log(`      - ${r.repo} (${r.path}) → hooksPath: ${r.hooksPath}`)
			}
			console.log("")
			console.log("   💡 To fix, run in each repo:")
			console.log('       git config --local --unset core.hooksPath')
		} else {
			console.log("   ✅ No local hooksPath overrides found.")
		}
	} catch {
		// Scan failure is non-critical
	}

	// Add ~/.superroo/bin to PATH suggestion
	console.log("\n─── Setup Complete ───")
	console.log("")
	console.log("   ✅ Global post-commit hook installed!")
	console.log("   ✅ superroo-learn CLI installed at ~/.superroo/bin/")
	console.log("")
	console.log("   📌 To add the CLI to your PATH, add this to your shell profile:")
	console.log('       export PATH="$HOME/.superroo/bin:$PATH"')
	console.log("")
	console.log("   📌 Then you can run from ANY directory:")
	console.log('       superroo-learn query "how to fix race conditions"')
	console.log('       superroo-learn store "React" "useEffect cleanup pattern"')
	console.log("       superroo-learn status")
	console.log("")
	console.log("   📌 To verify the hook works:")
	console.log('       git commit -m "fix: resolved memory leak in connection pool"')
	console.log("       # Lesson will be auto-extracted to Central Brain")
}

async function uninstall() {
	console.log("🔧 Uninstalling SuperRoo Global Git Hook...\n")

	const currentHooksPath = await getCurrentHooksPath()
	if (currentHooksPath === HOOKS_DIR) {
		// Reset hooksPath to default
		execSync("git config --global --unset core.hooksPath", { stdio: "ignore" })
		console.log("   ✅ Reset git config --global core.hooksPath to default")
	} else {
		console.log("   ⚠️  Global hooksPath was not set to SuperRoo. Skipping config reset.")
	}

	// Remove hook file
	try {
		await fs.unlink(HOOK_FILE)
		console.log(`   🗑️  Removed: ${HOOK_FILE}`)
	} catch {
		// File doesn't exist
	}

	console.log("\n   ✅ Uninstall complete.")
	console.log("   Note: ~/.superroo/bin/ and ~/.superroo/config.json were kept.")
	console.log("   To fully remove: rm -rf ~/.superroo")
}

async function main() {
	const args = process.argv.slice(2)
	if (args[0] === "--uninstall") {
		await uninstall()
	} else {
		await install()
	}
}

main().catch((err) => {
	console.error(`❌ Error: ${err.message}`)
	process.exit(1)
})
