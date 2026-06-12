import { defineConfig, defaultExclude } from "vitest/config"

// Root-level vitest invocations (e.g. `npx vitest run src/core/...` from the
// repo root) previously fell back to built-in defaults, which (a) scanned the
// stale Kilo agent worktrees under .kilo/worktrees/* and (b) ran package specs
// without their package config (no globals, no vscode alias). The projects list
// routes every root-cwd run through the owning package's own vitest config;
// anything outside a listed project — including worktrees — is never scanned.
export default defineConfig({
	test: {
		exclude: [...defaultExclude, "**/.kilo/worktrees/**", "**/worktrees/**"],
		projects: [
			"src/vitest.config.ts",
			"webview-ui/vitest.config.ts",
			"cloud/vitest.config.ts",
			"apps/cli/vitest.config.ts",
			"apps/web-evals/vitest.config.ts",
			"apps/web-superroo/vitest.config.ts",
			"packages/build/vitest.config.ts",
			"packages/cloud/vitest.config.ts",
			"packages/core/vitest.config.ts",
			"packages/evals/vitest.config.ts",
			"packages/telemetry/vitest.config.ts",
			"packages/types/vitest.config.ts",
			"packages/vscode-shim/vitest.config.ts",
		],
	},
})
