/**
 * Tests for telegramClassifier.js
 *
 * Run with: cd src && npx vitest run ../cloud/api/__tests__/test-telegram-classifier.test.js
 */

// Vitest globals (describe, test, expect, beforeEach) are available via vitest.config.ts

// Use dynamic require since we're testing from src directory
const path = require("path")
const classifierPath = path.join(__dirname, "..", "telegramClassifier.js")
const classifier = require(classifierPath)

describe("telegramClassifier", () => {
	describe("keywordFallback", () => {
		test("detects chat/research intent", () => {
			expect(classifier.keywordFallback("What is the best architecture for this?")).toBe("chat")
			expect(classifier.keywordFallback("Can you explain how this works?")).toBe("chat")
			expect(classifier.keywordFallback("Tell me about the project")).toBe("chat")
			expect(classifier.keywordFallback("Research the best practices")).toBe("chat")
		})

		test("detects debug_plan intent", () => {
			expect(classifier.keywordFallback("Can you debug this issue?")).toBe("debug_plan")
			expect(classifier.keywordFallback("Fix bug in login")).toBe("debug_plan")
			expect(classifier.keywordFallback("There's an error in the code")).toBe("debug_plan")
			expect(classifier.keywordFallback("The app is broken")).toBe("debug_plan")
			expect(classifier.keywordFallback("Fix this crash")).toBe("debug_plan")
		})

		test("detects read_logs intent", () => {
			expect(classifier.keywordFallback("Show me the logs")).toBe("read_logs")
			expect(classifier.keywordFallback("Check the logs for errors")).toBe("read_logs")
			expect(classifier.keywordFallback("View recent logs")).toBe("read_logs")
			expect(classifier.keywordFallback("Show log for superroo-api")).toBe("read_logs")
		})

		test("detects run_tests intent", () => {
			expect(classifier.keywordFallback("Run the tests")).toBe("run_tests")
			expect(classifier.keywordFallback("Run unit tests")).toBe("run_tests")
			expect(classifier.keywordFallback("Run e2e tests")).toBe("run_tests")
			expect(classifier.keywordFallback("Run vitest")).toBe("run_tests")
		})

		test("detects create_branch intent", () => {
			expect(classifier.keywordFallback("Create a new branch")).toBe("create_branch")
			expect(classifier.keywordFallback("Create branch for feature")).toBe("create_branch")
			expect(classifier.keywordFallback("New branch please")).toBe("create_branch")
		})

		test("detects create_pr intent", () => {
			expect(classifier.keywordFallback("Create a PR")).toBe("create_pr")
			expect(classifier.keywordFallback("Open a pull request")).toBe("create_pr")
			expect(classifier.keywordFallback("New PR for the fix")).toBe("create_pr")
		})

		test("detects restart_worker intent", () => {
			expect(classifier.keywordFallback("Restart the worker")).toBe("restart_worker")
			expect(classifier.keywordFallback("Restart superroo-api")).toBe("restart_worker")
			expect(classifier.keywordFallback("Reboot the server")).toBe("restart_worker")
		})

		test("detects deploy intent", () => {
			expect(classifier.keywordFallback("Deploy to production")).toBe("deploy")
			expect(classifier.keywordFallback("Release the new version")).toBe("deploy")
			expect(classifier.keywordFallback("Publish the changes")).toBe("deploy")
		})

		test("detects delete_data intent", () => {
			expect(classifier.keywordFallback("Delete the database")).toBe("delete_data")
			expect(classifier.keywordFallback("Remove all records")).toBe("delete_data")
			expect(classifier.keywordFallback("Clear data")).toBe("delete_data")
		})

		test("detects shell intent", () => {
			expect(classifier.keywordFallback("Run a shell command")).toBe("shell")
			expect(classifier.keywordFallback("Open terminal")).toBe("shell")
			expect(classifier.keywordFallback("Execute bash script")).toBe("shell")
		})

		test("defaults to chat for unknown input", () => {
			expect(classifier.keywordFallback("Hello how are you?")).toBe("chat")
			expect(classifier.keywordFallback("Good morning")).toBe("chat")
			expect(classifier.keywordFallback("What's up?")).toBe("chat")
		})
	})

	describe("classifyIntent", () => {
		test("falls back to keyword when no providers", async () => {
			const result = await classifier.classifyIntent("Fix this bug", [])
			expect(result.kind).toBe("debug_plan")
			expect(result.message).toBe("Fix this bug")
			expect(result.confidence).toBe(0.5)
		})

		test("falls back to keyword when providers is null", async () => {
			const result = await classifier.classifyIntent("Run the tests", null)
			expect(result.kind).toBe("run_tests")
		})

		test("falls back to keyword when providers have no apiKey", async () => {
			const result = await classifier.classifyIntent("Deploy to production", [{ providerId: "test", apiKey: "" }])
			expect(result.kind).toBe("deploy")
		})

		test("returns chat for casual conversation", async () => {
			const result = await classifier.classifyIntent("Hello, how are you?", [])
			expect(result.kind).toBe("chat")
		})
	})

	describe("buildClassifierPrompt", () => {
		test("returns a string prompt", () => {
			const prompt = classifier.buildClassifierPrompt()
			expect(typeof prompt).toBe("string")
			expect(prompt.length).toBeGreaterThan(50)
			expect(prompt).toContain("JSON")
			expect(prompt).toContain("kind")
			expect(prompt).toContain("confidence")
		})
	})
})
