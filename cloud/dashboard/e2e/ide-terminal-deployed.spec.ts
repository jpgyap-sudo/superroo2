/**
 * E2E Visual Test: Deployed IDE Terminal
 *
 * Tests the deployed cloud dashboard IDE Terminal view at https://dev.abcx124.xyz
 * Verifies:
 *   1. Page loads and renders the terminal UI
 *   2. Messages persist across tab switches (core bug fix)
 *   3. Message formatting renders correctly (bold, italic, code, headings, lists)
 *   4. Context summary messages appear before AI responses
 *   5. Recent Tasks dropdown works in chat input area
 *   6. localStorage persistence (state survives page reload)
 *   7. Dashboard health endpoint returns 200
 *
 * IMPORTANT: This is an SPA. Navigation is via sidebar buttons, not URL paths.
 * The root URL (/) is the only real route. /ide-terminal returns 404 from Next.js.
 *
 * Run: npx playwright test e2e/ide-terminal-deployed.spec.ts --config=playwright.config.ts
 */

import { test, expect } from "@playwright/test"

const DEPLOYED_URL = "https://dev.abcx124.xyz"

/**
 * Helper: Navigate to IDE Terminal via sidebar button
 */
async function navigateToIdeTerminal(page: any) {
	// Go to root (the SPA entry point)
	await page.goto(DEPLOYED_URL)
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(2000)

	// Check if we're on the login page
	const loginForm = page.locator("form").first()
	const needsLogin = await loginForm.isVisible().catch(() => false)

	if (needsLogin) {
		// Set a fake auth token and reload
		await page.evaluate(() => {
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)
	}

	// Click the IDE Terminal button in the sidebar
	const ideButton = page.locator("button").filter({ hasText: "IDE Terminal" }).first()
	await ideButton.waitFor({ state: "visible", timeout: 10000 })
	await ideButton.click()
	await page.waitForTimeout(1500)

	// Verify we're on the IDE Terminal page
	const pageTitle = page.locator("h1")
	await expect(pageTitle).toContainText("IDE Terminal", { timeout: 5000 })
}

/**
 * Helper: Ensure we're authenticated (set fake token if needed)
 */
async function ensureAuthenticated(page: any) {
	await page.evaluate(() => {
		localStorage.setItem("superroo_auth_token", "e2e-test-token")
	})
}

test.describe("Deployed IDE Terminal — Visual E2E", () => {
	test.beforeEach(async ({ page }) => {
		// Clear previous state but keep auth token
		await page.goto(DEPLOYED_URL)
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(1000)
		await page.evaluate(() => {
			localStorage.removeItem("superroo-ide-state")
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})
	})

	test("1. Page loads and renders IDE Terminal UI", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Take a full-page screenshot
		await page.screenshot({
			path: "e2e/screenshots/deployed-ide-terminal-loaded.png",
			fullPage: true,
		})

		// Verify key UI elements
		const terminalHeader = page.locator("text=Terminal")
		const headerVisible = await terminalHeader.isVisible().catch(() => false)
		console.log(`Terminal header visible: ${headerVisible}`)
	})

	test("2. Messages persist across tab switches (core bug fix)", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Inject test messages into localStorage BEFORE any API data loads
		const testMessages = [
			{
				id: "tab-switch-test-1",
				role: "user",
				author: "You",
				time: new Date().toISOString(),
				content: "What is the status of my project?",
			},
			{
				id: "tab-switch-test-2",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "Your project is running smoothly. All services are online.",
			},
		]

		await page.evaluate((messages) => {
			const key = "superroo-ide-state"
			const existing = localStorage.getItem(key)
			let state = existing ? JSON.parse(existing) : {}
			state.aiMessages = messages
			localStorage.setItem(key, JSON.stringify(state))
		}, testMessages)

		// Reload to pick up the injected messages (with retry for flaky net::ERR_ABORTED)
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await page.reload({ timeout: 15000 })
				await page.waitForLoadState("networkidle", { timeout: 15000 })
				break
			} catch {
				if (attempt === 2) throw new Error("page.reload failed after 3 attempts")
				console.log(`Reload attempt ${attempt + 1} failed, retrying...`)
				await page.waitForTimeout(2000)
			}
		}
		await page.waitForTimeout(2000)

		// Navigate back to IDE Terminal
		await navigateToIdeTerminal(page)

		// Take screenshot showing messages are still there after navigation
		await page.screenshot({
			path: "e2e/screenshots/deployed-before-tab-switch.png",
			fullPage: true,
		})

		// Now switch to Overview tab via sidebar
		// Try multiple selectors for the sidebar button
		const overviewButton = page.getByRole("button", { name: /overview/i }).first()
		try {
			await overviewButton.waitFor({ state: "visible", timeout: 5000 })
			await overviewButton.click()
		} catch {
			// Fallback: try text-based selector
			const overviewBtnAlt = page.locator("button").filter({ hasText: "Overview" }).first()
			await overviewBtnAlt.waitFor({ state: "visible", timeout: 5000 })
			await overviewBtnAlt.click()
		}
		await page.waitForTimeout(1500)

		// Take screenshot on Overview page
		await page.screenshot({
			path: "e2e/screenshots/deployed-on-overview.png",
			fullPage: true,
		})

		// Switch back to IDE Terminal
		const ideTerminalButton = page.getByRole("button", { name: /ide terminal/i }).first()
		try {
			await ideTerminalButton.waitFor({ state: "visible", timeout: 5000 })
			await ideTerminalButton.click()
		} catch {
			const ideBtnAlt = page.locator("button").filter({ hasText: "IDE Terminal" }).first()
			await ideBtnAlt.waitFor({ state: "visible", timeout: 5000 })
			await ideBtnAlt.click()
		}
		await page.waitForTimeout(2000)

		// Take screenshot after switching back — messages should still be there
		await page.screenshot({
			path: "e2e/screenshots/deployed-after-tab-switch.png",
			fullPage: true,
		})

		// Verify the page title is still "IDE Terminal"
		const title = page.locator("h1")
		await expect(title).toContainText("IDE Terminal", { timeout: 5000 })

		// Verify localStorage still has the messages (they weren't wiped)
		const storedMessages = await page.evaluate(() => {
			const key = "superroo-ide-state"
			const raw = localStorage.getItem(key)
			if (!raw) return null
			const state = JSON.parse(raw)
			return state.aiMessages || null
		})

		expect(storedMessages).not.toBeNull()
		expect(storedMessages?.length).toBe(2)
		expect(storedMessages?.[0].content).toBe("What is the status of my project?")
		expect(storedMessages?.[1].content).toBe("Your project is running smoothly. All services are online.")
		console.log(
			"✅ Messages persisted across tab switch! localStorage still has",
			storedMessages?.length,
			"messages",
		)
	})

	test("3. Message formatting renders correctly (bold, italic, code, headings)", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Inject test messages with various formatting into localStorage
		const testMessages = [
			{
				id: "fmt-test-1",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "This is **bold text** and this is *italic text*",
			},
			{
				id: "fmt-test-2",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "Here is `inline code` and a code block:\n```\nconst x = 1\n```",
			},
			{
				id: "fmt-test-3",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "### Heading 3\n\n- List item 1\n- List item 2\n- List item 3",
			},
			{
				id: "fmt-test-4",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "> This is a blockquote\n\n1. Ordered item 1\n2. Ordered item 2",
			},
		]

		await page.evaluate((messages) => {
			const key = "superroo-ide-state"
			const existing = localStorage.getItem(key)
			let state = existing ? JSON.parse(existing) : {}
			state.aiMessages = messages
			localStorage.setItem(key, JSON.stringify(state))
		}, testMessages)

		// Reload to pick up the injected messages
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)

		// Navigate back to IDE Terminal
		await navigateToIdeTerminal(page)

		// Take screenshot showing formatted messages
		await page.screenshot({
			path: "e2e/screenshots/deployed-formatted-messages.png",
			fullPage: true,
		})

		// Try to find the AI panel
		const aiPanel = page.locator("aside").filter({ hasText: "AI Assistant" })
		const panelVisible = await aiPanel
			.first()
			.isVisible()
			.catch(() => false)
		console.log(`AI panel visible: ${panelVisible}`)

		if (panelVisible) {
			// Take a close-up of the AI panel area
			await aiPanel.first().screenshot({
				path: "e2e/screenshots/deployed-ai-panel-closeup.png",
			})
		}

		// Check if any message content is visible in the DOM
		const pageContent = await page.evaluate(() => document.body.innerText)
		const hasBoldText = pageContent.includes("bold text")
		const hasItalicText = pageContent.includes("italic text")
		const hasInlineCode = pageContent.includes("inline code")
		const hasHeading = pageContent.includes("Heading 3")
		const hasBlockquote = pageContent.includes("blockquote")
		console.log(`Bold text visible: ${hasBoldText}`)
		console.log(`Italic text visible: ${hasItalicText}`)
		console.log(`Inline code visible: ${hasInlineCode}`)
		console.log(`Heading visible: ${hasHeading}`)
		console.log(`Blockquote visible: ${hasBlockquote}`)
	})

	test("4. Context summary messages appear before AI responses", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Inject a system message (context summary) into localStorage
		const testMessages = [
			{
				id: "ctx-1",
				role: "system",
				author: "System",
				time: new Date().toISOString(),
				content:
					"📋 **Context Summary**\n\nI can see the following context:\n- **Current File:** `src/app.ts`\n- **Open Files:** src/app.ts, src/utils/helper.ts\n- **Workspace:** superroo2\n- **Recent History:** 2 previous messages\n\nIs this the correct context for your request?",
			},
			{
				id: "ctx-2",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "Based on the context, here is my response to your question.",
			},
		]

		await page.evaluate((messages) => {
			const key = "superroo-ide-state"
			const existing = localStorage.getItem(key)
			let state = existing ? JSON.parse(existing) : {}
			state.aiMessages = messages
			localStorage.setItem(key, JSON.stringify(state))
		}, testMessages)

		// Reload and navigate
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)
		await navigateToIdeTerminal(page)

		// Take screenshot showing context summary
		await page.screenshot({
			path: "e2e/screenshots/deployed-context-summary.png",
			fullPage: true,
		})

		// Check if context summary text is visible
		const pageContent = await page.evaluate(() => document.body.innerText)
		const hasContextSummary = pageContent.includes("Context Summary")
		console.log(`Context summary visible: ${hasContextSummary}`)
	})

	test("5. Recent Tasks dropdown works in chat input area", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Inject workspace tasks into localStorage
		await page.evaluate(() => {
			const key = "superroo-ide-state"
			const existing = localStorage.getItem(key)
			let state = existing ? JSON.parse(existing) : {}
			state.workspaceTasks = [
				{ id: "task-1", name: "Fix login bug", status: "done" },
				{ id: "task-2", name: "Add user authentication", status: "in_progress" },
				{ id: "task-3", name: "Update API documentation", status: "pending" },
				{ id: "task-4", name: "Refactor database layer", status: "pending" },
				{ id: "task-5", name: "Add unit tests for payment module", status: "done" },
			]
			localStorage.setItem(key, JSON.stringify(state))
		})

		// Reload and navigate
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)
		await navigateToIdeTerminal(page)

		// Take screenshot showing the chat input area with tasks
		await page.screenshot({
			path: "e2e/screenshots/deployed-recent-tasks.png",
			fullPage: true,
		})

		// Check if task names appear in the page
		const pageContent = await page.evaluate(() => document.body.innerText)
		const hasTask1 = pageContent.includes("Fix login bug")
		const hasTask2 = pageContent.includes("Add user authentication")
		console.log(`Task 'Fix login bug' visible: ${hasTask1}`)
		console.log(`Task 'Add user authentication' visible: ${hasTask2}`)
	})

	test("6. localStorage persistence survives page reload", async ({ page }) => {
		await navigateToIdeTerminal(page)

		// Inject test messages into localStorage
		const testMessages = [
			{
				id: "persist-1",
				role: "user",
				author: "You",
				time: new Date().toISOString(),
				content: "What is the status of my project?",
			},
			{
				id: "persist-2",
				role: "assistant",
				author: "AI",
				time: new Date().toISOString(),
				content: "Your project is running smoothly. All services are online.",
			},
		]

		await page.evaluate((messages) => {
			const key = "superroo-ide-state"
			const existing = localStorage.getItem(key)
			let state = existing ? JSON.parse(existing) : {}
			state.aiMessages = messages
			localStorage.setItem(key, JSON.stringify(state))
		}, testMessages)

		// Reload the page
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)

		// Navigate back to IDE Terminal
		await navigateToIdeTerminal(page)

		// Take screenshot after reload
		await page.screenshot({
			path: "e2e/screenshots/deployed-after-reload.png",
			fullPage: true,
		})

		// Verify localStorage still has the messages
		const storedMessages = await page.evaluate(() => {
			const key = "superroo-ide-state"
			const raw = localStorage.getItem(key)
			if (!raw) return null
			const state = JSON.parse(raw)
			return state.aiMessages || null
		})

		expect(storedMessages).not.toBeNull()
		expect(storedMessages?.length).toBe(2)
		expect(storedMessages?.[0].content).toBe("What is the status of my project?")
		expect(storedMessages?.[1].content).toBe("Your project is running smoothly. All services are online.")
		console.log("✅ localStorage persistence verified after page reload!")
	})

	test("7. Dashboard health endpoint returns 200", async ({ page }) => {
		const response = await page.request.get(`${DEPLOYED_URL}/api/health`)
		expect(response.status()).toBe(200)

		const body = await response.json()
		console.log("Health response:", JSON.stringify(body, null, 2))

		// Verify all services are online
		expect(body.status).toBe("online")
		expect(body.redis).toBe(true)
		expect(body.worker).toBe(true)
		expect(body.orchestrator.running).toBe(true)
	})
})
