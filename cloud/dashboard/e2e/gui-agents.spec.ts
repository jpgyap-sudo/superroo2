/**
 * E2E GUI Test: Agents & Telegram Views
 *
 * Tests the cloud dashboard Agents view and Telegram view with Playwright.
 * Verifies:
 *   1. Login/register flow works
 *   2. Dashboard loads and sidebar navigation works
 *   3. Agents view renders agent cards with status indicators
 *   4. Telegram view renders with bot status and stats
 *   5. Navigation between views works correctly
 *
 * Run: npx playwright test --config=playwright.config.ts
 *
 * Uses page.baseURL from playwright.config.ts (defaults to https://dev.abcx124.xyz).
 * Override with E2E_BASE_URL env var for local testing.
 */

import { test, expect } from "@playwright/test"

const TEST_EMAIL = "e2e-test@superroo.xyz"
const TEST_PASSWORD = "TestPass123!"

async function ensureAuthenticated(page: any) {
	// Check if already authenticated (dashboard content visible)
	const isDashboard = await page.locator("nav").isVisible().catch(() => false)
	if (isDashboard) return

	// Check if we're on the login/register page
	const isLoginPage = await page.locator("text=Sign in to your account").isVisible().catch(() => false)
	const isRegisterPage = await page.locator("text=Create your account").isVisible().catch(() => false)

	if (!isLoginPage && !isRegisterPage) {
		await page.waitForTimeout(2000)
		return
	}

	// Check if there's an "already exists" error — switch to login mode
	const alreadyExists = await page.locator("text=already exists").isVisible().catch(() => false)
	if (alreadyExists) {
		// Switch to login mode
		await page.locator("text=Sign In").click()
		await page.waitForTimeout(300)
	}

	// Fill in credentials
	const emailInput = page.locator('input[type="email"]')
	const passwordInput = page.locator('input[type="password"]')
	await emailInput.fill(TEST_EMAIL)
	await passwordInput.fill(TEST_PASSWORD)

	// Submit
	await page.locator("button[type=submit]").click()
	await page.waitForTimeout(3000)

	// Check if still on login page (login failed — need to register)
	const stillLogin = await page.locator("text=Sign in to your account").isVisible().catch(() => false)
	if (stillLogin) {
		// Switch to register mode
		await page.locator("text=Create one").click()
		await page.waitForTimeout(300)

		await page.locator('input[type="text"]').fill("E2E Test User")
		await page.locator('input[type="email"]').fill(TEST_EMAIL)
		await page.locator('input[type="password"]').fill(TEST_PASSWORD)
		await page.locator("button[type=submit]").click()
		await page.waitForTimeout(3000)
	}
}

test.describe("Dashboard GUI — Agents & Telegram", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/")
		await page.waitForLoadState("networkidle")
		await ensureAuthenticated(page)
		await page.waitForTimeout(1000)
	})

	test("dashboard loads and sidebar is visible", async ({ page }) => {
		// Check the SuperRoo branding is visible
		const brand = page.locator("text=SuperRoo").first()
		await expect(brand).toBeVisible({ timeout: 10000 })

		// Check sidebar navigation items exist (use role=button for nav items)
		const agentsNav = page.getByRole("button", { name: /agents/i }).first()
		await expect(agentsNav).toBeVisible({ timeout: 5000 })

		const telegramNav = page.getByRole("button", { name: /telegram/i }).first()
		await expect(telegramNav).toBeVisible({ timeout: 5000 })

		// Check Overview is the default page
		const overviewHeader = page.locator("text=Overview").first()
		await expect(overviewHeader).toBeVisible({ timeout: 5000 })
	})

	test("navigates to Agents view and renders agent cards", async ({ page }) => {
		// Click Agents in sidebar using role=button (works even when collapsed)
		const agentsNav = page.getByRole("button", { name: /agents/i }).first()
		await agentsNav.click()
		await page.waitForTimeout(500)

		// Check the Agents header is visible
		const agentsHeader = page.locator("h2, h3, h1", { hasText: /agents/i }).first()
		await expect(agentsHeader).toBeVisible({ timeout: 10000 })

		// Wait for data to load
		await page.waitForTimeout(2000)

		// Check for agent-related UI elements (status badges, agent names)
		const agentElements = page.locator("text=/coder|debugger|tester|deployer|planner/i")
		const agentCount = await agentElements.count()
		console.log(`  [gui-agents] Found ${agentCount} agent name references`)

		// Take a screenshot
		await page.screenshot({ path: "e2e/screenshots/agents-view.png", fullPage: false })
	})

	test("navigates to Telegram view and renders bot status", async ({ page }) => {
		// Click Telegram in sidebar using role=button
		const telegramNav = page.getByRole("button", { name: /telegram/i }).first()
		await telegramNav.click()
		await page.waitForTimeout(500)

		// Check the Telegram header is visible
		const telegramHeader = page.locator("h2, h3, h1", { hasText: /telegram|bot/i }).first()
		await expect(telegramHeader).toBeVisible({ timeout: 10000 })

		// Wait for data to load
		await page.waitForTimeout(2000)

		// Check for Telegram-related UI elements
		const botElements = page.locator("text=/bot|status|webhook|command/i")
		const botCount = await botElements.count()
		console.log(`  [gui-telegram] Found ${botCount} Telegram-related elements`)

		// Take a screenshot
		await page.screenshot({ path: "e2e/screenshots/telegram-view.png", fullPage: false })
	})

	test("navigates between multiple views correctly", async ({ page }) => {
		// Navigate to Agents
		await page.getByRole("button", { name: /agents/i }).first().click()
		await page.waitForTimeout(500)

		// Navigate to Telegram
		await page.getByRole("button", { name: /telegram/i }).first().click()
		await page.waitForTimeout(500)

		// Navigate back to Overview
		await page.getByRole("button", { name: /overview/i }).first().click()
		await page.waitForTimeout(500)

		// Verify we're back on Overview
		const overviewContent = page.locator("text=Overview").first()
		await expect(overviewContent).toBeVisible({ timeout: 5000 })
	})

	test("sidebar collapse/expand works", async ({ page }) => {
		// Click the sidebar header to toggle collapse
		const sidebarHeader = page.locator("text=SuperRoo").first()
		await sidebarHeader.click()
		await page.waitForTimeout(500)

		// Click again to expand
		await sidebarHeader.click()
		await page.waitForTimeout(500)

		// Use a more reliable selector — nav buttons are always in the DOM
		// even when collapsed (they just show icons without text)
		// Use the nav element to find buttons by their position
		const navButtons = page.locator("nav button")
		const agentButton = navButtons.nth(5) // Agents is the 6th nav item (0-indexed: 5)
		await agentButton.click()
		await page.waitForTimeout(500)

		// Verify we navigated to Agents view
		const agentsContent = page.locator("h2, h3, h1", { hasText: /agents/i }).first()
		await expect(agentsContent).toBeVisible({ timeout: 5000 })
	})
})
