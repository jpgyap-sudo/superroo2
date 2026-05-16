/**
 * SuperRoo — Conversational History Types
 *
 * Defines the JSON schema for tracking all SuperRoo conversations and replies.
 * This is the single source of truth for conversation data used by the
 * monitoring agent to detect errors, weaknesses, and improvement opportunities.
 */

// ─── Core Conversation Types ───────────────────────────────────────────────

/** Source platform of the conversation */
export type ConversationSource = "telegram" | "vscode" | "dashboard" | "cli" | "api" | "unknown"

/** Role of the participant in a message exchange */
export type MessageRole = "user" | "assistant" | "system" | "agent" | "tool"

/** Sentiment analysis result */
export type SentimentLabel = "positive" | "negative" | "neutral" | "frustrated" | "confused"

/** Severity of an issue detected in a conversation */
export type IssueSeverity = "info" | "warning" | "error" | "critical"

/** Status of a conversation record */
export type ConversationStatus = "active" | "completed" | "abandoned" | "failed" | "resolved"

/** Category of improvement suggestion */
export type ImprovementCategory =
	| "response_quality"
	| "error_handling"
	| "performance"
	| "usability"
	| "accuracy"
	| "completeness"
	| "timeliness"
	| "friction_reduction"
	| "telegram_ux"
	| "coding_workflow"
	| "clarification"
	| "other"

/** Category of weakness detected */
export type WeaknessCategory =
	| "misunderstanding"
	| "incomplete_response"
	| "incorrect_answer"
	| "slow_response"
	| "error_prone"
	| "lack_of_context"
	| "poor_formatting"
	| "redundant_question"
	| "telegram_friction"
	| "coding_error"
	| "other"

// ─── Message Record ────────────────────────────────────────────────────────

/** A single message within a conversation */
export interface MessageRecord {
	/** Unique message ID (platform-specific or UUID) */
	id: string
	/** Role of the sender */
	role: MessageRole
	/** The message content */
	content: string
	/** ISO 8601 timestamp */
	timestamp: string
	/** Source platform message ID (e.g., Telegram message_id) */
	platformMessageId?: string | number
	/** ID of the user who sent this message */
	userId?: string
	/** Username of the sender */
	username?: string
	/** Whether this message had an error during processing */
	hadError?: boolean
	/** Error details if hadError is true */
	errorDetails?: string | null
	/** Latency in ms to generate/process this message */
	latencyMs?: number
	/** Token count if available */
	tokenCount?: number
	/** Model used to generate this response (for assistant messages) */
	model?: string
	/** Tool calls made during this message (for assistant messages) */
	toolCalls?: ToolCallRecord[]
}

/** Record of a tool call made during message processing */
export interface ToolCallRecord {
	/** Tool name */
	tool: string
	/** Arguments passed to the tool */
	args: Record<string, unknown>
	/** Whether the tool call succeeded */
	success: boolean
	/** Error message if the tool call failed */
	error?: string
	/** Duration of the tool call in ms */
	durationMs?: number
}

// ─── Conversation Record ───────────────────────────────────────────────────

/** A complete conversation record */
export interface ConversationRecord {
	/** Unique conversation ID */
	id: string
	/** Source platform */
	source: ConversationSource
	/** Platform-specific chat/conversation ID */
	chatId: string | number
	/** Conversation title or first message summary */
	title: string
	/** Status of the conversation */
	status: ConversationStatus
	/** ISO 8601 timestamp when conversation started */
	startedAt: string
	/** ISO 8601 timestamp when conversation last updated */
	updatedAt: string
	/** ISO 8601 timestamp when conversation ended (if applicable) */
	endedAt?: string
	/** All messages in the conversation */
	messages: MessageRecord[]
	/** Total message count */
	messageCount: number
	/** Total token count across all messages */
	totalTokens?: number
	/** Total latency in ms across all assistant messages */
	totalLatencyMs?: number
	/** User ID of the primary participant */
	userId?: string
	/** Username of the primary participant */
	username?: string
	/** Project context if known */
	projectId?: string
	/** Project name if known */
	projectName?: string
	/** Tags for categorization */
	tags?: string[]
	/** Metadata key-value pairs */
	metadata?: Record<string, unknown>
}

// ─── Analysis Types ────────────────────────────────────────────────────────

/** An issue detected during conversation analysis */
export interface DetectedIssue {
	/** Unique issue ID */
	id: string
	/** Conversation ID this issue belongs to */
	conversationId: string
	/** Severity of the issue */
	severity: IssueSeverity
	/** Category of the issue */
	category: WeaknessCategory | ImprovementCategory
	/** Short description of the issue */
	title: string
	/** Detailed description */
	description: string
	/** The message ID(s) where the issue occurred */
	messageIds: string[]
	/** Suggested fix or improvement */
	suggestion?: string
	/** ISO 8601 timestamp when detected */
	detectedAt: string
	/** Whether this issue has been addressed */
	resolved: boolean
	/** ISO 8601 timestamp when resolved */
	resolvedAt?: string
}

/** A detected weakness in the system's responses */
export interface DetectedWeakness extends DetectedIssue {
	category: WeaknessCategory
}

/** A detected improvement opportunity */
export interface DetectedImprovement extends DetectedIssue {
	category: ImprovementCategory
	/** Priority score 0-100 */
	priority: number
	/** Estimated effort: low/medium/high */
	estimatedEffort: "low" | "medium" | "high"
}

/** An error detected during conversation processing */
export interface DetectedError {
	/** Unique error ID */
	id: string
	/** Conversation ID */
	conversationId: string
	/** Message ID where the error occurred */
	messageId: string
	/** Error type/class */
	errorType: string
	/** Error message */
	errorMessage: string
	/** Stack trace if available */
	stackTrace?: string
	/** ISO 8601 timestamp */
	timestamp: string
	/** Whether this error has been resolved */
	resolved: boolean
	/** Root cause if identified */
	rootCause?: string
}

// ─── Monitoring State ──────────────────────────────────────────────────────

/** Complete monitoring state persisted as JSON */
export interface ConversationHistoryState {
	/** Schema version for migration support */
	schemaVersion: number
	/** All conversations indexed by ID */
	conversations: Record<string, ConversationRecord>
	/** All detected issues indexed by ID */
	issues: Record<string, DetectedIssue>
	/** All detected errors indexed by ID */
	errors: Record<string, DetectedError>
	/** All detected weaknesses indexed by ID */
	weaknesses: Record<string, DetectedWeakness>
	/** All detected improvements indexed by ID */
	improvements: Record<string, DetectedImprovement>
	/** Monitoring agent metadata */
	monitor: {
		/** Last analysis run timestamp */
		lastAnalysisAt: string | null
		/** Total analysis runs */
		totalRuns: number
		/** Total issues detected */
		totalIssuesDetected: number
		/** Total issues resolved */
		totalIssuesResolved: number
		/** Total errors detected */
		totalErrorsDetected: number
		/** Total improvements suggested */
		totalImprovementsSuggested: number
		/** Total improvements implemented */
		totalImprovementsImplemented: number
		/** Agent version */
		agentVersion: string
	}
	/** ISO 8601 timestamp of last update */
	lastUpdatedAt: string
}

// ─── Query Types ───────────────────────────────────────────────────────────

/** Filter options for querying conversations */
export interface ConversationFilter {
	source?: ConversationSource
	status?: ConversationStatus
	userId?: string
	projectId?: string
	tags?: string[]
	startDate?: string
	endDate?: string
	limit?: number
	offset?: number
}

/** Filter options for querying issues */
export interface IssueFilter {
	severity?: IssueSeverity
	category?: WeaknessCategory | ImprovementCategory
	resolved?: boolean
	conversationId?: string
	startDate?: string
	endDate?: string
	limit?: number
	offset?: number
}

/** Analysis summary for a time period */
export interface AnalysisSummary {
	periodStart: string
	periodEnd: string
	totalConversations: number
	totalMessages: number
	totalErrors: number
	totalWeaknesses: number
	totalImprovements: number
	topWeaknesses: Array<{ category: WeaknessCategory; count: number }>
	topImprovements: Array<{ category: ImprovementCategory; count: number }>
	topFrictionPoints: string[]
	telegramFrictionScore: number // 0-100, higher = more friction
	codingFrictionScore: number // 0-100, higher = more friction
	recommendations: string[]
}
