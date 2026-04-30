import { SuperRooAgent } from "../../core/types"

export const productManagerAgent: SuperRooAgent = {
	id: "product-manager",
	name: "Product Manager Agent",
	description: "Reviews feature status and prioritizes safe next tasks.",
	async run() {
		return {
			ok: true,
			summary: "Feature review placeholder completed.",
			details: [
				"Read feature registry in later phase.",
				"Rank bugs by business impact in later phase.",
				"Send coder/debugger tasks in later phase.",
			],
		}
	},
}
