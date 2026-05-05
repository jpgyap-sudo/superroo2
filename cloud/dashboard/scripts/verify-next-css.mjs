import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const cssDir = join(process.cwd(), ".next", "static", "css")
const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((file) => file.endsWith(".css")) : []

if (cssFiles.length === 0) {
	console.error("Dashboard build did not emit .next/static/css/*.css.")
	console.error("Refusing to deploy an unstyled dashboard. Check Tailwind/PostCSS build output.")
	process.exit(1)
}
