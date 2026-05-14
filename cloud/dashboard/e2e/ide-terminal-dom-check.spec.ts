/**
 * Quick DOM check test — verifies messages are actually rendered in the AI panel
 */
import { test, expect } from "@playwright/test"

const DEPLOYED_URL = "https://dev.abcx124.xyz"

test.describe("DOM Content Verification", () => {
	test("Messages are rendered in AI panel DOM", async ({ page }) => {
		// Setup
		await page.goto(DEPLOYED_URL)
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(1000)

		// Set auth
		await page.evaluate(() => {
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})

		// Inject messages WITH showAiPanel: true (critical for the AI panel to render)
		await page.evaluate(() => {
			const key = "superroo-ide-state"
			const state = {
				showAiPanel: true,
				aiTab: "chat",
				aiMessages: [
					{
						id: "dom-test-1",
						role: "assistant",
						author: "AI",
						time: new Date().toISOString(),
						content: "This is **bold text** and this is *italic text*",
					},
					{
						id: "dom-test-2",
						role: "assistant",
						author: "AI",
						time: new Date().toISOString(),
						content: "Here is `inline code` and a code block:\n```\nconst x = 1\n```",
					},
					{
						id: "dom-test-3",
						role: "assistant",
						author: "AI",
						time: new Date().toISOString(),
						content: "### Heading 3\n\n- List item 1\n- List item 2",
					},
					{
						id: "dom-test-4",
						role: "system",
						author: "System",
						time: new Date().toISOString(),
						content: "📋 **Context Summary** — I can see your workspace context",
					},
				],
			}
			localStorage.setItem(key, JSON.stringify(state))
		})

		// Reload
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)

		// Navigate to IDE Terminal
		const ideButton = page.locator("button").filter({ hasText: "IDE Terminal" }).first()
		await ideButton.waitFor({ state: "visible", timeout: 10000 })
		await ideButton.click()
		await page.waitForTimeout(2000)

		// Check ALL asides in the document
		const allAsides = await page.evaluate(() => {
			const asides = document.querySelectorAll("aside")
			const results: { index: number; text: string; html: string }[] = []
			asides.forEach((a, i) => {
				results.push({
					index: i,
					text: (a.textContent || "").substring(0, 500),
					html: a.innerHTML.substring(0, 500),
				})
			})
			return results
		})

		console.log(`Found ${allAsides.length} <aside> elements:`)
		for (const a of allAsides) {
			console.log(`\n--- Aside #${a.index} ---`)
			console.log(`Text: ${a.text.substring(0, 200)}`)
			console.log(`Has 'AI Assistant': ${a.text.includes("AI Assistant")}`)
			console.log(`Has 'bold text': ${a.text.includes("bold text")}`)
		}

		// Find the AI panel aside (should contain "AI Assistant")
		const aiAside = allAsides.find((a) => a.text.includes("AI Assistant"))
		console.log(`\n=== AI Panel found: ${!!aiAside} ===`)

		if (aiAside) {
			console.log(`AI Panel text: ${aiAside.text}`)
			console.log(`Has 'bold text': ${aiAside.text.includes("bold text")}`)
			console.log(`Has 'italic text': ${aiAside.text.includes("italic text")}`)
			console.log(`Has 'inline code': ${aiAside.text.includes("inline code")}`)
			console.log(`Has 'Heading 3': ${aiAside.text.includes("Heading 3")}`)
			console.log(`Has 'List item 1': ${aiAside.text.includes("List item 1")}`)
			console.log(`Has 'Context Summary': ${aiAside.text.includes("Context Summary")}`)
		}

		// Also check the full page text
		const bodyText = await page.evaluate(() => document.body.innerText)
		console.log(`\n=== Body text checks ===`)
		console.log(`Has 'bold text': ${bodyText.includes("bold text")}`)
		console.log(`Has 'italic text': ${bodyText.includes("italic text")}`)
		console.log(`Has 'inline code': ${bodyText.includes("inline code")}`)
		console.log(`Has 'Heading 3': ${bodyText.includes("Heading 3")}`)
		console.log(`Has 'List item 1': ${bodyText.includes("List item 1")}`)
		console.log(`Has 'Context Summary': ${bodyText.includes("Context Summary")}`)

		// Take screenshot
		await page.screenshot({
			path: "e2e/screenshots/deployed-dom-check.png",
			fullPage: true,
		})

		expect(aiAside?.text.includes("bold text") || bodyText.includes("bold text")).toBeTruthy()
	})
})
