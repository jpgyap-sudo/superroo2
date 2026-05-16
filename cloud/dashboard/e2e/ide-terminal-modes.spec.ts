import { test, expect } from "@playwright/test"

async function openIdeTerminal(page: any) {
	await page.addInitScript(() => {
		localStorage.setItem("superroo_auth_token", "e2e-test-token")
	})
	await page.route("**/api/ide-workspace/workspace", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				workspaceId: "ws-1",
				repoName: "superroo2",
				branch: "main",
				files: [],
				pipeline: [],
				recentWorkspaces: [],
				workspaceTasks: [],
				status: { connected: true, docker: false, redis: false, cpu: "0%", ram: "0MB" },
			}),
		})
	})
	await page.route("**/api/ide-workspace/terminal/execute", async (route) => {
		const body = route.request().postDataJSON()
		const routed =
			body.mode === "agent"
				? `/code ${body.command}`
				: body.mode === "skill"
					? `/skill ${body.command}`
					: body.command
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ ok: true, output: [`$ ${routed}`, `${body.mode} response`] }),
		})
	})

	await page.goto("/")
	const ideButton = page.locator("button").filter({ hasText: "IDE Terminal" }).first()
	await ideButton.click()
	await expect(page.getByText("Agent Terminal")).toBeVisible()
}

test.describe("IDE terminal modes", () => {
	test("agent, skill, and shell modes route commands distinctly", async ({ page }) => {
		await openIdeTerminal(page)
		const input = page.locator('input[placeholder*="command"]')

		await input.fill("fix auth")
		await input.press("Enter")
		await expect(page.getByText("$ /code fix auth")).toBeVisible()

		await page.getByText("SK", { exact: true }).click()
		await input.fill("summarize repo")
		await input.press("Enter")
		await expect(page.getByText("$ /skill summarize repo")).toBeVisible()

		await page.getByText("SH", { exact: true }).click()
		await input.fill("pwd")
		await input.press("Enter")
		await expect(page.getByText("$ pwd")).toBeVisible()
	})
})
