/**
 * Lessons Module
 *
 * Provides lesson retrieval and prompt enhancement capabilities
 * for the SuperRoo intelligence layer.
 */

export { LessonRetriever, getLessonRetriever, type Lesson, type RetrieveOptions } from "./LessonRetriever"
export { PromptEnhancer, getPromptEnhancer, enhancePrompt, type EnhanceOptions } from "./PromptEnhancer"
export { LearningClient, type LearningClientOptions, type LearningLessonInput } from "./LearningClient"
