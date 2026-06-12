// Browser-safe vscode access - vscode is only available in extension host context
// In webview context, this will be undefined
let vscode: typeof import("vscode") | undefined

// Only try to load vscode in Node.js context (extension host)
if (typeof window === "undefined" && typeof process !== "undefined" && process.versions?.node) {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		vscode = require("vscode")
	} catch {
		vscode = undefined
	}
}

export { vscode }
