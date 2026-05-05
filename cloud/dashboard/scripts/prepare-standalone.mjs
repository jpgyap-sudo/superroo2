import { cpSync, existsSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()
const standaloneDir = join(root, ".next", "standalone")
const appStandaloneDir = join(standaloneDir, "cloud", "dashboard")

if (!existsSync(appStandaloneDir)) {
	console.error("Dashboard standalone server was not emitted at .next/standalone.")
	process.exit(1)
}

// Copy ALL of .next/static into the standalone output
const srcStatic = join(root, ".next", "static")
const destStatic = join(appStandaloneDir, ".next", "static")
console.log(`[prepare] Copying ${srcStatic} -> ${destStatic}`)
cpSync(srcStatic, destStatic, { force: true, recursive: true })

// Verify the copy — check that CSS and JS files exist in the destination
const cssDir = join(destStatic, "css")
const chunksDir = join(destStatic, "chunks")
const buildIdDir = join(destStatic, readdirSync(destStatic).find((f) => f.startsWith("Vn_") || f.length > 10) || "")

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
if (buildIdDir && existsSync(buildIdDir)) {
	const destBuildIdDir = join(destStatic, relative(srcStatic, buildIdDir))
	if (!existsSync(destBuildIdDir)) {
		cpSync(buildIdDir, destBuildIdDir, { force: true, recursive: true })
		console.log(`[prepare] Copied build manifest: ${relative(srcStatic, buildIdDir)}`)
	}
}

const publicDir = join(root, "public")
if (existsSync(publicDir)) {
	console.log(`[prepare] Copying public/ -> ${join(appStandaloneDir, "public")}`)
	cpSync(publicDir, join(appStandaloneDir, "public"), { force: true, recursive: true })
}

console.log("[prepare] Standalone preparation complete.")
