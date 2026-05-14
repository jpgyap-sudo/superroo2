/**
 * Debug test — checks localStorage state at each step
 */
import { test, expect } from "@playwright/test"

const DEPLOYED_URL = "https://dev.abcx124.xyz"

test.describe("Debug: localStorage flow", () => {
	test("Trace localStorage through injection, reload, and navigation", async ({ page }) => {
		// Step 1: Load page and set auth
		await page.goto(DEPLOYED_URL)
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(1000)

		await page.evaluate(() => {
			localStorage.setItem("superroo_auth_token", "e2e-test-token")
		})

		// Step 2: Check initial localStorage
		let lsState = await page.evaluate(() => localStorage.getItem("superroo-ide-state"))
		console.log("Step 2 - Initial localStorage:", lsState ? "EXISTS" : "NULL")

		// Step 3: Inject messages
		await page.evaluate(() => {
			const key = "superroo-ide-state"
			const state = {
				showAiPanel: true,
				aiTab: "chat",
				aiMessages: [
					{
						id: "test-msg-1",
						role: "assistant",
						author: "AI",
						time: new Date().toISOString(),
						content: "This is **bold text** and *italic*",
					},
				],
			}
			localStorage.setItem(key, JSON.stringify(state))
		})

		lsState = await page.evaluate(() => localStorage.getItem("superroo-ide-state"))
		console.log("Step 3 - After injection:", lsState ? "EXISTS" : "NULL")
		if (lsState) {
			const parsed = JSON.parse(lsState)
			console.log(`  aiMessages count: ${parsed.aiMessages?.length || 0}`)
			console.log(`  showAiPanel: ${parsed.showAiPanel}`)
		}

		// Step 4: Reload
		await page.reload()
		await page.waitForLoadState("networkidle")
		await page.waitForTimeout(2000)

		lsState = await page.evaluate(() => localStorage.getItem("superroo-ide-state"))
		console.log("Step 4 - After reload:", lsState ? "EXISTS" : "NULL")
		if (lsState) {
			const parsed = JSON.parse(lsState)
			console.log(`  aiMessages count: ${parsed.aiMessages?.length || 0}`)
			console.log(`  showAiPanel: ${parsed.showAiPanel}`)
			console.log(`  _hydrated: ${parsed._hydrated}`)
			console.log(`  aiMessages[0]?.content: ${parsed.aiMessages?.[0]?.content || "N/A"}`)
		}

		// Step 5: Navigate to IDE Terminal
		const ideButton = page.locator("button").filter({ hasText: "IDE Terminal" }).first()
		await ideButton.waitFor({ state: "visible", timeout: 10000 })
		await ideButton.click()
		await page.waitForTimeout(2000)

		lsState = await page.evaluate(() => localStorage.getItem("superroo-ide-state"))
		console.log("Step 5 - After IDE Terminal nav:", lsState ? "EXISTS" : "NULL")
		if (lsState) {
			const parsed = JSON.parse(lsState)
			console.log(`  aiMessages count: ${parsed.aiMessages?.length || 0}`)
			console.log(`  showAiPanel: ${parsed.showAiPanel}`)
			console.log(`  aiMessages[0]?.content: ${parsed.aiMessages?.[0]?.content || "N/A"}`)
		}

		// Step 6: Check what the AI panel actually shows
		const aiPanelText = await page.evaluate(() => {
			const asides = document.querySelectorAll("aside")
			for (const a of asides) {
				if (a.textContent?.includes("AI Assistant")) {
					// Get the chat messages area
					const chatArea = a.querySelector(".overflow-y-auto")
					return chatArea?.textContent || a.textContent || "NO TEXT"
				}
			}
			return "NO ASIDE FOUND"
		})
		console.log(`Step 6 - AI panel chat area text: "${aiPanelText.substring(0, 300)}"`)

		// Step 7: Check if the IdeProvider hydration effect ran
		const hydrationCheck = await page.evaluate(() => {
			const key = "superroo-ide-state"
			const raw = localStorage.getItem(key)
			if (!raw) return { error: "NO STATE IN LS" }
			const state = JSON.parse(raw)
			return {
				hasAiMessages: Array.isArray(state.aiMessages) && state.aiMessages.length > 0,
				aiMessagesCount: state.aiMessages?.length || 0,
				showAiPanel: state.showAiPanel,
				_hydrated: state._hydrated,
				keys: Object.keys(state).sort(),
			}
		})
		console.log("Step 7 - Hydration check:", JSON.stringify(hydrationCheck, null, 2))
	})
})
