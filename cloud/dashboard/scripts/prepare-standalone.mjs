import { cpSync, existsSync, readdirSync, mkdirSync, readlinkSync, lstatSync, unlinkSync } from "node:fs"
import { join, dirname, resolve } from "node:path"

const root = process.cwd()
const standaloneDir = join(root, ".next", "standalone")
const serverJs = join(standaloneDir, "server.js")

// Next.js 14.2 outputs standalone at .next/standalone/server.js (relative to dashboard dir)
// NOT at .next/standalone/cloud/dashboard/server.js
if (!existsSync(serverJs)) {
	console.error("Dashboard standalone server was not emitted at .next/standalone/server.js")
	process.exit(1)
}

console.log(`[prepare] Found standalone server at ${serverJs}`)

// Copy ALL of .next/static into the standalone output
const srcStatic = join(root, ".next", "static")
const destStatic = join(standaloneDir, ".next", "static")
console.log(`[prepare] Copying ${srcStatic} -> ${destStatic}`)
cpSync(srcStatic, destStatic, { force: true, recursive: true })

// Verify the copy — check that CSS and JS files exist in the destination
const cssDir = join(destStatic, "css")
const chunksDir = join(destStatic, "chunks")

const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith(".css")) : []
const chunkFiles = existsSync(chunksDir) ? readdirSync(chunksDir).filter((f) => f.endsWith(".js")) : []

console.log(`[prepare] CSS files in standalone: ${cssFiles.length}`)
console.log(`[prepare] JS chunks in standalone: ${chunkFiles.length}`)

if (cssFiles.length === 0) {
	console.error("[prepare] ERROR: No CSS files found in standalone output after copy!")
	process.exit(1)
}

if (chunkFiles.length === 0) {
	console.error("[prepare] ERROR: No JS chunk files found in standalone output after copy!")
	process.exit(1)
}

// Also copy build manifest files (e.g., _buildManifest.js, _ssgManifest.js)
const destEntries = existsSync(destStatic) ? readdirSync(destStatic) : []
const buildIdDir = destEntries.find((f) => f.startsWith("Vn_") || f.length > 10)
if (buildIdDir) {
	const fullBuildIdDir = join(destStatic, buildIdDir)
	const destBuildIdDir = join(standaloneDir, ".next", buildIdDir)
	if (!existsSync(destBuildIdDir)) {
		cpSync(fullBuildIdDir, destBuildIdDir, { force: true, recursive: true })
		console.log(`[prepare] Copied build manifest: ${buildIdDir}`)
	}
}

const publicDir = join(root, "public")
if (existsSync(publicDir)) {
	console.log(`[prepare] Copying public/ -> ${join(standaloneDir, "public")}`)
	cpSync(publicDir, join(standaloneDir, "public"), { force: true, recursive: true })
}

/**
 * Resolve the real (non-symlink) path of a pnpm store package.
 * pnpm uses symlinks in node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>.
 * We need to resolve through the symlink to get the actual package files.
 * Checks that package.json exists to avoid incomplete pnpm store entries.
 */
function resolvePnpmStorePath(packageName, version) {
	const candidates = [
		// Try workspace root pnpm store first (has complete packages)
		join(root, "..", "..", "node_modules", ".pnpm", `${packageName}@${version}`, "node_modules", packageName),
		// Fall back to dashboard-level pnpm store
		join(root, "node_modules", ".pnpm", `${packageName}@${version}`, "node_modules", packageName),
	]

	for (const candidate of candidates) {
		if (existsSync(join(candidate, "package.json"))) {
			return candidate
		}
	}
	return null
}

/**
 * Copy a package from the pnpm store into the standalone output.
 * Next.js standalone output in pnpm monorepos often misses transitive deps like
 * styled-jsx and react-dom. This helper resolves the pnpm store path and copies
 * the real package directory into the standalone node_modules.
 */
function copyPnpmPackage(packageName, version) {
	const srcPkg = resolvePnpmStorePath(packageName, version)
	const destPkg = join(standaloneDir, "node_modules", packageName)

	if (!srcPkg) {
		console.error(`[prepare] WARNING: Cannot find ${packageName}@${version} in any pnpm store`)
		return false
	}

	if (existsSync(destPkg)) {
		console.log(`[prepare] ${packageName} already exists in standalone, skipping`)
		return true
	}

	mkdirSync(dirname(destPkg), { recursive: true })
	cpSync(srcPkg, destPkg, { force: true, recursive: true })
	console.log(`[prepare] Copied ${packageName}@${version} -> standalone node_modules (from ${srcPkg})`)
	return true
}

// Copy missing transitive dependencies that Next.js standalone output doesn't include
// in pnpm monorepo setups. These are required at runtime by the Next.js server.
copyPnpmPackage("styled-jsx", "5.1.1_react@18.3.1")
copyPnpmPackage("react-dom", "18.3.1_react@18.3.1")

/**
 * In pnpm monorepos, Next.js standalone output has node_modules/next as a symlink
 * to the pnpm store (e.g., ../../node_modules/.pnpm/next@14.2.3_.../node_modules/next).
 * When Node.js follows this symlink, Next.js's require-hook.js runs from the pnpm store
 * path and resolves styled-jsx relative to the pnpm store, NOT the standalone node_modules.
 *
 * This causes: "Cannot find module 'styled-jsx/package.json'" even when styled-jsx
 * is present in standalone node_modules.
 *
 * The fix: Break the symlink and copy the real next package into standalone node_modules.
 */
function resolveNextPnpmStorePath() {
	const standaloneNext = join(standaloneDir, "node_modules", "next")
	if (!existsSync(standaloneNext)) {
		console.error("[prepare] WARNING: node_modules/next not found in standalone output")
		return false
	}

	// Check if it's a symlink
	let stats
	try {
		stats = lstatSync(standaloneNext)
	} catch {
		return false
	}

	if (!stats.isSymbolicLink()) {
		console.log("[prepare] node_modules/next is not a symlink, no fix needed")
		return true
	}

	// Resolve the symlink target
	const linkTarget = readlinkSync(standaloneNext)
	const resolvedTarget = resolve(dirname(standaloneNext), linkTarget)
	console.log(`[prepare] node_modules/next is a symlink -> ${linkTarget} (resolved: ${resolvedTarget})`)

	// Verify the target exists and has package.json
	if (!existsSync(join(resolvedTarget, "package.json"))) {
		console.error(`[prepare] WARNING: Symlink target ${resolvedTarget} has no package.json`)
		return false
	}

	// Remove the symlink
	unlinkSync(standaloneNext)
	console.log("[prepare] Removed symlink node_modules/next")

	// Copy the real next package from the resolved target
	cpSync(resolvedTarget, standaloneNext, { force: true, recursive: true })
	console.log(`[prepare] Copied real next package from ${resolvedTarget} -> node_modules/next`)

	return true
}

// Break the next symlink so require-hook resolves styled-jsx from standalone node_modules
resolveNextPnpmStorePath()

console.log("[prepare] Standalone preparation complete.")
