/**
 * Load the built terminal-core runtime from either an installed package or the
 * local monorepo build output. The cloud package sits outside the pnpm workspace
 * graph in this repo, so the fallback keeps local execution honest without
 * importing raw TypeScript source.
 */
function loadTerminalCore() {
	try {
		return require("@superroo/terminal-core")
	} catch {
		return require("../../../packages/terminal-core/dist/index.cjs")
	}
}

module.exports = { loadTerminalCore }
