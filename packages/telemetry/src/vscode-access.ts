import { createRequire } from "module"

let vscode: typeof import("vscode") | undefined
try {
	const _require = createRequire(import.meta.url)
	vscode = _require("vscode")
} catch {
	vscode = undefined
}

export { vscode }
