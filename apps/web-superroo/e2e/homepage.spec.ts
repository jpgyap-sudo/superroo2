import { test, expect } from "@playwright/test"

test.describe("Homepage", () => {
	test("loads with correct title and hero section", async ({ page }) => {
		await page.goto("/")
		await expect(page).toHaveTitle(/SuperRoo/)
		await expect(page.locator("text=SuperRoo").first()).toBeVisible({ timeout: 10000 })
	})

	test("navigation links are visible", async ({ page }) => {
		await page.goto("/")
		await expect(page.locator("nav").first()).toBeVisible({ timeout: 10000 })
	})

	test("blog page loads", async ({ page }) => {
		await page.goto("/blog")
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 })
	})
})
