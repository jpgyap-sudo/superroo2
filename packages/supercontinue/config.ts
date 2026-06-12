import { Config } from "continue"

export function modifyConfig(config: Config): Config {
  // SuperContinue - Pure Local Ollama Configuration
  // All models run locally via Ollama - no cloud connections
  // All secrets stay within the SuperRoo ecosystem

  config.models = [
    {
      title: "Hermes3 Planner",
      provider: "ollama",
      model: "hermes3:latest",
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat"],
      temperature: 0.3,
    },
    {
      title: "Phi4 Architect",
      provider: "ollama",
      model: "phi4:latest",
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat"],
      temperature: 0.2,
    },
    {
      title: "Qwen2.5-Coder-7B",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["autocomplete", "chat", "edit"],
      temperature: 0.0,
    },
    {
      title: "Qwen2.5-Coder-14B",
      provider: "ollama",
      model: "qwen2.5-coder:14b",
      apiBase: "http://localhost:11434",
      contextLength: 32768,
      roles: ["chat", "edit"],
      temperature: 0.2,
    },
    {
      title: "Nomic-Embed",
      provider: "ollama",
      model: "nomic-embed-text:latest",
      apiBase: "http://localhost:11434",
      contextLength: 8192,
      roles: ["embed"],
      temperature: 0.0,
    },
  ]

  // Disable all telemetry and remote config
  config.disableTelemetry = true
  config.allowRemoteConfig = false

  // SuperContinue system message
  config.systemMessage = `You are SuperContinue, a pure local Ollama coding agent integrated with the SuperRoo ecosystem.
All models run locally via Ollama - no cloud connections.
All secrets stay within the SuperRoo ecosystem.
Contribute lessons to the learning layer after completing tasks.
Follow autonomous coding principles: plan decisively, iterate until success, record outcomes.`

  return config
}