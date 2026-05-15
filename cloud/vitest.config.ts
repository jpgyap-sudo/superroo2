import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"api/__tests__/test-telegram-policy.test.js",
			"api/__tests__/test-telegram-engineer.test.js",
			"api/__tests__/test-telegram-classifier.test.js",
		],
	},
})
