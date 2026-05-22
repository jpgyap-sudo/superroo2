import { test, expect } from "@playwright/test"

const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://dev.abcx124.xyz/"

async function login(page: any) {
	// Register or login a test account
	const testEmail = `e2e_${Date.now()}@test.local`
	const testPassword = "TestPass123!"

	await page.goto(DASHBOARD_URL)
	await page.waitForSelector('button:has-text("Create one")', { timeout: 10000 })
	await page.click('button:has-text("Create one")')
	await page.fill('input[type="email"]', testEmail)
	await page.fill('input[type="password"]', testPassword)
	await page.fill('input[placeholder="Your name"]', "E2E Test")
	await page.click('button:has-text("Create Account")')
	await page.waitForTimeout(2000)
}

test.describe("Dashboard Tabs — Visual Crawler E2E", () => {
	test("provider-dashboard does not crash with toFixed error", async ({ page }) => {
		await login(page)
		await page.goto(`${DASHBOARD_URL}?page=provider-dashboard`)
		await page.waitForTimeout(3000)

		// Should NOT show the Next.js error boundary
		const errorBoundary = page.locator("text=Application error: a client-side exception has occurred")
		await expect(errorBoundary).not.toBeVisible()

		// Should render provider list or empty state
		await expect(page.locator("body")).toContainText(/Provider|Dashboard|No providers/, { timeout: 5000 })
	})

	// NOTE: This test will FAIL until the provider-dashboard .toFixed fix is deployed.
	// The fix is in cloud/dashboard/src/components/views/provider-dashboard.tsx

	test("visual-crawler page loads without 404 alert", async ({ page }) => {
		await login(page)
		await page.goto(`${DASHBOARD_URL}?page=visual-crawler`)
		await page.waitForTimeout(3000)

		// Should not show HTTP 404 error banner
		const errorAlert = page.locator("text=HTTP 404")
		await expect(errorAlert).not.toBeVisible()

		// Should render the visual crawler UI
		await expect(page.locator("body")).toContainText(/Visual Crawler|Run Crawl|Project/, { timeout: 5000 })
	})

	// NOTE: This test will FAIL until the visual-crawler 404 fix is deployed.
	// The fix is in cloud/dashboard/src/components/views/visual-crawler.tsx

	test("working-tree page loads successfully", async ({ page }) => {
		await login(page)
		await page.goto(`${DASHBOARD_URL}?page=working-tree`)
		await page.waitForTimeout(3000)

		const errorBoundary = page.locator("text=Application error: a client-side exception has occurred")
		await expect(errorBoundary).not.toBeVisible()
	})

	test("autonomous-loop shows unauthorized or loads correctly", async ({ page }) => {
		await login(page)
		await page.goto(`${DASHBOARD_URL}?page=autonomous-loop`)
		await page.waitForTimeout(3000)

		// It may show unauthorized for new accounts — that's acceptable
		// But it should NOT crash
		const errorBoundary = page.locator("text=Application error: a client-side exception has occurred")
		await expect(errorBoundary).not.toBeVisible()
	})

	test("all critical tabs render without Next.js crash", async ({ page }) => {
		test.setTimeout(60000)
		await login(page)

		const criticalTabs = [
			"overview",
			"working-tree",
			"jobs",
			"queue",
			"projects",
			"agents",
			"bugs",
			"skill-generator",
			"logs",
			"docker",
			"approvals",
			"api-keys",
			"settings",
			"ai",
			"model-router",
			"github",
			"ide-terminal",
			"telegram",
			"deploy",
			"auto-deploy",
			"commit-deploy",
			"intelligence-layer",
			"brain",
			"memory-explorer",
			"ml-engine",
			"product-memory",
			"task-timeline",
			"collaboration",
			"mcp-servers",
			"sandbox",
		]

		for (const tab of criticalTabs) {
			await page.goto(`${DASHBOARD_URL}?page=${tab}`)
			await page.waitForTimeout(800)

			const hasCrash = await page
				.locator("text=Application error: a client-side exception has occurred")
				.isVisible({ timeout: 1500 })
				.catch(() => false)
			expect(hasCrash, `Tab "${tab}" should not show Next.js error boundary`).toBe(false)
		}
	})
})
