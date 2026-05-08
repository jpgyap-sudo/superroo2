import { cpSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

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
 * Copy a package from the pnpm store (node_modules/.pnpm) into the standalone output.
 * Next.js standalone output in pnpm monorepos often misses transitive deps like
 * styled-jsx and react-dom. This helper resolves the pnpm store symlink and copies
 * the real package directory into the standalone node_modules.
 */
function copyPnpmPackage(packageName, version) {
	const pnpmDir = join(root, "node_modules", ".pnpm")
	const pkgDirName = `${packageName}@${version}`
	const srcPkg = join(pnpmDir, pkgDirName, "node_modules", packageName)
	const destPkg = join(standaloneDir, "node_modules", packageName)

	if (!existsSync(srcPkg)) {
		console.error(`[prepare] WARNING: Cannot find ${packageName}@${version} in pnpm store at ${srcPkg}`)
		return false
	}

	if (existsSync(destPkg)) {
		console.log(`[prepare] ${packageName} already exists in standalone, skipping`)
		return true
	}

	mkdirSync(dirname(destPkg), { recursive: true })
	cpSync(srcPkg, destPkg, { force: true, recursive: true })
	console.log(`[prepare] Copied ${packageName}@${version} -> standalone node_modules`)
	return true
}

// Copy missing transitive dependencies that Next.js standalone output doesn't include
// in pnpm monorepo setups. These are required at runtime by the Next.js server.
copyPnpmPackage("styled-jsx", "5.1.1_react@18.3.1")
copyPnpmPackage("react-dom", "18.3.1_react@18.3.1")

console.log("[prepare] Standalone preparation complete.")
