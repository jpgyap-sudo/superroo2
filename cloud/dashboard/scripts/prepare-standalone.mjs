import { cpSync, existsSync, readdirSync, mkdirSync, readlinkSync, lstatSync, unlinkSync, symlinkSync } from "node:fs"
import { join, dirname, resolve, relative } from "node:path"

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
 * to the dashboard-level pnpm store (e.g., ../../node_modules/.pnpm/next@.../node_modules/next).
 * The dashboard-level pnpm store often has an INCOMPLETE copy of next (missing files like
 * node-polyfill-crypto.js, etc.), while the ROOT pnpm store has the complete package.
 *
 * When Node.js follows the symlink to the incomplete dashboard-level store, Next.js's
 * require-hook and internal requires fail with MODULE_NOT_FOUND errors.
 *
 * The fix: Re-point the symlink from the dashboard-level pnpm store to the root pnpm store
 * which has the complete next package with all files.
 */
function repointNextSymlinkToRootStore() {
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

	// Resolve the symlink target to extract the version string
	const linkTarget = readlinkSync(standaloneNext)
	const resolvedTarget = resolve(dirname(standaloneNext), linkTarget)
	console.log(`[prepare] node_modules/next is a symlink -> ${linkTarget} (resolved: ${resolvedTarget})`)

	// Extract the pnpm store package name from the resolved path
	// e.g., .../next@14.2.3_@opentelemetry+api@1.9.0_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/next
	const pnpmDirName = dirname(dirname(resolvedTarget)) // get the .../next@14.2.3_... directory
	const pnpmStorePkg = pnpmDirName.split("/").pop() || pnpmDirName.split("\\").pop()

	// Find the complete next package in the root pnpm store
	const rootStoreNext = join(root, "..", "..", "node_modules", ".pnpm", pnpmStorePkg, "node_modules", "next")

	if (!existsSync(join(rootStoreNext, "package.json"))) {
		console.error(`[prepare] WARNING: Root pnpm store does not have complete next package at ${rootStoreNext}`)
		return false
	}

	// Verify the root store has the files that were missing from dashboard-level store
	const testFiles = ["dist/server/node-polyfill-crypto.js", "dist/server/require-hook.js"]
	for (const testFile of testFiles) {
		if (!existsSync(join(rootStoreNext, testFile))) {
			console.error(`[prepare] WARNING: Root pnpm store next package missing ${testFile}`)
			return false
		}
	}

	// Remove the old symlink
	unlinkSync(standaloneNext)
	console.log(`[prepare] Removed old symlink (pointed to dashboard-level pnpm store)`)

	// Create a new symlink pointing to the root pnpm store
	// Use a relative path from standaloneDir/node_modules to rootStoreNext
	const relPath = relative(dirname(standaloneNext), rootStoreNext)
	symlinkSync(relPath, standaloneNext, "junction")
	console.log(`[prepare] Re-pointed next symlink -> ${relPath} (root pnpm store)`)

	return true
}

// Re-point the next symlink from the incomplete dashboard-level pnpm store
// to the complete root pnpm store
repointNextSymlinkToRootStore()

console.log("[prepare] Standalone preparation complete.")
