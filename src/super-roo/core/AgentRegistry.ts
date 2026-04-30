import { SuperRooAgent } from "./types"
import { deployCheckerAgent } from "../agents/phase3/deployCheckerAgent"
import { debuggerAgent } from "../agents/phase3/debuggerAgent"
import { productManagerAgent } from "../agents/phase3/productManagerAgent"
import { testerAgent } from "../agents/phase3/testerAgent"

export function createAgentRegistry(): SuperRooAgent[] {
	return [productManagerAgent, debuggerAgent, testerAgent, deployCheckerAgent]
}
