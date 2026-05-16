import { SuperRooAgent } from "../../core/types"

export const debuggerAgent: SuperRooAgent = {
	id: "debugger",
	name: "Debugger Agent",
	description: "Finds likely code, API, and deployment bugs.",
	async run(context) {
		return {
			ok: true,
			summary: `Debugger skeleton executed for command: ${context.command}`,
			details: [
				"Check .env presence in later phase.",
				"Check Claude/Kimi API wiring in later phase.",
				"Check logs and failing tests in later phase.",
			],
		}
	},
}
