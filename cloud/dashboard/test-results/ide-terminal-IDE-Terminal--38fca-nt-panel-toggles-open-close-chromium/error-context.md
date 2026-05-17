# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ide-terminal.spec.ts >> IDE Terminal >> AI Assistant panel toggles open/close
- Location: e2e\ide-terminal.spec.ts:139:6

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - navigating to "http://localhost:3001/ide-terminal", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * E2E Visual Test: IDE Terminal
  3   |  *
  4   |  * Tests the cloud dashboard IDE Terminal view with Playwright.
  5   |  * Verifies:
  6   |  *   1. Page loads and renders the terminal
  7   |  *   2. Ctrl+V paste works in the terminal input
  8   |  *   3. AI Assistant panel toggles correctly
  9   |  *   4. Terminal command execution
  10  |  *   5. Visual regression snapshots
  11  |  *
  12  |  * Run: npx playwright test --config=playwright.config.ts
  13  |  */
  14  | 
  15  | import { test, expect } from "@playwright/test"
  16  | 
  17  | const DASHBOARD_URL = "http://localhost:3001"
  18  | 
  19  | test.describe("IDE Terminal", () => {
  20  | 	test.beforeEach(async ({ page }) => {
> 21  | 		await page.goto(`${DASHBOARD_URL}/ide-terminal`)
      |              ^ Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
  22  | 		await page.waitForLoadState("networkidle")
  23  | 	})
  24  | 
  25  | 	test("page loads and renders terminal UI", async ({ page }) => {
  26  | 		// Check the terminal header is visible
  27  | 		const terminalHeader = page.locator("text=Terminal")
  28  | 		await expect(terminalHeader).toBeVisible({ timeout: 10000 })
  29  | 
  30  | 		// Check the AI Assistant panel header
  31  | 		const aiHeader = page.locator("text=AI Assistant")
  32  | 		await expect(aiHeader).toBeVisible({ timeout: 5000 })
  33  | 
  34  | 		// Check the terminal input exists
  35  | 		const terminalInput = page.locator('input[placeholder*="command"]')
  36  | 		await expect(terminalInput).toBeVisible({ timeout: 5000 })
  37  | 
  38  | 		// Take a screenshot for visual reference
  39  | 		await page.screenshot({ path: "e2e/screenshots/ide-terminal-loaded.png", fullPage: false })
  40  | 	})
  41  | 
  42  | 	test("Ctrl+V paste works in terminal input", async ({ page }) => {
  43  | 		const terminalInput = page.locator('input[placeholder*="command"]')
  44  | 		await expect(terminalInput).toBeVisible({ timeout: 5000 })
  45  | 
  46  | 		// Focus the terminal input
  47  | 		await terminalInput.click()
  48  | 
  49  | 		// Simulate Ctrl+V paste with clipboard data
  50  | 		const pastedText = "npm run build"
  51  | 		await page.evaluate(
  52  | 			({ text }) => {
  53  | 				const input = document.querySelector('input[placeholder*="command"]') as HTMLInputElement
  54  | 				if (!input) throw new Error("Terminal input not found")
  55  | 
  56  | 				// Create a clipboard event with text data
  57  | 				const event = new ClipboardEvent("paste", {
  58  | 					bubbles: true,
  59  | 					cancelable: true,
  60  | 					clipboardData: new DataTransfer(),
  61  | 				})
  62  | 				Object.defineProperty(event, "clipboardData", {
  63  | 					value: {
  64  | 						items: [{ type: "text/plain" }],
  65  | 						getData: (type: string) => (type === "text" ? text : ""),
  66  | 						types: ["text/plain"],
  67  | 					},
  68  | 					writable: false,
  69  | 				})
  70  | 
  71  | 				// Focus the input and dispatch paste
  72  | 				input.focus()
  73  | 				input.dispatchEvent(event)
  74  | 			},
  75  | 			{ text: pastedText },
  76  | 		)
  77  | 
  78  | 		// Wait for React state to update
  79  | 		await page.waitForTimeout(100)
  80  | 
  81  | 		// Verify the pasted text appears in the input
  82  | 		const inputValue = await terminalInput.inputValue()
  83  | 		expect(inputValue).toBe(pastedText)
  84  | 
  85  | 		// Take screenshot showing pasted content
  86  | 		await page.screenshot({ path: "e2e/screenshots/ide-terminal-paste.png", fullPage: false })
  87  | 	})
  88  | 
  89  | 	test("Ctrl+V paste works when terminal is focused (not AI textarea)", async ({ page }) => {
  90  | 		const terminalInput = page.locator('input[placeholder*="command"]')
  91  | 		await expect(terminalInput).toBeVisible({ timeout: 5000 })
  92  | 
  93  | 		// First focus the AI textarea to verify paste doesn't go there
  94  | 		const aiTextarea = page.locator("textarea")
  95  | 		if (await aiTextarea.isVisible()) {
  96  | 			await aiTextarea.click()
  97  | 			await page.waitForTimeout(50)
  98  | 		}
  99  | 
  100 | 		// Now focus the terminal input
  101 | 		await terminalInput.click()
  102 | 		await page.waitForTimeout(50)
  103 | 
  104 | 		// Verify terminal input is the active element
  105 | 		const isTerminalFocused = await page.evaluate(() => {
  106 | 			const input = document.querySelector('input[placeholder*="command"]')
  107 | 			return document.activeElement === input
  108 | 		})
  109 | 		expect(isTerminalFocused).toBe(true)
  110 | 
  111 | 		// Paste text via Ctrl+V
  112 | 		await page.evaluate(() => {
  113 | 			const input = document.querySelector('input[placeholder*="command"]') as HTMLInputElement
  114 | 			if (!input) throw new Error("Terminal input not found")
  115 | 
  116 | 			const event = new ClipboardEvent("paste", {
  117 | 				bubbles: true,
  118 | 				cancelable: true,
  119 | 			})
  120 | 			Object.defineProperty(event, "clipboardData", {
  121 | 				value: {
```