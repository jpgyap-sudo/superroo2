/**
 * Prompt system barrel export.
 *
 * Provides prompt fragment types, the PromptService for variant resolution,
 * and built-in fragment ID constants.
 */

export {
	BUILT_IN_FRAGMENTS,
} from "./types"

export type {
	BasePromptFragment,
	CustomizedPromptFragment,
	PromptFragment,
	ResolvedPromptFragment,
	ResolvedAIVariable,
	PromptFragmentCollection,
} from "./types"

export { PromptService } from "./PromptService"
