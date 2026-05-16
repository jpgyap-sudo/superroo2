/**
 * SuperRoo — Conversational History Module
 *
 * Tracks all SuperRoo conversations and replies in a persistent JSON store,
 * with a monitoring agent that analyzes the history for errors, weaknesses,
 * and improvement opportunities — especially focused on making Telegram
 * frictionless with coding.
 */

export {
	ConversationHistoryManager,
	getConversationHistoryManager,
	resetConversationHistoryManager,
} from "./ConversationHistoryManager"

export { ConversationMonitorAgent, getConversationMonitorAgent } from "./ConversationMonitorAgent"
export * as TelegramConversationBridge from "./TelegramConversationBridge"

export type {
	// Core types
	ConversationSource,
	MessageRole,
	SentimentLabel,
	IssueSeverity,
	ConversationStatus,
	ImprovementCategory,
	WeaknessCategory,

	// Records
	MessageRecord,
	ToolCallRecord,
	ConversationRecord,
	DetectedIssue,
	DetectedWeakness,
	DetectedImprovement,
	DetectedError,
	ConversationHistoryState,

	// Query
	ConversationFilter,
	IssueFilter,
	AnalysisSummary,
} from "./types"
