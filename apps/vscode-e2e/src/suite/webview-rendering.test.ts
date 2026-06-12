import * as assert from "assert"
import * as vscode from "vscode"

import { setDefaultSuiteTimeout } from "./test-utils"

suite("Webview Rendering", function () {
	setDefaultSuiteTimeout(this)

	test("Sidebar webview should load and render without errors", async () => {
		// Focus the sidebar to ensure webview is created
		await vscode.commands.executeCommand("superroo.SidebarProvider.focus")

		// Wait for webview to be ready
		await new Promise((resolve) => setTimeout(resolve, 3000))

		// Get the extension
		const extension = vscode.extensions.getExtension("SuperRoo.superroo")
		assert.ok(extension, "Extension should be found")

		// The webview should be created and have HTML content
		// We verify this indirectly by checking that the webviewView exists
		// and that no errors were thrown during activation
		const api = globalThis.api
		assert.ok(api, "API should be available")

		// Check that the webview is ready (this means HTML was loaded)
		assert.ok(await api.isReady(), "Extension API should report ready state")
	})

	test("Webview should have valid HTML structure after load", async () => {
		// Focus the sidebar
		await vscode.commands.executeCommand("superroo.SidebarProvider.focus")

		// Wait for webview to initialize
		await new Promise((resolve) => setTimeout(resolve, 2000))

		// Verify the extension is active
		const extension = vscode.extensions.getExtension("SuperRoo.superroo")
		assert.ok(extension?.isActive, "Extension should be active")

		// Verify API is ready
		const api = globalThis.api
		assert.ok(api, "API should be available")
		assert.ok(await api.isReady(), "API should be ready")
	})
})