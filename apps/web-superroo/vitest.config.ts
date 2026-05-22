import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		environment: "node",
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			reportsDirectory: "./coverage",
		},
	},
})
