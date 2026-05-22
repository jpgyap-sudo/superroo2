import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		watch: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			reportsDirectory: "./coverage",
		},
	},
})
