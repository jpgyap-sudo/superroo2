import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("CLI", () => {
	let exitSpy: any
	let errorSpy: any
	let logSpy: any

	beforeEach(() => {
		vi.resetModules()
		exitSpy = (vi.spyOn(process, "exit").mockImplementation(() => undefined as never) as any)
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
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"))
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("runs autonomous command", async () => {
		await runCli("autonomous")
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Prepared SuperRoo task from cli"))
	})

	it("prints a shared task contract for task command", async () => {
		await runCli("task", "fix", "the", "bug")
		const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)
		expect(payload).toMatchObject({
			source: "cli",
			agent: "coder",
			goal: "fix the bug",
		})
	})

	it("requires a goal for task command", async () => {
		await runCli("task")
		expect(errorSpy).toHaveBeenCalledWith("error: missing required argument 'goal'")
		expect(exitSpy).toHaveBeenCalledWith(1)
	})

	it("runs deploy command", async () => {
		await runCli("deploy")
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("========== SuperRoo Deploy =========="))
	})

	it("runs check-vps command", async () => {
		await runCli("check-vps")
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("========== SuperRoo VPS / Site Health Check =========="))
	})

	it("runs debug-api command", async () => {
		await runCli("debug-api")
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("========== SuperRoo API Debugger =========="))
	})

	it("runs status command", async () => {
		await runCli("status")
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("========== SuperRoo Status =========="))
	})

	it("exits with error on unknown command", async () => {
		await runCli("unknown")
		expect(errorSpy).toHaveBeenCalledWith("error: unknown command 'unknown'")
		expect(exitSpy).toHaveBeenCalledWith(1)
	})
})
