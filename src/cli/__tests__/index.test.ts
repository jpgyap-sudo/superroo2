import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("CLI", () => {
	let exitSpy: any
	let errorSpy: any
	let logSpy: any

	beforeEach(() => {
		vi.resetModules()
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	async function runCli(...args: string[]) {
		process.argv = ["node", "src/cli/index.ts", ...args]
		await import("../index")
		// Give the async main() a tick to finish.
		await new Promise((resolve) => setTimeout(resolve, 10))
	}

	it("prints help when no command is given", async () => {
		await runCli()
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SuperRoo CLI"))
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("runs autonomous command", async () => {
		await runCli("autonomous")
		expect(logSpy).toHaveBeenCalledWith("Starting SuperRoo autonomous mode...")
		expect(logSpy).toHaveBeenCalledWith("Prepared SuperRoo task from cli: Run autonomous coding loop")
		expect(logSpy).toHaveBeenCalledWith("Autonomous mode finished.")
	})

	it("prints a shared task contract for task command without a daemon URL", async () => {
		await runCli("task", "fix", "the", "bug")
		const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0])
		expect(payload).toMatchObject({
			source: "cli",
			agent: "coder",
			goal: "fix the bug",
		})
	})

	it("requires a goal for task command", async () => {
		await runCli("task")
		expect(errorSpy).toHaveBeenCalledWith("Usage: superroo task <goal>")
		expect(exitSpy).toHaveBeenCalledWith(1)
	})

	it("runs deploy command", async () => {
		await runCli("deploy")
		expect(logSpy).toHaveBeenCalledWith("Deploy command running...")
	})

	it("runs check-vps command", async () => {
		await runCli("check-vps")
		expect(logSpy).toHaveBeenCalledWith("Checking VPS...")
	})

	it("runs debug-api command", async () => {
		await runCli("debug-api")
		expect(logSpy).toHaveBeenCalledWith("Debugging API...")
	})

	it("exits with error on unknown command", async () => {
		await runCli("unknown")
		expect(errorSpy).toHaveBeenCalledWith("Unknown command: unknown")
		expect(exitSpy).toHaveBeenCalledWith(1)
	})
})
