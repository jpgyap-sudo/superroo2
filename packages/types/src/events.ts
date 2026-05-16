import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { modelInfoSchema } from "./model.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * SuperRooEventName
 */

export enum SuperRooEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Query Responses
	CommandsResponse = "commandsResponse",
	ModesResponse = "modesResponse",
	ModelsResponse = "modelsResponse",

	// Evals
	EvalPass = "evalPass",
	EvalFail = "evalFail",
}

/**
 * SuperRooEvents
 */

export const rooCodeEventsSchema = z.object({
	[SuperRooEventName.TaskCreated]: z.tuple([z.string()]),

	[SuperRooEventName.TaskStarted]: z.tuple([z.string()]),
	[SuperRooEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[SuperRooEventName.TaskAborted]: z.tuple([z.string()]),
	[SuperRooEventName.TaskFocused]: z.tuple([z.string()]),
	[SuperRooEventName.TaskUnfocused]: z.tuple([z.string()]),
	[SuperRooEventName.TaskActive]: z.tuple([z.string()]),
	[SuperRooEventName.TaskInteractive]: z.tuple([z.string()]),
	[SuperRooEventName.TaskResumable]: z.tuple([z.string()]),
	[SuperRooEventName.TaskIdle]: z.tuple([z.string()]),

	[SuperRooEventName.TaskPaused]: z.tuple([z.string()]),
	[SuperRooEventName.TaskUnpaused]: z.tuple([z.string()]),
	[SuperRooEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[SuperRooEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[SuperRooEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[SuperRooEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[SuperRooEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[SuperRooEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[SuperRooEventName.TaskAskResponded]: z.tuple([z.string()]),
	[SuperRooEventName.TaskUserMessage]: z.tuple([z.string()]),
	[SuperRooEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[SuperRooEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[SuperRooEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[SuperRooEventName.ModeChanged]: z.tuple([z.string()]),
	[SuperRooEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),

	[SuperRooEventName.CommandsResponse]: z.tuple([
		z.array(
			z.object({
				name: z.string(),
				source: z.enum(["global", "project", "built-in"]),
				filePath: z.string().optional(),
				description: z.string().optional(),
				argumentHint: z.string().optional(),
			}),
		),
	]),
	[SuperRooEventName.ModesResponse]: z.tuple([z.array(z.object({ slug: z.string(), name: z.string() }))]),
	[SuperRooEventName.ModelsResponse]: z.tuple([z.record(z.string(), modelInfoSchema)]),
})

export type SuperRooEvents = z.infer<typeof rooCodeEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(SuperRooEventName.TaskCreated),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(SuperRooEventName.TaskStarted),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskCompleted),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskAborted),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskFocused),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskUnfocused),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskActive),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskInteractive),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskResumable),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskIdle),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(SuperRooEventName.TaskPaused),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskUnpaused),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskSpawned),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskDelegated),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskDelegationCompleted),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskDelegationResumed),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(SuperRooEventName.Message),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskModeSwitched),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskAskResponded),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.QueuedMessagesUpdated),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(SuperRooEventName.TaskToolFailed),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.TaskTokenUsageUpdated),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Query Responses
	z.object({
		eventName: z.literal(SuperRooEventName.CommandsResponse),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.CommandsResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.ModesResponse),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.ModesResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.ModelsResponse),
		payload: rooCodeEventsSchema.shape[SuperRooEventName.ModelsResponse],
		taskId: z.number().optional(),
	}),

	// Evals
	z.object({
		eventName: z.literal(SuperRooEventName.EvalPass),
		payload: z.undefined(),
		taskId: z.number(),
	}),
	z.object({
		eventName: z.literal(SuperRooEventName.EvalFail),
		payload: z.undefined(),
		taskId: z.number(),
	}),
])

export type TaskEvent = z.infer<typeof taskEventSchema>
