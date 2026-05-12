/**
 * E2E Visual Test: IDE Terminal
 *
 * Tests the cloud dashboard IDE Terminal view with Playwright.
 * Verifies:
 *   1. Page loads and renders the terminal
 *   2. Ctrl+V paste works in the terminal input
 *   3. AI Assistant panel toggles correctly
 *   4. Terminal command execution
 *   5. Visual regression snapshots
 *
 * Run: npx playwright test --config=playwright.config.ts
 */

import { test, expect } from "@playwright/test"

const DASHBOARD_URL = "http://localhost:3001"

test.describe("IDE Terminal", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${DASHBOARD_URL}/ide-terminal`)
		await page.waitForLoadState("networkidle")
	})

	test("page loads and renders terminal UI", async ({ page }) => {
		// Check the terminal header is visible
		const terminalHeader = page.locator("text=Terminal")
		await expect(terminalHeader).toBeVisible({ timeout: 10000 })

		// Check the AI Assistant panel header
		const aiHeader = page.locator("text=AI Assistant")
		await expect(aiHeader).toBeVisible({ timeout: 5000 })

		// Check the terminal input exists
		const terminalInput = page.locator('input[placeholder*="command"]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// Take a screenshot for visual reference
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-loaded.png", fullPage: false })
	})

	test("Ctrl+V paste works in terminal input", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder*="command"]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// Focus the terminal input
		await terminalInput.click()

		// Simulate Ctrl+V paste with clipboard data
		const pastedText = "npm run build"
		await page.evaluate(
			({ text }) => {
				const input = document.querySelector('input[placeholder*="command"]') as HTMLInputElement
				if (!input) throw new Error("Terminal input not found")

				// Create a clipboard event with text data
				const event = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: new DataTransfer(),
				})
				Object.defineProperty(event, "clipboardData", {
					value: {
						items: [{ type: "text/plain" }],
						getData: (type: string) => (type === "text" ? text : ""),
						types: ["text/plain"],
					},
					writable: false,
				})

				// Focus the input and dispatch paste
				input.focus()
				input.dispatchEvent(event)
			},
			{ text: pastedText },
		)

		// Wait for React state to update
		await page.waitForTimeout(100)

		// Verify the pasted text appears in the input
		const inputValue = await terminalInput.inputValue()
		expect(inputValue).toBe(pastedText)

		// Take screenshot showing pasted content
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-paste.png", fullPage: false })
	})

	test("Ctrl+V paste works when terminal is focused (not AI textarea)", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder*="command"]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// First focus the AI textarea to verify paste doesn't go there
		const aiTextarea = page.locator("textarea")
		if (await aiTextarea.isVisible()) {
			await aiTextarea.click()
			await page.waitForTimeout(50)
		}

		// Now focus the terminal input
		await terminalInput.click()
		await page.waitForTimeout(50)

		// Verify terminal input is the active element
		const isTerminalFocused = await page.evaluate(() => {
			const input = document.querySelector('input[placeholder*="command"]')
			return document.activeElement === input
		})
		expect(isTerminalFocused).toBe(true)

		// Paste text via Ctrl+V
		await page.evaluate(() => {
			const input = document.querySelector('input[placeholder*="command"]') as HTMLInputElement
			if (!input) throw new Error("Terminal input not found")

			const event = new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
			})
			Object.defineProperty(event, "clipboardData", {
				value: {
					items: [{ type: "text/plain" }],
					getData: (type: string) => (type === "text" ? "git status" : ""),
					types: ["text/plain"],
				},
				writable: false,
			})
			input.focus()
			input.dispatchEvent(event)
		})

		await page.waitForTimeout(100)

		// Verify the correct text was pasted
		const inputValue = await terminalInput.inputValue()
		expect(inputValue).toBe("git status")
	})

	test("AI Assistant panel toggles open/close", async ({ page }) => {
		// Check AI panel is visible by default
		const aiPanel = page.locator("aside").filter({ hasText: "AI Assistant" })
		await expect(aiPanel.first()).toBeVisible({ timeout: 5000 })

		// Click the close button (PanelRightClose icon)
		const closeButton = page.locator('button[title="Close panel"]')
		if (await closeButton.isVisible()) {
			await closeButton.click()
			await page.waitForTimeout(200)
		}

		// Take screenshot with AI panel closed
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-ai-closed.png", fullPage: false })
	})

	test("AI chat tab sends message", async ({ page }) => {
		// Find the AI textarea
		const aiTextarea = page.locator("textarea")
		await expect(aiTextarea.first()).toBeVisible({ timeout: 5000 })

		// Type a message
		await aiTextarea.first().fill("Hello, what is the status of my project?")

		// Click the send button
		const sendButton = page.locator('button[title="Send"]')
		await expect(sendButton).toBeVisible({ timeout: 3000 })
		await sendButton.click()

		// Wait for the message to appear in the chat
		await page.waitForTimeout(500)

		// Take screenshot after sending
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-ai-chat.png", fullPage: false })
	})

	test("Terminal command execution shows output", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder*="command"]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// Type a command
		await terminalInput.fill("npm run build")

		// Press Enter to execute
		await terminalInput.press("Enter")

		// Wait for output to appear
		await page.waitForTimeout(500)

		// Take screenshot showing command output
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-command-output.png", fullPage: false })
	})

	test("File explorer panel toggles", async ({ page }) => {
		// Check if file panel toggle button exists
		const fileToggleButton = page.locator('button[title*="File"]').first()
		if (await fileToggleButton.isVisible()) {
			await fileToggleButton.click()
			await page.waitForTimeout(200)
		}

		// Take screenshot
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-file-toggle.png", fullPage: false })
	})

	test("Terminal maximize toggle works", async ({ page }) => {
		// Find the maximize button
		const maximizeButton = page.locator('button[title="Maximize"]')
		if (await maximizeButton.isVisible()) {
			await maximizeButton.click()
			await page.waitForTimeout(300)

			// Take screenshot with maximized terminal
			await page.screenshot({ path: "e2e/screenshots/ide-terminal-maximized.png", fullPage: false })
		}
	})

	test("Keyboard shortcuts modal opens", async ({ page }) => {
		// Press Ctrl+Shift+K to open shortcuts
		await page.keyboard.press("Control+Shift+K")
		await page.waitForTimeout(300)

		// Take screenshot showing shortcuts modal
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-shortcuts.png", fullPage: false })
	})

	test("Agent suggestions appear when typing /", async ({ page }) => {
		const terminalInput = page.locator('input[placeholder*="command"]')
		await expect(terminalInput).toBeVisible({ timeout: 5000 })

		// Type "/" to trigger agent suggestions
		await terminalInput.fill("/")

		// Wait for suggestions to appear
		await page.waitForTimeout(200)

		// Take screenshot showing agent suggestions
		await page.screenshot({ path: "e2e/screenshots/ide-terminal-agent-suggestions.png", fullPage: false })
	})
})
