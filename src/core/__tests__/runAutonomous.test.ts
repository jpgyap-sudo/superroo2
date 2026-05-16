import { describe, expect, it, vi } from "vitest"
import { runAutonomous } from "../runAutonomous"

describe("runAutonomous", () => {
	it("logs start and finish messages", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		await runAutonomous()
		expect(logSpy).toHaveBeenCalledWith("Starting SuperRoo autonomous mode...")
		expect(logSpy).toHaveBeenCalledWith("Autonomous mode finished.")
		logSpy.mockRestore()
	})
})
