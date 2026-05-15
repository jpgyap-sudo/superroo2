/**
 * Part 2: Complete the OpenAPI spec — remaining route groups
 * Run: node generate-openapi.js (after merging)
 */

// ─── Helper to merge part2 into the main spec ───
const fs = require("fs")

// Load the main spec object from the generated JSON
// We'll read the part1 output, add routes, then write final

function loadSpec() {
	// If openapi.json already exists from part1, load it
	if (fs.existsSync("openapi.json")) {
		return JSON.parse(fs.readFileSync("openapi.json", "utf8"))
	}
	return null
}

const s = loadSpec()
if (!s) {
	console.error("Run generate-openapi.js first to produce openapi.json")
	process.exit(1)
}

// ─── Helper functions (same as part1) ───
function jr(desc, schema) {
	return { 200: { description: desc, content: { "application/json": { schema } } } }
}
function ok(schema) {
	return jr("OK", schema)
}
function bp() {
	return {
		name: "Authorization",
		in: "header",
		required: true,
		schema: { type: "string", pattern: "^Bearer " },
		description: "Bearer token from /auth/login",
	}
}
function pp(name, desc) {
	return { name, in: "path", required: true, schema: { type: "string" }, description: desc || name }
}
function qp(name, schema, desc) {
	return { name, in: "query", schema, description: desc || name }
}

// ═══════════════════════════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════════════════════════

s.paths["/telegram/notify"] = {
	post: {
		tags: ["Telegram"],
		summary: "Send Telegram notification",
		operationId: "sendTelegramNotify",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["chatId", "type", "taskId"],
						properties: {
							chatId: { type: "string" },
							type: { type: "string", enum: ["approval", "deploy", "error", "info"] },
							taskId: { type: "string" },
							message: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Notification sent" } },
	},
}

s.paths["/telegram/tasks"] = {
	get: {
		tags: ["Telegram"],
		summary: "List Telegram bot tasks",
		operationId: "listTelegramTasks",
		responses: ok({
			type: "object",
			properties: { success: { type: "boolean" }, tasks: { type: "array", items: { type: "object" } } },
		}),
	},
	post: {
		tags: ["Telegram"],
		summary: "Create a Telegram coding task",
		operationId: "createTelegramTask",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["instruction"],
						properties: {
							instruction: { type: "string" },
							chatId: { type: "string" },
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Task created" } },
	},
}

s.paths["/telegram/tasks/{id}/approve"] = {
	post: {
		tags: ["Telegram"],
		summary: "Approve a Telegram task",
		operationId: "approveTelegramTask",
		parameters: [pp("id", "Task ID")],
		responses: { 200: { description: "Task approved" } },
	},
}

s.paths["/telegram/tasks/{id}/reject"] = {
	post: {
		tags: ["Telegram"],
		summary: "Reject a Telegram task",
		operationId: "rejectTelegramTask",
		parameters: [pp("id", "Task ID")],
		responses: { 200: { description: "Task rejected" } },
	},
}

s.paths["/telegram/tasks/{id}/diff"] = {
	get: {
		tags: ["Telegram"],
		summary: "Get task diff",
		operationId: "getTelegramTaskDiff",
		parameters: [pp("id", "Task ID")],
		responses: { 200: { description: "Task diff" } },
	},
}

s.paths["/telegram/deploy"] = {
	post: {
		tags: ["Telegram"],
		summary: "Deploy via Telegram",
		operationId: "telegramDeploy",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							taskId: { type: "string" },
							environment: { type: "string", enum: ["staging", "production"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Deploy started" } },
	},
}

s.paths["/telegram/deployments"] = {
	get: {
		tags: ["Telegram"],
		summary: "List Telegram deployments",
		operationId: "listTelegramDeployments",
		responses: { 200: { description: "Deployment list" } },
	},
}

s.paths["/telegram/savepoints"] = {
	get: {
		tags: ["Telegram"],
		summary: "List Telegram savepoints",
		operationId: "listTelegramSavepoints",
		responses: { 200: { description: "Savepoint list" } },
	},
}

s.paths["/telegram/rollback"] = {
	post: {
		tags: ["Telegram"],
		summary: "Rollback via Telegram",
		operationId: "telegramRollback",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							savepointId: { type: "string" },
							taskId: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Rollback result" } },
	},
}

s.paths["/telegram/agents"] = {
	get: {
		tags: ["Telegram"],
		summary: "List Telegram agents",
		operationId: "listTelegramAgents",
		responses: { 200: { description: "Agent list" } },
	},
}

s.paths["/telegram/logs"] = {
	get: {
		tags: ["Telegram"],
		summary: "Get Telegram logs",
		operationId: "getTelegramLogs",
		parameters: [qp("limit", { type: "integer", default: 50 }), qp("target", { type: "string" })],
		responses: { 200: { description: "Log entries" } },
	},
}

s.paths["/telegram/consult"] = {
	post: {
		tags: ["Telegram"],
		summary: "Consult AI via Telegram",
		operationId: "telegramConsult",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							text: { type: "string" },
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Consultation result" } },
	},
}

s.paths["/telegram/debug"] = {
	post: {
		tags: ["Telegram"],
		summary: "Debug via Telegram",
		operationId: "telegramDebug",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							text: { type: "string" },
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Debug plan" } },
	},
}

s.paths["/telegram/read-logs"] = {
	post: {
		tags: ["Telegram"],
		summary: "Read logs via Telegram",
		operationId: "telegramReadLogs",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							target: { type: "string" },
							lines: { type: "integer" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Log output" } },
	},
}

s.paths["/telegram/run-tests"] = {
	post: {
		tags: ["Telegram"],
		summary: "Run tests via Telegram",
		operationId: "telegramRunTests",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Test results" } },
	},
}

s.paths["/telegram/create-branch"] = {
	post: {
		tags: ["Telegram"],
		summary: "Create git branch via Telegram",
		operationId: "telegramCreateBranch",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							branch: { type: "string" },
							baseBranch: { type: "string" },
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Branch created" } },
	},
}

s.paths["/telegram/commit-and-push"] = {
	post: {
		tags: ["Telegram"],
		summary: "Commit and push via Telegram",
		operationId: "telegramCommitAndPush",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: { type: "string" },
							branch: { type: "string" },
							project: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Commit result" } },
	},
}

s.paths["/telegram/restart-worker"] = {
	post: {
		tags: ["Telegram"],
		summary: "Restart worker via Telegram",
		operationId: "telegramRestartWorker",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							worker: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Worker restart result" } },
	},
}

s.paths["/telegram/extend-session"] = {
	post: {
		tags: ["Telegram"],
		summary: "Extend Telegram session",
		operationId: "extendTelegramSession",
		parameters: [bp()],
		responses: { 200: { description: "Session extended" } },
	},
}

s.paths["/telegram/webhook"] = {
	post: {
		tags: ["Telegram"],
		summary: "Telegram bot webhook receiver",
		operationId: "telegramWebhook",
		responses: { 200: { description: "Webhook acknowledged" } },
	},
}

s.paths["/telegram/webhook-info"] = {
	get: {
		tags: ["Telegram"],
		summary: "Get webhook info",
		operationId: "getTelegramWebhookInfo",
		responses: { 200: { description: "Webhook info" } },
	},
}

s.paths["/telegram/set-webhook"] = {
	post: {
		tags: ["Telegram"],
		summary: "Set webhook URL",
		operationId: "setTelegramWebhook",
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { url: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Webhook set" } },
	},
}

s.paths["/telegram/test-message"] = {
	post: {
		tags: ["Telegram"],
		summary: "Send test Telegram message",
		operationId: "sendTelegramTestMessage",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { chatId: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Test message sent" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// TERMINAL BRAIN
// ═══════════════════════════════════════════════════════════════════

s.paths["/terminal-brain/{action}"] = {
	get: {
		tags: ["Terminal Brain"],
		summary: "Get terminal brain data (context/memory/stats)",
		operationId: "getTerminalBrain",
		parameters: [bp(), pp("action", "Action: context, memory, or stats")],
		responses: { 200: { description: "Terminal brain data" } },
	},
	post: {
		tags: ["Terminal Brain"],
		summary: "Execute terminal brain action (plan/execute/analyze/fix/process)",
		operationId: "postTerminalBrain",
		parameters: [bp(), pp("action", "Action: plan, execute, analyze, fix, or process")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							query: { type: "string" },
							command: { type: "string" },
							output: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Action result" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// IDE WORKSPACE
// ═══════════════════════════════════════════════════════════════════

s.paths["/ide/workspace"] = {
	get: {
		tags: ["IDE Workspace"],
		summary: "Get workspace state",
		operationId: "getWorkspace",
		responses: { 200: { description: "Workspace state" } },
	},
	post: {
		tags: ["IDE Workspace"],
		summary: "Reset workspace",
		operationId: "resetWorkspace",
		responses: { 200: { description: "Workspace reset" } },
	},
}

s.paths["/ide/terminal/exec"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Execute terminal command",
		operationId: "execTerminalCommand",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["command"],
						properties: {
							command: { type: "string" },
							cwd: { type: "string" },
							terminalId: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Command output" } },
	},
}

s.paths["/ide/terminal/create"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Create terminal session",
		operationId: "createTerminal",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							cwd: { type: "string" },
							name: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Terminal created" } },
	},
}

s.paths["/ide/terminal/resize"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Resize terminal",
		operationId: "resizeTerminal",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							terminalId: { type: "string" },
							cols: { type: "integer" },
							rows: { type: "integer" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Terminal resized" } },
	},
}

s.paths["/ide/file/read"] = {
	get: {
		tags: ["IDE Workspace"],
		summary: "Read file from workspace",
		operationId: "readWorkspaceFile",
		parameters: [bp(), qp("path", { type: "string" }, "File path relative to workspace")],
		responses: { 200: { description: "File content" } },
	},
}

s.paths["/ide/file/write"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Write file to workspace",
		operationId: "writeWorkspaceFile",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["path", "content"],
						properties: {
							path: { type: "string" },
							content: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "File written" } },
	},
}

s.paths["/ide/file/diff"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Compute file diff",
		operationId: "computeFileDiff",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["original", "modified"],
						properties: {
							original: { type: "string" },
							modified: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Diff result" } },
	},
}

s.paths["/ide/file/create"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Create file in workspace",
		operationId: "createWorkspaceFile",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["path", "content"],
						properties: {
							path: { type: "string" },
							content: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "File created" } },
	},
}

s.paths["/ide/git/import"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Import git repository",
		operationId: "importGitRepo",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["repoUrl"],
						properties: {
							repoUrl: { type: "string" },
							branch: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Import result" } },
	},
}

s.paths["/ide/pipeline"] = {
	get: {
		tags: ["IDE Workspace"],
		summary: "Get pipeline state",
		operationId: "getPipeline",
		responses: { 200: { description: "Pipeline state" } },
	},
	post: {
		tags: ["IDE Workspace"],
		summary: "Update pipeline stage",
		operationId: "updatePipeline",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							stage: { type: "string" },
							status: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Pipeline updated" } },
	},
}

s.paths["/ide/providers"] = {
	get: {
		tags: ["IDE Workspace"],
		summary: "List IDE providers",
		operationId: "listIdeProviders",
		responses: { 200: { description: "Provider list" } },
	},
}

s.paths["/ide/chat/send"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Send chat message",
		operationId: "sendChatMessage",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["message"],
						properties: {
							message: { type: "string" },
							sessionId: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Chat response" } },
	},
}

s.paths["/ide/chat/stream"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Stream chat response",
		operationId: "streamChatMessage",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["message"],
						properties: {
							message: { type: "string" },
							sessionId: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Streaming response (SSE)" } },
	},
}

s.paths["/ide/chat/history"] = {
	get: {
		tags: ["IDE Workspace"],
		summary: "Get chat history",
		operationId: "getChatHistory",
		parameters: [bp(), qp("sessionId", { type: "string" }, "Session ID")],
		responses: { 200: { description: "Chat history" } },
	},
}

s.paths["/ide/chat/clear"] = {
	post: {
		tags: ["IDE Workspace"],
		summary: "Clear chat history",
		operationId: "clearChatHistory",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { sessionId: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Chat cleared" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

s.paths["/orchestrator/status"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get orchestrator status",
		operationId: "getOrchestratorStatus",
		responses: { 200: { description: "Orchestrator status" } },
	},
}

s.paths["/orchestrator/submit"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Submit task to orchestrator",
		operationId: "submitOrchestratorTask",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["type", "input"],
						properties: {
							type: { type: "string" },
							input: { type: "object" },
							metadata: { type: "object" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Task submitted" } },
	},
}

s.paths["/orchestrator/tasks"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List orchestrator tasks",
		operationId: "listOrchestratorTasks",
		parameters: [
			qp("status", { type: "string" }),
			qp("type", { type: "string" }),
			qp("limit", { type: "integer", default: 20 }),
		],
		responses: { 200: { description: "Task list" } },
	},
}

s.paths["/orchestrator/tasks/{id}"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get task details",
		operationId: "getOrchestratorTask",
		parameters: [pp("id", "Task ID")],
		responses: { 200: { description: "Task details" } },
	},
}

s.paths["/orchestrator/tasks/{id}/complete"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Complete a task",
		operationId: "completeOrchestratorTask",
		parameters: [pp("id", "Task ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { output: { type: "object" } },
					},
				},
			},
		},
		responses: { 200: { description: "Task completed" } },
	},
}

s.paths["/orchestrator/tasks/{id}/fail"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Fail a task",
		operationId: "failOrchestratorTask",
		parameters: [pp("id", "Task ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { error: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Task failed" } },
	},
}

s.paths["/orchestrator/events"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List orchestrator events",
		operationId: "listOrchestratorEvents",
		parameters: [
			qp("type", { type: "string" }),
			qp("source", { type: "string" }),
			qp("severity", { type: "string" }),
			qp("limit", { type: "integer", default: 50 }),
		],
		responses: { 200: { description: "Event list" } },
	},
}

s.paths["/orchestrator/mode"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get orchestrator mode",
		operationId: "getOrchestratorMode",
		responses: { 200: { description: "Current mode" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Set orchestrator mode",
		operationId: "setOrchestratorMode",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["mode"],
						properties: {
							mode: { type: "string", enum: ["manual", "semi-automatic", "automatic"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Mode set" } },
	},
}

s.paths["/orchestrator/telegram-bridge"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get Telegram bridge stats",
		operationId: "getTelegramBridgeStats",
		responses: { 200: { description: "Bridge stats" } },
	},
}

s.paths["/orchestrator/safety/check"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Check safety constraints",
		operationId: "checkSafety",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							command: { type: "string" },
							path: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Safety check result" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// AGENT REGISTRY
// ═══════════════════════════════════════════════════════════════════

s.paths["/registry/agents"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List registered agents",
		operationId: "listRegisteredAgents",
		responses: { 200: { description: "Agent list" } },
	},
}

s.paths["/registry/agents/{id}"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get registered agent",
		operationId: "getRegisteredAgent",
		parameters: [pp("id", "Agent ID")],
		responses: { 200: { description: "Agent details" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Toggle agent enabled",
		operationId: "toggleRegisteredAgent",
		parameters: [pp("id", "Agent ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { enabled: { type: "boolean" } },
					},
				},
			},
		},
		responses: { 200: { description: "Agent toggled" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE REGISTRY
// ═══════════════════════════════════════════════════════════════════

s.paths["/registry/features"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List features",
		operationId: "listFeatures",
		parameters: [qp("status", { type: "string" }), qp("health", { type: "string" })],
		responses: { 200: { description: "Feature list" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Create feature",
		operationId: "createFeature",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["name"],
						properties: {
							name: { type: "string" },
							description: { type: "string" },
							status: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Feature created" } },
	},
}

s.paths["/registry/features/{id}"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get feature",
		operationId: "getFeature",
		parameters: [pp("id", "Feature ID")],
		responses: { 200: { description: "Feature details" } },
	},
	put: {
		tags: ["Orchestrator"],
		summary: "Update feature",
		operationId: "updateFeature",
		parameters: [pp("id", "Feature ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							name: { type: "string" },
							status: { type: "string" },
							health: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Feature updated" } },
	},
	delete: {
		tags: ["Orchestrator"],
		summary: "Delete feature",
		operationId: "deleteFeature",
		parameters: [pp("id", "Feature ID")],
		responses: { 200: { description: "Feature deleted" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// BUG REGISTRY
// ═══════════════════════════════════════════════════════════════════

s.paths["/registry/bugs"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List bugs",
		operationId: "listBugs",
		parameters: [
			qp("status", { type: "string" }),
			qp("severity", { type: "string" }),
			qp("featureId", { type: "string" }),
			qp("limit", { type: "integer", default: 50 }),
		],
		responses: { 200: { description: "Bug list" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Report bug",
		operationId: "reportBug",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["title", "severity"],
						properties: {
							title: { type: "string" },
							description: { type: "string" },
							severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
							featureId: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Bug reported" } },
	},
}

s.paths["/registry/bugs/{id}"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get bug",
		operationId: "getBug",
		parameters: [pp("id", "Bug ID")],
		responses: { 200: { description: "Bug details" } },
	},
	put: {
		tags: ["Orchestrator"],
		summary: "Update bug",
		operationId: "updateBug",
		parameters: [pp("id", "Bug ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							title: { type: "string" },
							status: { type: "string" },
							severity: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Bug updated" } },
	},
}

s.paths["/registry/bugs/{id}/fix"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Record bug fix",
		operationId: "recordBugFix",
		parameters: [pp("id", "Bug ID")],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["description"],
						properties: {
							description: { type: "string" },
							commitSha: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Fix recorded" } },
	},
}

s.paths["/registry/bugs/{id}/fixes"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List bug fixes",
		operationId: "listBugFixes",
		parameters: [pp("id", "Bug ID")],
		responses: { 200: { description: "Fix list" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// COMMIT / DEPLOY LOG
// ═══════════════════════════════════════════════════════════════════

s.paths["/commit-deploy-log/commits"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List commits",
		operationId: "listCommits",
		parameters: [
			qp("agent", { type: "string" }),
			qp("type", { type: "string" }),
			qp("limit", { type: "integer", default: 20 }),
		],
		responses: { 200: { description: "Commit list" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Record commit",
		operationId: "recordCommit",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["sha", "agent", "type", "title"],
						properties: {
							sha: { type: "string" },
							agent: { type: "string" },
							type: {
								type: "string",
								enum: ["feature", "bugfix", "refactor", "docs", "config", "test", "deploy", "other"],
							},
							title: { type: "string" },
							filesChanged: { type: "array", items: { type: "string" } },
							featuresAffected: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Commit recorded" } },
	},
}

s.paths["/commit-deploy-log/deploys"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List deploys",
		operationId: "listDeploys",
		parameters: [
			qp("version", { type: "string" }),
			qp("agent", { type: "string" }),
			qp("limit", { type: "integer", default: 20 }),
		],
		responses: { 200: { description: "Deploy list" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Record deploy",
		operationId: "recordDeploy",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["version", "sha", "agent"],
						properties: {
							version: { type: "string" },
							sha: { type: "string" },
							agent: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Deploy recorded" } },
	},
}

s.paths["/commit-deploy-log/deploys/{id}/status"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Update deploy status",
		operationId: "updateDeployStatus",
		parameters: [pp("id", "Deploy ID"), bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["result"],
						properties: {
							result: { type: "string", enum: ["healthy", "unhealthy", "rolled_back", "failed"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Status updated" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ═══════════════════════════════════════════════════════════════════

fs.writeFileSync("openapi.json", JSON.stringify(s, null, 2))
console.log(`✅ openapi.json generated with ${Object.keys(s.paths).length} paths (part2 merged)`)
