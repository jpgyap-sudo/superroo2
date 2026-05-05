import { cpSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

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

console.log("[prepare] Standalone preparation complete.")
