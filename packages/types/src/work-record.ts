import { z } from "zod"

/**
 * WorkRecord — structured work artifacts extracted from a task's execution.
 *
 * Unlike raw chat history, a WorkRecord captures the *outcome* of a task
 * in a format that is useful as a persistent work artifact.
 */

export const fileChangeSchema = z.object({
	path: z.string(),
	operation: z.enum(["create", "update", "delete", "patch"]),
	ts: z.number(),
})

export type FileChange = z.infer<typeof fileChangeSchema>

export const commandRunSchema = z.object({
	command: z.string(),
	exitCode: z.number().optional(),
	ts: z.number(),
})

export type CommandRun = z.infer<typeof commandRunSchema>

export const checkpointRecordSchema = z.object({
	hash: z.string(),
	ts: z.number(),
})

export type CheckpointRecord = z.infer<typeof checkpointRecordSchema>

export const toolUsageSummarySchema = z.object({
	name: z.string(),
	attempts: z.number(),
	failures: z.number(),
})

export type ToolUsageSummary = z.infer<typeof toolUsageSummarySchema>

export const workRecordSchema = z.object({
	/** Human-readable title derived from the task prompt */
	title: z.string().optional(),
	/** Files that were created, updated, deleted, or patched */
	changedFiles: z.array(fileChangeSchema).optional(),
	/** Terminal commands that were executed */
	commandsRun: z.array(commandRunSchema).optional(),
	/** Checkpoints saved during the task */
	checkpoints: z.array(checkpointRecordSchema).optional(),
	/** Aggregated cost of the task */
	cost: z.number().optional(),
	/** Token usage breakdown */
	tokensIn: z.number().optional(),
	tokensOut: z.number().optional(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	/** Outcome / completion result text */
	outcome: z.string().optional(),
	/** IDs of follow-up subtasks spawned */
	followUpTaskIds: z.array(z.string()).optional(),
	/** Number of follow-up tasks */
	followUpTaskCount: z.number().optional(),
	/** Tool usage statistics */
	toolUsage: z.array(toolUsageSummarySchema).optional(),
	/** ISO timestamp when the work record was generated */
	generatedAt: z.string().optional(),
})

export type WorkRecord = z.infer<typeof workRecordSchema>
