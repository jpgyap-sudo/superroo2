import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/components/ui/__tests__/**/*.test.ts", "src/components/ui/__tests__/**/*.test.tsx"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
})
