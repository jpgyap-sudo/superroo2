/**
 * SuperContinue - Pure Local Ollama Coding Agent
 *
 * A fork of Continue.dev that operates entirely on local Ollama models
 * with SuperRoo ecosystem integration for ML, lessons, and autonomous coding.
 */

import { SuperContinueBrain, getSuperContinueBrain } from "./brain.js"

export interface SuperContinueConfig {
  models: SuperContinueModel[]
  disableTelemetry: boolean
  allowRemoteConfig: boolean
  systemMessage: string
}

export interface SuperContinueModel {
  title: string
  provider: "ollama"
  model: string
  apiBase: string
  contextLength: number
  roles: ("autocomplete" | "chat" | "edit" | "embed")[]
  temperature: number
  topP?: number
}

/**
 * Model roles mapping for SuperRoo ecosystem
 */
export const MODEL_ROLES = {
  PLANNER: "hermes3:latest",
  ARCHITECT: "phi4:latest",
  CODING: "qwen2.5-coder:7b",
  COMPLEX_CODING: "qwen2.5-coder:14b",
  SEARCH_EMBEDDINGS: "nomic-embed-text:latest",
} as const

/**
 * Get lessons from SuperRoo learning layer for prompt enhancement
 * Uses the SuperContinueBrain to query Central Brain
 */
export async function getRelevantLessons(task: string, files: string[] = []): Promise<string> {
  const brain = getSuperContinueBrain()
  return brain.getRelevantLessons(task, 5)
}

// Re-export brain for external use
export { SuperContinueBrain, getSuperContinueBrain }

// Re-export ML enhancement modules
export { ModelRouter, getModelRouter } from "./router.js"
export type { TaskFeatures, ModelPrediction } from "./router.js"

export { TemperatureController, getTemperatureController } from "./temperature.js"
export type { TemperatureContext } from "./temperature.js"

export { EnsembleVoter, getEnsembleVoter } from "./ensemble.js"
export type { ModelResponse, EnsembleResult } from "./ensemble.js"

export { FIMCache, getFIMCache } from "./cache.js"
export type { FIMContext, CachedCompletion } from "./cache.js"

export { Prompter, getPrompter } from "./prompter.js"
export type { PromptOptions, AugmentedPrompt } from "./prompter.js"

/**
 * Default SuperContinue configuration
 */
export const defaultConfig: SuperContinueConfig = {
  models: [
    {
      title: "Hermes3 Planner",
      provider: "ollama",
      model: MODEL_ROLES.PLANNER,
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat"],
      temperature: 0.3,
    },
    {
      title: "Phi4 Architect",
      provider: "ollama",
      model: MODEL_ROLES.ARCHITECT,
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat"],
      temperature: 0.2,
    },
    {
      title: "Qwen2.5-Coder-7B",
      provider: "ollama",
      model: MODEL_ROLES.CODING,
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["autocomplete", "chat", "edit"],
      temperature: 0.0,
    },
    {
      title: "Qwen2.5-Coder-14B",
      provider: "ollama",
      model: MODEL_ROLES.COMPLEX_CODING,
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat", "edit"],
      temperature: 0.2,
    },
    {
      title: "Nomic-Embed",
      provider: "ollama",
      model: MODEL_ROLES.SEARCH_EMBEDDINGS,
      apiBase: "http://localhost:11434",
      contextLength: 8192,
      roles: ["embed"],
      temperature: 0.0,
    },
  ],
  disableTelemetry: true,
  allowRemoteConfig: false,
  systemMessage: `You are SuperContinue, a pure local Ollama coding agent integrated with the SuperRoo ecosystem.
All models run locally via Ollama - no cloud connections.
Contribute lessons to the learning layer after completing tasks.
Follow autonomous coding principles: plan decisively, iterate until success, record outcomes.`,
}

export function createSuperContinueConfig(overrides: Partial<SuperContinueConfig> = {}): SuperContinueConfig {
  return {
    ...defaultConfig,
    ...overrides,
    models: overrides.models || defaultConfig.models,
  }
}