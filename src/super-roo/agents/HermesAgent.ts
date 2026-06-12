/**
 * Hermes Agent - Handles questions and memory queries in parallel with main tasks.
 *
 * This agent is designed to:
 * 1. Respond to user questions while the main agent is working
 * 2. Query the learning layer (Ollama + Central Brain) for context
 * 3. Provide real-time assistance without blocking the main task
 *
 * The Hermes agent integrates with the AgentBus for communication and
 * uses the lesson retrieval system for knowledge.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability } from "../types"
import { AgentBus, AgentMessage } from "../parallel/AgentBus"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface HermesQuestion {
  question: string
  context?: string
  taskId?: string
}

export interface HermesResponse {
  answer: string
  sources?: string[]
  confidence?: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Hermes Agent
// ──────────────────────────────────────────────────────────────────────────────

export class HermesAgent implements Agent {
  readonly name = "hermes"
  readonly description = "Handles questions and memory queries in parallel with main tasks"
  readonly requiredCapabilities: Capability[] = ["read.file"]

  private agentBus: AgentBus | null = null
  private questionHandler: ((question: HermesQuestion) => Promise<HermesResponse>) | null = null

  constructor(options?: {
    agentBus?: AgentBus
    questionHandler?: (question: HermesQuestion) => Promise<HermesResponse>
  }) {
    this.agentBus = options?.agentBus ?? null
    this.questionHandler = options?.questionHandler ?? null
  }

  /**
   * Register this agent on the AgentBus for parallel coordination.
   */
  registerOnBus(agentBus: AgentBus): void {
    this.agentBus = agentBus
    agentBus.registerAgent(this.name)

    // Subscribe to question messages
    agentBus.subscribe(this.name, "question", async (message: AgentMessage) => {
      const payload = message.payload as HermesQuestion
      const response = await this.handleQuestion(payload)
      return {
        id: `response_${Date.now()}`,
        from: this.name,
        to: message.from,
        type: "question_response",
        payload: response,
        priority: "high",
        timestamp: Date.now(),
        correlationId: message.correlationId,
      }
    })
  }

  /**
   * Handle a question from another agent or user.
   */
  async handleQuestion(question: HermesQuestion): Promise<HermesResponse> {
    if (this.questionHandler) {
      return this.questionHandler(question)
    }

    // Default implementation - use lesson retrieval
    try {
      const { getLessonRetriever } = await import("../../super-roo/lessons/LessonRetriever.js")
      const retriever = getLessonRetriever()
      await retriever.load()

      const lessons = await retriever.getTopLessons(5)
      const relevantLessons = lessons.filter((l) =>
        l.title?.toLowerCase().includes(question.question.toLowerCase()) ||
        (l.lesson_summary && l.lesson_summary.toLowerCase().includes(question.question.toLowerCase()))
      )

      if (relevantLessons.length > 0) {
        return {
          answer: relevantLessons.map((l) => l.lesson_summary).join("\n\n"),
          sources: relevantLessons.map((l) => l.title),
          confidence: 0.8,
        }
      }
    } catch (error) {
      // If lesson retrieval fails, fall through to default response
      console.warn("[HermesAgent] Lesson retrieval failed:", error)
    }

    return {
      answer: "I don't have specific knowledge about that topic. Let me know if you'd like me to search more broadly.",
      confidence: 0.3,
    }
  }

  /**
   * Run the Hermes agent for a task.
   */
  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const { task } = ctx
    const payload = task.payload as unknown as HermesQuestion

    if (!payload?.question) {
      return {
        ok: false,
        summary: "No question provided",
        error: "Hermes agent requires a question in the task payload",
      }
    }

    try {
      const response = await this.handleQuestion(payload)

      // If we have an AgentBus, broadcast the answer
      if (this.agentBus) {
        await this.agentBus.broadcast(
          this.name,
          "question_answered",
          { question: payload.question, answer: response.answer },
          "normal"
        )
      }

      return {
        ok: true,
        summary: "Question answered",
        data: response as unknown as Record<string, unknown>,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        summary: "Failed to answer question",
        error: message,
      }
    }
  }
}