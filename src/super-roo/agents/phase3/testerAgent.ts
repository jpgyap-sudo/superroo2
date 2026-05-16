import { SuperRooAgent } from "../../core/types"

export const testerAgent: SuperRooAgent = {
	id: "tester",
	name: "Tester Agent",
	description: "Runs test/build checks before any deployment.",
	async run() {
		return {
			ok: true,
			summary: "Tester skeleton completed.",
			details: [
				"Run pnpm build in later phase.",
				"Run unit tests in later phase.",
				"Block deployment when checks fail in later phase.",
			],
		}
	},
}
