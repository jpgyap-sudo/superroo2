import * as path from "path"
import { SuperRooRuntime, SuperRooSource } from "./types"

export function createDefaultRuntime(input: { source: SuperRooSource; workspaceRoot?: string; codedBy?: string }): SuperRooRuntime {
	const workspaceRoot = input.workspaceRoot || process.cwd()

	return {
		source: input.source,
		workspaceRoot: path.resolve(workspaceRoot),
		codedBy: input.codedBy,
		log: (message: string) => console.log(`[superroo] ${message}`),
		warn: (message: string) => console.warn(`[superroo:warn] ${message}`),
		error: (message: string, error?: unknown) => console.error(`[superroo:error] ${message}`, error ?? ""),
	}
}
