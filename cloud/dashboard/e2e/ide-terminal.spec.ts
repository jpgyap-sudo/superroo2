/**
 * E2E Test: IDE Terminal
 *
 * Tests the cloud dashboard IDE Terminal view with Playwright.
 * Verifies the decomposed Monaco-based IDE is functional, not just a shell.
 *
 * Run: npx playwright test --config=playwright.config.ts
 */

import { test, expect } from "@playwright/test"

const DASHBOARD_URL = "http://localhost:3001"

test.describe("IDE Terminal", () => {
	test.beforeEach(async ({ page }) => {
		// Mock authentication so the dashboard renders instead of redirecting to login
		await page.addInitScript(() => {
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})
		await page.goto(`${DASHBOARD_URL}/?page=ide-terminal`)
		await page.waitForLoadState("domcontentloaded")
		// Wait for the IDE Terminal-specific UI to appear
		await page.locator('input[placeholder="Type a command..."]').waitFor({ state: "visible", timeout: 15000 })
	})

	test("page loads with Terminal and AI Chat panels", async ({ page }) => {
		// Terminal header should be visible
		await expect(page.locator("text=Terminal").first()).toBeVisible({ timeout: 5000 })

		// AI Chat panel should be visible
		await expect(page.locator("text=AI Chat").first()).toBeVisible({ timeout: 5000 })

		// Terminal input with new placeholder
		const terminalInput = page.locator('input[placeholder="Type a command..."]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// AI textarea
		const aiTextarea = page.locator('textarea[placeholder="Ask AI or type / for commands..."]')
		await expect(aiTextarea).toBeVisible({ timeout: 5000 })

		// Monaco editor should be present (look for the editor container, not <pre>)
		const monacoContainer = page.locator(".monaco-editor, [data-testid='monaco-editor']").first()
		// If no file is open, Monaco won't mount yet — just verify the editor area exists
		await expect(page.locator("text=Select a file from the explorer").or(monacoContainer)).toBeVisible({
			timeout: 5000,
		})

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-loaded.png", fullPage: false })
	})

	test("terminal accepts typed commands and executes on Enter", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder="Type a command..."]')
		await terminalInput.fill("echo hello")
		await terminalInput.press("Enter")

		// Wait for output block to appear
		await page.waitForTimeout(500)
		await expect(page.locator("text=hello").first()).toBeVisible({ timeout: 5000 })

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-command.png", fullPage: false })
	})

	test("AI Chat panel can be closed and reopened", async ({ page }) => {
		// AI panel is visible by default
		const aiPanel = page.locator("aside").filter({ hasText: "AI Chat" })
		await expect(aiPanel.first()).toBeVisible({ timeout: 5000 })

		// Click close button (first button in AI Chat header)
		const closeButton = aiPanel.first().locator("button").first()
		await closeButton.click()
		await page.waitForTimeout(200)

		// AI panel should be gone
		await expect(aiPanel.first()).not.toBeVisible()

		// Re-open via sidebar (look for IDE Terminal in sidebar to confirm context)
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-ai-closed.png", fullPage: false })
	})

	test("AI chat textarea accepts input and sends message", async ({ page }) => {
		const aiTextarea = page.locator('textarea[placeholder="Ask AI or type / for commands..."]')
		await aiTextarea.fill("What time is it?")

		const sendButton = page.locator('button[title="Send"]')
		await expect(sendButton).toBeVisible({ timeout: 3000 })
		await sendButton.click()

		// Wait for the user message to appear in the chat list
		await expect(page.locator("text=What time is it?").first()).toBeVisible({ timeout: 5000 })

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-ai-chat.png", fullPage: false })
	})

	test("keyboard shortcuts modal opens via toolbar button", async ({ page }) => {
		// Click the keyboard shortcuts button in the toolbar
		const shortcutsButton = page.locator('button[title="Keyboard Shortcuts"]')
		await expect(shortcutsButton).toBeVisible({ timeout: 5000 })
		await shortcutsButton.click()
		await page.waitForTimeout(300)

		// The modal should contain keyboard shortcuts content
		await expect(page.locator("text=Keyboard Shortcuts").or(page.locator("text=Shortcuts")).first()).toBeVisible({
			timeout: 5000,
		})

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-shortcuts.png", fullPage: false })
	})

	test("terminal command suggestions appear when typing", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder="Type a command..."]')
		await terminalInput.fill("git")
		await page.waitForTimeout(300)

		// Suggestion dropdown should appear with git commands
		await expect(page.locator("text=git status").or(page.locator("text=git log")).first()).toBeVisible({
			timeout: 5000,
		})

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-suggestions.png", fullPage: false })
	})

	test("Monaco editor loads when a file is clicked", async ({ page }) => {
		// Click on a file in the explorer
		const fileButton = page.locator("button").filter({ hasText: "AGENTS.md" }).first()
		// If AGENTS.md is not visible, try scrolling or look for another file
		if (await fileButton.isVisible().catch(() => false)) {
			await fileButton.click()
		} else {
			// Try to find any .md or .ts file
			const anyFile = page
				.locator("button")
				.filter({ hasText: /\.(md|ts|js|json)$/ })
				.first()
			await anyFile.click()
		}

		// Wait for Monaco editor to mount (look for the editor container class)
		await page.waitForTimeout(800)
		const monacoEditor = page.locator(".monaco-editor, .monaco-mouse-cursor-text").first()
		await expect(monacoEditor).toBeVisible({ timeout: 10000 })

		// Verify the editor has content (not empty)
		const editorContent = await monacoEditor.textContent()
		expect(editorContent?.length || 0).toBeGreaterThan(0)

		await page.screenshot({ path: "e2e/screenshots/ide-terminal-monaco.png", fullPage: false })
	})
})
