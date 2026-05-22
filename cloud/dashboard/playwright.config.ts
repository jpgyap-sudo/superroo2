import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { outputFolder: "e2e-report" }], ["list"]],
	use: {
		baseURL: "http://localhost:3001",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "npx next dev -p 3001",
		url: "http://localhost:3001",
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},
})
