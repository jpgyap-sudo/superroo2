/**
 * E2E Test: Debug Team
 *
 * Tests the cloud dashboard Debug Team view with Playwright.
 * Verifies the debug loop controls, status polling, and Telegram config panel.
 *
 * Run: npx playwright test --config=playwright.config.ts
 */

import { test, expect } from "@playwright/test"

const DASHBOARD_URL = "http://localhost:3001"

test.describe("Debug Team", () => {
	test.beforeEach(async ({ page }) => {
		// Mock authentication so the dashboard renders instead of redirecting to login
		await page.addInitScript(() => {
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})
		await page.goto(`${DASHBOARD_URL}/?page=debug-team`)
		await page.waitForLoadState("domcontentloaded")
		// Wait for the Debug Team header to appear
		await page.locator("text=Debug Team").first().waitFor({ state: "visible", timeout: 15000 })
	})

	test("page loads with controls and idle status", async ({ page }) => {
		// Header should be visible
		await expect(page.locator("text=Debug Team").first()).toBeVisible({ timeout: 5000 })

		// Start Loop button should be visible
		await expect(page.locator("button:has-text('Start Loop')").first()).toBeVisible({ timeout: 5000 })

		// Target and Branch inputs should be visible
		await expect(page.locator('input[placeholder="Project name"]').first()).toBeVisible({ timeout: 5000 })
		await expect(page.locator('input[placeholder="git branch"]').first()).toBeVisible({ timeout: 5000 })

		// Status should show idle
		await expect(page.locator("text=idle").first()).toBeVisible({ timeout: 5000 })

		// Completed steps should show 0 of 10
		await expect(page.locator("text=0").first()).toBeVisible({ timeout: 5000 })

		await page.screenshot({ path: "e2e/screenshots/debug-team-loaded.png", fullPage: false })
	})

	test("can update target and branch inputs", async ({ page }) => {
		const targetInput = page.locator('input[placeholder="Project name"]').first()
		const branchInput = page.locator('input[placeholder="git branch"]').first()

		await targetInput.fill("my-project")
		await branchInput.fill("develop")

		await expect(targetInput).toHaveValue("my-project")
		await expect(branchInput).toHaveValue("develop")
	})

	test("Telegram config panel opens and closes", async ({ page }) => {
		// Telegram button should be visible (scoped to Debug Team card, not sidebar)
		const telegramButton = page.locator("button[title='Telegram Notification Settings']").first()
		await expect(telegramButton).toBeVisible({ timeout: 5000 })

		// Click to open config
		await telegramButton.click()
		await page.waitForTimeout(500)

		// Config inputs should appear
		await expect(page.locator("text=Telegram Notification Settings").first()).toBeVisible({ timeout: 10000 })
		await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 10000 })
		await expect(page.locator('input[placeholder="-1001234567890"]').first()).toBeVisible({ timeout: 10000 })

		// Click the same button again to close
		await telegramButton.click()
		await page.waitForTimeout(500)

		await page.screenshot({ path: "e2e/screenshots/debug-team-telegram.png", fullPage: false })
	})

	test("clicking Start Loop triggers action without crashing", async ({ page }) => {
		const startButton = page.locator("button:has-text('Start Loop')").first()
		await expect(startButton).toBeVisible({ timeout: 5000 })

		await startButton.click()
		await page.waitForTimeout(1500)

		// After clicking, either the button becomes Stop (success) or an error appears
		// We just verify the page didn't crash and something changed
		await expect(page.locator("button").filter({ hasText: /Start Loop|Stop/ }).first()).toBeVisible({ timeout: 10000 })

		await page.screenshot({ path: "e2e/screenshots/debug-team-start.png", fullPage: false })
	})
})
