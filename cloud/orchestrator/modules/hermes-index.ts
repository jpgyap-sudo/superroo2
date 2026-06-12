/**
 * SuperRoo Cloud — HermesClaw Module Index
 *
 * Re-exports both the TypeScript port and the original JS implementation.
 * Consumers should import from this file.
 *
 * Usage:
 *   import { HermesClaw, createHermesClaw } from "../modules/hermes-index"
 */

export { HermesClaw, createHermesClaw } from "./HermesClaw"
export type {
	HermesClawConfig,
	HermesStats,
	HermesMemoryEntry,
	HermesRequest,
	HermesResult,
	HermesOperation,
	SkillEntry,
	BugFixRecord,
	LessonRecord,
	RAGContext,
	OllamaGrowthEntry,
} from "./HermesClawTypes"
