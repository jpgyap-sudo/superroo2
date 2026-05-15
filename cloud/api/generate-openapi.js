/**
 * OpenAPI Specification Generator for SuperRoo Cloud API
 * Run: node generate-openapi.js
 * Output: openapi.json
 */
const fs = require("fs")

function jr(desc, schema) {
	return { description: desc, content: { "application/json": { schema } } }
}
function ok(schema) {
	return { 200: jr("Success", schema) }
}
function bp() {
	return {
		name: "Authorization",
		in: "header",
		required: true,
		schema: { type: "string" },
		description: "Bearer <token>",
	}
}
function pp(name, desc) {
	return { name, in: "path", required: true, schema: { type: "string" }, description: desc || "" }
}
function qp(name, schema, desc) {
	return { name, in: "query", schema, description: desc }
}

const s = {
	openapi: "3.0.3",
	info: {
		title: "SuperRoo Cloud API",
		description:
			"RESTful API for the SuperRoo Cloud Dashboard — job queue management, agent orchestration, Telegram bot integration, ML engine sync, multi-tenant organizations, monitoring, and IDE workspace management.\n\nBase URL: http://<host>:8787\n\nAll endpoints are also accessible with an /api prefix (e.g., /api/health).\n\n## Authentication\n\nMost endpoints require a Bearer token obtained from POST /auth/login or POST /auth/register.\n\n```\nAuthorization: Bearer <session_token>\n```\n\n## WebSocket Endpoints\n\n- `/api/ws/chat?sessionId=<id>` — AI Chat\n- `/api/ws/lsp?lang=<language>` — LSP Bridge (IntelliSense)\n- `/api/ws/telegram` — Telegram Bot real-time events\n- `/api/ws/dashboard` — Dashboard real-time updates",
		version: "1.0.0",
		contact: { name: "SuperRoo Team", url: "https://github.com/superroo" },
	},
	servers: [
		{ url: "http://localhost:8787", description: "Local development" },
		{ url: "http://104.248.225.250:8787", description: "Production VPS" },
	],
	tags: [
		{ name: "Health", description: "System health and status endpoints" },
		{ name: "Auth", description: "Authentication and user management" },
		{ name: "Jobs", description: "Job queue management" },
		{ name: "Agents", description: "Agent runtime management" },
		{ name: "Approvals", description: "Approval workflow management" },
		{ name: "Telegram", description: "Telegram bot integration" },
		{ name: "Providers", description: "AI provider and API key management" },
		{ name: "Model Router", description: "Model routing and fallback configuration" },
		{ name: "Settings", description: "Application settings and guardrails" },
		{ name: "Dashboard", description: "Dashboard aggregation endpoints" },
		{ name: "Tenants", description: "Multi-tenant organization management" },
		{ name: "Terminal Brain", description: "Terminal intelligence and automation" },
		{ name: "IDE Workspace", description: "Cloud IDE workspace management" },
		{ name: "Orchestrator", description: "Cloud Orchestrator task lifecycle" },
		{ name: "ML Engine", description: "ML model sync and training" },
		{ name: "Monitoring", description: "System monitoring and alerting" },
		{ name: "Healing", description: "Self-healing metrics and incidents" },
		{ name: "Auto Deploy", description: "Automated deployment pipeline" },
		{ name: "Autonomous", description: "Autonomous improvement loop" },
		{ name: "Commissioning", description: "System commissioning" },
		{ name: "Vision", description: "Image and document analysis" },
		{ name: "API Docs", description: "API documentation endpoints" },
	],
	paths: {},
	components: {
		schemas: {
			Job: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					status: { type: "string", enum: ["waiting", "active", "completed", "failed", "delayed"] },
					data: { type: "object" },
					progress: { type: "number" },
					attemptsMade: { type: "integer" },
					timestamp: { type: "number" },
					processedOn: { type: "number" },
					finishedOn: { type: "number" },
					returnvalue: { type: "object" },
					failedReason: { type: "string" },
					stacktrace: { type: "array", items: { type: "string" } },
				},
			},
			Error: {
				type: "object",
				properties: {
					success: { type: "boolean", example: false },
					error: { type: "string" },
					detail: { type: "string" },
				},
			},
		},
	},
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════

s.paths["/health"] = {
	get: {
		tags: ["Health"],
		summary: "Health check",
		description:
			"Returns the current health status of the API server, Redis connection, worker status, and orchestrator state.",
		operationId: "healthCheck",
		responses: ok({
			type: "object",
			properties: {
				status: { type: "string", example: "online" },
				redis: { type: "boolean" },
				worker: { type: "boolean" },
				orchestrator: {
					type: "object",
					properties: {
						running: { type: "boolean" },
						mode: { type: "string" },
						uptime: { type: "number" },
						modules: { type: "array", items: { type: "string" } },
						taskStats: { type: "object" },
					},
				},
			},
		}),
	},
}

s.paths["/system"] = {
	get: {
		tags: ["Health"],
		summary: "System statistics",
		description: "Returns CPU, memory, and disk usage statistics for the host machine.",
		operationId: "getSystemStats",
		responses: ok({
			type: "object",
			properties: {
				cpu: { type: "object", properties: { load: { type: "number" }, cores: { type: "number" } } },
				memory: {
					type: "object",
					properties: {
						total: { type: "number" },
						free: { type: "number" },
						used: { type: "number" },
						usagePercent: { type: "number" },
					},
				},
				disk: {
					type: "object",
					properties: {
						total: { type: "number" },
						free: { type: "number" },
						used: { type: "number" },
						usagePercent: { type: "number" },
					},
				},
				uptime: { type: "number" },
			},
		}),
	},
}

s.paths["/docker/status"] = {
	get: {
		tags: ["Health"],
		summary: "Docker status",
		description: "Returns Docker container and image statistics.",
		operationId: "getDockerStats",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				containers: {
					type: "object",
					properties: { total: { type: "number" }, running: { type: "number" }, stopped: { type: "number" } },
				},
				images: { type: "number" },
			},
		}),
	},
}

s.paths["/logs"] = {
	get: {
		tags: ["Health"],
		summary: "Get API logs",
		description: "Returns recent API log entries with optional filtering.",
		operationId: "getLogs",
		parameters: [
			qp("limit", { type: "integer", default: 50 }, "Number of log entries to return"),
			qp("target", { type: "string" }, "Filter by log target/source"),
		],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				logs: { type: "array", items: { type: "object" } },
			},
		}),
	},
}

// ═══════════════════════════════════════════════════════════════════
// QUEUE / JOBS
// ═══════════════════════════════════════════════════════════════════

s.paths["/queue/stats"] = {
	get: {
		tags: ["Jobs"],
		summary: "Queue statistics",
		description: "Returns BullMQ queue job counts by status.",
		operationId: "getQueueStats",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				waiting: { type: "number" },
				active: { type: "number" },
				completed: { type: "number" },
				failed: { type: "number" },
				delayed: { type: "number" },
				total: { type: "number" },
			},
		}),
	},
}

s.paths["/jobs/summary"] = {
	get: {
		tags: ["Jobs"],
		summary: "Jobs summary",
		description: "Returns aggregated job statistics including success rate.",
		operationId: "getJobsSummary",
		responses: ok({
			type: "object",
			properties: {
				totalJobs: { type: "number" },
				running: { type: "number" },
				completed: { type: "number" },
				failed: { type: "number" },
				queued: { type: "number" },
				successRate: { type: "number" },
			},
		}),
	},
}

s.paths["/jobs"] = {
	get: {
		tags: ["Jobs"],
		summary: "List jobs",
		description: "Returns a list of recent jobs with optional status filtering.",
		operationId: "listJobs",
		parameters: [
			qp(
				"status",
				{ type: "string", enum: ["waiting", "active", "completed", "failed", "delayed"] },
				"Filter by status",
			),
			qp("limit", { type: "integer", default: 20 }, "Max results"),
			qp("offset", { type: "integer", default: 0 }, "Pagination offset"),
		],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } },
				total: { type: "number" },
			},
		}),
	},
}

s.paths["/jobs/{id}"] = {
	get: {
		tags: ["Jobs"],
		summary: "Get job details",
		operationId: "getJob",
		parameters: [pp("id", "Job ID")],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				job: { $ref: "#/components/schemas/Job" },
			},
		}),
	},
	delete: {
		tags: ["Jobs"],
		summary: "Delete a job",
		operationId: "deleteJob",
		parameters: [pp("id", "Job ID")],
		responses: { 200: { description: "Job deleted" } },
	},
}

s.paths["/jobs/{id}/retry"] = {
	post: {
		tags: ["Jobs"],
		summary: "Retry a failed job",
		operationId: "retryJob",
		parameters: [pp("id", "Job ID")],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				jobId: { type: "string" },
			},
		}),
	},
}

// ═══════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════

s.paths["/auth/register"] = {
	post: {
		tags: ["Auth"],
		summary: "Register a new user",
		operationId: "registerUser",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["email", "password"],
						properties: {
							email: { type: "string", format: "email" },
							password: { type: "string", minLength: 6 },
						},
					},
				},
			},
		},
		responses: {
			200: jr("Registration successful", {
				type: "object",
				properties: {
					success: { type: "boolean" },
					token: { type: "string" },
					email: { type: "string" },
				},
			}),
			400: { description: "Invalid input or email already registered" },
		},
	},
}

s.paths["/auth/login"] = {
	post: {
		tags: ["Auth"],
		summary: "Login",
		operationId: "loginUser",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["email", "password"],
						properties: {
							email: { type: "string", format: "email" },
							password: { type: "string" },
						},
					},
				},
			},
		},
		responses: {
			200: jr("Login successful", {
				type: "object",
				properties: {
					success: { type: "boolean" },
					token: { type: "string" },
					email: { type: "string" },
				},
			}),
			401: { description: "Invalid credentials" },
		},
	},
}

s.paths["/auth/verify"] = {
	post: {
		tags: ["Auth"],
		summary: "Verify session token",
		operationId: "verifySession",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["token"],
						properties: { token: { type: "string" } },
					},
				},
			},
		},
		responses: ok({
			type: "object",
			properties: {
				valid: { type: "boolean" },
				email: { type: "string" },
			},
		}),
	},
}

s.paths["/auth/logout"] = {
	post: {
		tags: ["Auth"],
		summary: "Logout",
		operationId: "logoutUser",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["token"],
						properties: { token: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Logged out" } },
	},
}

s.paths["/auth/profile"] = {
	get: {
		tags: ["Auth"],
		summary: "Get user profile",
		operationId: "getProfile",
		parameters: [bp()],
		responses: ok({
			type: "object",
			properties: {
				email: { type: "string" },
				createdAt: { type: "number" },
			},
		}),
	},
}

s.paths["/auth/telegram-login"] = {
	post: {
		tags: ["Auth"],
		summary: "Telegram login",
		description: "Authenticate or register via Telegram init data.",
		operationId: "telegramLogin",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["initData"],
						properties: { initData: { type: "string", description: "Telegram WebApp init data" } },
					},
				},
			},
		},
		responses: { 200: { description: "Telegram login result" } },
	},
}

s.paths["/auth/link-vscode"] = {
	post: {
		tags: ["Auth"],
		summary: "Link VS Code extension device",
		operationId: "linkVscode",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["deviceId"],
						properties: { deviceId: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Device linked" } },
	},
}

s.paths["/auth/task-sync"] = {
	post: {
		tags: ["Auth"],
		summary: "Sync tasks for user",
		operationId: "syncTasks",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							tasks: { type: "array", items: { type: "object" } },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Tasks synced" } },
	},
}

s.paths["/auth/get-tasks"] = {
	get: {
		tags: ["Auth"],
		summary: "Get user tasks",
		operationId: "getTasks",
		parameters: [bp()],
		responses: { 200: { description: "Task list" } },
	},
}

s.paths["/auth/delete-task"] = {
	post: {
		tags: ["Auth"],
		summary: "Delete a user task",
		operationId: "deleteTask",
		parameters: [bp()],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { taskId: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Task deleted" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════════

s.paths["/agents"] = {
	get: {
		tags: ["Agents"],
		summary: "List agents",
		description: "Returns all registered agents with their status.",
		operationId: "listAgents",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				agents: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							enabled: { type: "boolean" },
							status: { type: "string" },
							lastRun: { type: "string" },
						},
					},
				},
			},
		}),
	},
}

s.paths["/agents/{id}"] = {
	get: {
		tags: ["Agents"],
		summary: "Get agent details",
		operationId: "getAgent",
		parameters: [pp("id", "Agent ID")],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				agent: { type: "object" },
			},
		}),
	},
	post: {
		tags: ["Agents"],
		summary: "Toggle agent enabled state",
		operationId: "toggleAgent",
		parameters: [pp("id", "Agent ID")],
		responses: { 200: { description: "Agent toggled" } },
	},
	put: {
		tags: ["Agents"],
		summary: "Update agent enabled state",
		operationId: "updateAgentEnabled",
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
		responses: { 200: { description: "Agent updated" } },
	},
}

s.paths["/agents/{id}/run"] = {
	post: {
		tags: ["Agents"],
		summary: "Run an agent",
		operationId: "runAgent",
		parameters: [pp("id", "Agent ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							task: { type: "string" },
							input: { type: "object" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Agent run result" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════

s.paths["/approvals"] = {
	get: {
		tags: ["Approvals"],
		summary: "List pending approvals",
		operationId: "listApprovals",
		responses: ok({
			type: "object",
			properties: {
				approvals: { type: "array", items: { type: "object" } },
			},
		}),
	},
}

s.paths["/approvals/{id}/approve"] = {
	post: {
		tags: ["Approvals"],
		summary: "Approve a request",
		operationId: "approveRequest",
		parameters: [pp("id", "Approval ID")],
		responses: { 200: { description: "Approved" } },
	},
}

s.paths["/approvals/{id}/reject"] = {
	post: {
		tags: ["Approvals"],
		summary: "Reject a request",
		operationId: "rejectRequest",
		parameters: [pp("id", "Approval ID")],
		responses: { 200: { description: "Rejected" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════════

s.paths["/providers"] = {
	get: {
		tags: ["Providers"],
		summary: "List AI providers",
		operationId: "listProviders",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				providers: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							models: { type: "array", items: { type: "string" } },
							hasKey: { type: "boolean" },
						},
					},
				},
			},
		}),
	},
}

s.paths["/providers/test"] = {
	post: {
		tags: ["Providers"],
		summary: "Test all provider keys",
		operationId: "testAllProviders",
		responses: { 200: { description: "Test results" } },
	},
}

s.paths["/providers/save"] = {
	post: {
		tags: ["Providers"],
		summary: "Save all provider keys",
		operationId: "saveProviders",
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						additionalProperties: { type: "string" },
					},
				},
			},
		},
		responses: { 200: { description: "Keys saved" } },
	},
}

s.paths["/providers/{id}/key"] = {
	get: {
		tags: ["Providers"],
		summary: "Get provider API key (masked)",
		operationId: "getProviderKey",
		parameters: [pp("id", "Provider ID")],
		responses: ok({
			type: "object",
			properties: {
				key: { type: "string", description: "Masked API key" },
			},
		}),
	},
	post: {
		tags: ["Providers"],
		summary: "Test a specific provider key",
		operationId: "testProviderKey",
		parameters: [pp("id", "Provider ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: { apiKey: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Test result" } },
	},
	delete: {
		tags: ["Providers"],
		summary: "Delete a provider API key",
		operationId: "deleteProviderKey",
		parameters: [pp("id", "Provider ID")],
		responses: { 200: { description: "Key deleted" } },
	},
}

s.paths["/providers/{id}"] = {
	put: {
		tags: ["Providers"],
		summary: "Update provider configuration",
		operationId: "updateProvider",
		parameters: [pp("id", "Provider ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							apiBaseUrl: { type: "string" },
							model: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Provider updated" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// MODEL ROUTER
// ═══════════════════════════════════════════════════════════════════

s.paths["/model-router/routes"] = {
	get: {
		tags: ["Model Router"],
		summary: "List model routes",
		operationId: "listModelRoutes",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				routes: { type: "array", items: { type: "object" } },
			},
		}),
	},
	post: {
		tags: ["Model Router"],
		summary: "Create a model route",
		operationId: "createModelRoute",
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							taskType: { type: "string" },
							providerId: { type: "string" },
							model: { type: "string" },
							priority: { type: "integer" },
							fallbacks: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Route created" } },
	},
}

s.paths["/model-router/routes/{id}"] = {
	put: {
		tags: ["Model Router"],
		summary: "Update a model route",
		operationId: "updateModelRoute",
		parameters: [pp("id", "Route ID")],
		responses: { 200: { description: "Route updated" } },
	},
	delete: {
		tags: ["Model Router"],
		summary: "Delete a model route",
		operationId: "deleteModelRoute",
		parameters: [pp("id", "Route ID")],
		responses: { 200: { description: "Route deleted" } },
	},
}

s.paths["/model-router/providers"] = {
	get: {
		tags: ["Model Router"],
		summary: "List available providers for routing",
		operationId: "listRouterProviders",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				providers: { type: "array", items: { type: "object" } },
			},
		}),
	},
}

s.paths["/model-router/fallback"] = {
	get: {
		tags: ["Model Router"],
		summary: "Get fallback configuration",
		operationId: "getFallbackConfig",
		responses: { 200: { description: "Fallback config" } },
	},
	post: {
		tags: ["Model Router"],
		summary: "Set fallback configuration",
		operationId: "setFallbackConfig",
		responses: { 200: { description: "Fallback config updated" } },
	},
}

s.paths["/model-router/usage"] = {
	get: {
		tags: ["Model Router"],
		summary: "Get model usage statistics",
		operationId: "getModelUsage",
		responses: { 200: { description: "Usage stats" } },
	},
}

s.paths["/model-router/fallback-rules"] = {
	get: {
		tags: ["Model Router"],
		summary: "Get fallback rules",
		operationId: "getFallbackRules",
		responses: { 200: { description: "Fallback rules" } },
	},
	patch: {
		tags: ["Model Router"],
		summary: "Update fallback rules",
		operationId: "updateFallbackRules",
		responses: { 200: { description: "Fallback rules updated" } },
	},
}

s.paths["/model-router/safety-rules"] = {
	get: {
		tags: ["Model Router"],
		summary: "Get safety rules",
		operationId: "getSafetyRules",
		responses: { 200: { description: "Safety rules" } },
	},
	patch: {
		tags: ["Model Router"],
		summary: "Update safety rules",
		operationId: "updateSafetyRules",
		responses: { 200: { description: "Safety rules updated" } },
	},
}

s.paths["/model-router/sync-api-keys"] = {
	post: {
		tags: ["Model Router"],
		summary: "Sync API keys from environment to model router",
		operationId: "syncApiKeys",
		responses: { 200: { description: "Keys synced" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════

s.paths["/settings"] = {
	get: {
		tags: ["Settings"],
		summary: "Get application settings",
		operationId: "getSettings",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				settings: {
					type: "object",
					properties: {
						guardrails: { type: "object" },
						autoDeploy: { type: "boolean" },
						maxConcurrentJobs: { type: "integer" },
					},
				},
			},
		}),
	},
	post: {
		tags: ["Settings"],
		summary: "Update application settings",
		operationId: "updateSettings",
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							guardrails: { type: "object" },
							autoDeploy: { type: "boolean" },
							maxConcurrentJobs: { type: "integer" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Settings updated" } },
	},
}

s.paths["/safety/patterns"] = {
	get: {
		tags: ["Settings"],
		summary: "Get safety patterns",
		operationId: "getSafetyPatterns",
		responses: { 200: { description: "Safety patterns" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

s.paths["/dashboard"] = {
	get: {
		tags: ["Dashboard"],
		summary: "Get dashboard data",
		description:
			"Aggregated dashboard data including activity events, health metrics, pipeline stages, and repo status.",
		operationId: "getDashboard",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				data: {
					type: "object",
					properties: {
						activityEvents: { type: "array", items: { type: "object" } },
						healthMetrics: { type: "array", items: { type: "object" } },
						pipelineStages: { type: "array", items: { type: "object" } },
						repoStatus: { type: "object" },
						autonomousTask: { type: "object" },
					},
				},
			},
		}),
	},
}

s.paths["/dashboard/commit-deploy-log"] = {
	get: {
		tags: ["Dashboard"],
		summary: "Get commit and deploy log",
		operationId: "getCommitDeployLog",
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				data: {
					type: "object",
					properties: {
						commits: { type: "array", items: { type: "object" } },
						deploys: { type: "array", items: { type: "object" } },
					},
				},
			},
		}),
	},
}

// ═══════════════════════════════════════════════════════════════════
// TENANTS
// ═══════════════════════════════════════════════════════════════════

s.paths["/tenants"] = {
	get: {
		tags: ["Tenants"],
		summary: "List tenants for current user",
		operationId: "listTenants",
		parameters: [bp()],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				tenants: { type: "array", items: { type: "object" } },
			},
		}),
	},
	post: {
		tags: ["Tenants"],
		summary: "Create a new tenant",
		operationId: "createTenant",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["name", "slug"],
						properties: {
							name: { type: "string" },
							slug: { type: "string" },
							plan: { type: "string", enum: ["free", "pro", "enterprise"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Tenant created" } },
	},
}

s.paths["/tenants/{id}"] = {
	get: {
		tags: ["Tenants"],
		summary: "Get tenant details",
		operationId: "getTenant",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				tenant: { type: "object" },
			},
		}),
	},
	put: {
		tags: ["Tenants"],
		summary: "Update tenant (admin only)",
		operationId: "updateTenant",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: { 200: { description: "Tenant updated" } },
	},
	delete: {
		tags: ["Tenants"],
		summary: "Deactivate tenant (admin only)",
		operationId: "deleteTenant",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: { 200: { description: "Tenant deactivated" } },
	},
}

s.paths["/tenants/{id}/members"] = {
	get: {
		tags: ["Tenants"],
		summary: "List tenant members",
		operationId: "listTenantMembers",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: ok({
			type: "object",
			properties: {
				success: { type: "boolean" },
				members: { type: "array", items: { type: "object" } },
			},
		}),
	},
	post: {
		tags: ["Tenants"],
		summary: "Add member (admin only)",
		operationId: "addTenantMember",
		parameters: [bp(), pp("id", "Tenant ID")],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["userId"],
						properties: {
							userId: { type: "string" },
							role: { type: "string", enum: ["admin", "member", "viewer"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Member added" } },
	},
}

s.paths["/tenants/{id}/members/{userId}"] = {
	delete: {
		tags: ["Tenants"],
		summary: "Remove member (admin only)",
		operationId: "removeTenantMember",
		parameters: [bp(), pp("id", "Tenant ID"), pp("userId", "User ID")],
		responses: { 200: { description: "Member removed" } },
	},
	put: {
		tags: ["Tenants"],
		summary: "Update member role (admin only)",
		operationId: "updateTenantMemberRole",
		parameters: [bp(), pp("id", "Tenant ID"), pp("userId", "User ID")],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["role"],
						properties: {
							role: { type: "string", enum: ["admin", "member", "viewer"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Role updated" } },
	},
}

s.paths["/tenants/{id}/invites"] = {
	get: {
		tags: ["Tenants"],
		summary: "List invites (admin only)",
		operationId: "listTenantInvites",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: { 200: { description: "Invite list" } },
	},
	post: {
		tags: ["Tenants"],
		summary: "Create invite (admin only)",
		operationId: "createTenantInvite",
		parameters: [bp(), pp("id", "Tenant ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							maxUses: { type: "integer", default: 10 },
							expiresInDays: { type: "integer", default: 30 },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Invite created" } },
	},
}

s.paths["/tenants/redeem"] = {
	post: {
		tags: ["Tenants"],
		summary: "Redeem invite code",
		operationId: "redeemTenantInvite",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["code"],
						properties: { code: { type: "string" } },
					},
				},
			},
		},
		responses: { 200: { description: "Invite redeemed" } },
	},
}

s.paths["/tenants/{id}/quota"] = {
	get: {
		tags: ["Tenants"],
		summary: "Get tenant quota",
		operationId: "getTenantQuota",
		parameters: [bp(), pp("id", "Tenant ID")],
		responses: { 200: { description: "Quota info" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// ML ENGINE
// ═══════════════════════════════════════════════════════════════════

s.paths["/ml/status"] = {
	get: {
		tags: ["ML Engine"],
		summary: "Get ML engine status",
		operationId: "getMlStatus",
		responses: { 200: { description: "ML status" } },
	},
}

s.paths["/ml/observations"] = {
	get: {
		tags: ["ML Engine"],
		summary: "List ML observations",
		operationId: "listMlObservations",
		parameters: [qp("limit", { type: "integer", default: 50 }), qp("offset", { type: "integer", default: 0 })],
		responses: { 200: { description: "Observation list" } },
	},
}

s.paths["/ml/models"] = {
	get: {
		tags: ["ML Engine"],
		summary: "List ML models",
		operationId: "listMlModels",
		responses: { 200: { description: "Model list" } },
	},
}

s.paths["/ml/logs"] = {
	get: {
		tags: ["ML Engine"],
		summary: "Get ML training logs",
		operationId: "getMlLogs",
		parameters: [qp("limit", { type: "integer", default: 50 }), qp("offset", { type: "integer", default: 0 })],
		responses: { 200: { description: "Training logs" } },
	},
}

s.paths["/ml/train"] = {
	post: {
		tags: ["ML Engine"],
		summary: "Trigger ML training cycle",
		operationId: "triggerMlTraining",
		responses: { 200: { description: "Training triggered" } },
	},
}

s.paths["/ml/model/upload"] = {
	post: {
		tags: ["ML Engine"],
		summary: "Upload ML model",
		operationId: "uploadMlModel",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["layers", "weights", "biases"],
						properties: {
							layers: { type: "array", items: { type: "object" } },
							weights: { type: "array", items: { type: "array", items: { type: "number" } } },
							biases: { type: "array", items: { type: "number" } },
							metadata: { type: "object" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Model uploaded" } },
	},
}

s.paths["/ml/model/latest"] = {
	get: {
		tags: ["ML Engine"],
		summary: "Get latest ML model",
		operationId: "getLatestMlModel",
		responses: { 200: { description: "Latest model" } },
	},
}

s.paths["/ml/observations/sync"] = {
	post: {
		tags: ["ML Engine"],
		summary: "Sync ML observations",
		operationId: "syncMlObservations",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["observations"],
						properties: {
							observations: {
								type: "array",
								items: {
									type: "object",
									properties: {
										type: { type: "string" },
										features: { type: "array", items: { type: "number" } },
										label: { type: "number" },
										metadata: { type: "object" },
									},
								},
							},
						},
					},
				},
			},
		},
		responses: { 200: { description: "Observations synced" } },
	},
}

s.paths["/ml/model/merge"] = {
	post: {
		tags: ["ML Engine"],
		summary: "Merge ML models",
		operationId: "mergeMlModels",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["modelIds"],
						properties: {
							modelIds: { type: "array", items: { type: "string" } },
							strategy: { type: "string", enum: ["average", "weighted", "federated"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Models merged" } },
	},
}

s.paths["/ml/sync/status"] = {
	get: {
		tags: ["ML Engine"],
		summary: "Get ML sync status",
		operationId: "getMlSyncStatus",
		responses: { 200: { description: "Sync status" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// MONITORING
// ═══════════════════════════════════════════════════════════════════

s.paths["/monitoring/logs"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get monitoring logs",
		operationId: "getMonitoringLogs",
		parameters: [
			qp("limit", { type: "integer", default: 50 }),
			qp("level", { type: "string", enum: ["info", "warn", "error"] }),
			qp("source", { type: "string" }),
			qp("search", { type: "string" }),
		],
		responses: { 200: { description: "Log entries" } },
	},
}

s.paths["/monitoring/stats"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get monitoring stats",
		operationId: "getMonitoringStats",
		responses: { 200: { description: "System stats" } },
	},
}

s.paths["/monitoring/health-timeline"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get health timeline",
		operationId: "getHealthTimeline",
		parameters: [qp("limit", { type: "integer", default: 50 }), qp("offset", { type: "integer", default: 0 })],
		responses: { 200: { description: "Health timeline" } },
	},
}

s.paths["/monitoring/health-record"] = {
	post: {
		tags: ["Monitoring"],
		summary: "Record health check",
		operationId: "recordHealthCheck",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["status"],
						properties: {
							status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
							metrics: { type: "object" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Health recorded" } },
	},
}

s.paths["/monitoring/alerts"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get alert history",
		operationId: "getAlertHistory",
		parameters: [qp("limit", { type: "integer", default: 100 }), qp("offset", { type: "integer", default: 0 })],
		responses: { 200: { description: "Alert history" } },
	},
}

s.paths["/monitoring/alerts/stats"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get alert statistics",
		operationId: "getAlertStats",
		responses: { 200: { description: "Alert stats" } },
	},
}

s.paths["/monitoring/alerts/rules"] = {
	get: {
		tags: ["Monitoring"],
		summary: "Get alert rules",
		operationId: "getAlertRules",
		responses: { 200: { description: "Alert rules" } },
	},
}

s.paths["/monitoring/alerts/rules/{id}"] = {
	put: {
		tags: ["Monitoring"],
		summary: "Update alert rule",
		operationId: "updateAlertRule",
		parameters: [pp("id", "Rule ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							enabled: { type: "boolean" },
							threshold: { type: "number" },
							condition: { type: "string", enum: ["gt", "lt", "gte", "lte", "eq", "neq"] },
							cooldownMinutes: { type: "integer" },
							severity: { type: "string", enum: ["warning", "critical"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Rule updated" } },
	},
}

s.paths["/monitoring/alerts/{id}/ack"] = {
	post: {
		tags: ["Monitoring"],
		summary: "Acknowledge alert",
		operationId: "acknowledgeAlert",
		parameters: [pp("id", "Alert ID")],
		responses: { 200: { description: "Alert acknowledged" } },
	},
}

s.paths["/monitoring/alerts/{id}/resolve"] = {
	post: {
		tags: ["Monitoring"],
		summary: "Resolve alert",
		operationId: "resolveAlert",
		parameters: [pp("id", "Alert ID")],
		responses: { 200: { description: "Alert resolved" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// HEALING
// ═══════════════════════════════════════════════════════════════════

s.paths["/healing/incidents"] = {
	get: {
		tags: ["Healing"],
		summary: "List healing incidents",
		operationId: "listHealingIncidents",
		parameters: [
			qp("status", { type: "string" }),
			qp("severity", { type: "string" }),
			qp("source", { type: "string" }),
			qp("limit", { type: "integer", default: 50 }),
		],
		responses: { 200: { description: "Incident list" } },
	},
	post: {
		tags: ["Healing"],
		summary: "Report incident",
		operationId: "reportIncident",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["title", "severity", "source"],
						properties: {
							title: { type: "string" },
							description: { type: "string" },
							severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
							source: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Incident reported" } },
	},
}

s.paths["/healing/incidents/{id}"] = {
	get: {
		tags: ["Healing"],
		summary: "Get incident",
		operationId: "getHealingIncident",
		parameters: [pp("id", "Incident ID")],
		responses: { 200: { description: "Incident details" } },
	},
	put: {
		tags: ["Healing"],
		summary: "Update incident",
		operationId: "updateHealingIncident",
		parameters: [pp("id", "Incident ID")],
		requestBody: {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							status: { type: "string", enum: ["open", "investigating", "resolved", "closed"] },
							severity: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Incident updated" } },
	},
}

s.paths["/healing/incidents/{id}/actions"] = {
	get: {
		tags: ["Healing"],
		summary: "Get healing actions for incident",
		operationId: "getHealingActions",
		parameters: [pp("id", "Incident ID")],
		responses: { 200: { description: "Healing actions" } },
	},
}

s.paths["/healing/metrics"] = {
	get: {
		tags: ["Healing"],
		summary: "Get healing metrics",
		operationId: "getHealingMetrics",
		responses: { 200: { description: "Healing metrics" } },
	},
}

s.paths["/healing/self-healing/stats"] = {
	get: {
		tags: ["Healing"],
		summary: "Get self-healing stats",
		operationId: "getSelfHealingStats",
		responses: { 200: { description: "Self-healing stats" } },
	},
}

s.paths["/healing/self-healing/run"] = {
	post: {
		tags: ["Healing"],
		summary: "Run healing cycle",
		operationId: "runHealingCycle",
		responses: { 200: { description: "Healing cycle result" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// AUTO DEPLOY
// ═══════════════════════════════════════════════════════════════════

s.paths["/auto-deploy/current"] = {
	get: {
		tags: ["Auto Deploy"],
		summary: "Get current deployment",
		operationId: "getCurrentDeploy",
		responses: { 200: { description: "Current deployment" } },
	},
}

s.paths["/auto-deploy/deploy"] = {
	post: {
		tags: ["Auto Deploy"],
		summary: "Trigger deployment",
		operationId: "triggerDeploy",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["version", "commitSha"],
						properties: {
							version: { type: "string" },
							commitSha: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Deploy started" } },
	},
}

s.paths["/auto-deploy/rollback"] = {
	post: {
		tags: ["Auto Deploy"],
		summary: "Rollback deployment",
		operationId: "rollbackDeploy",
		responses: { 200: { description: "Rollback result" } },
	},
}

s.paths["/auto-deploy/history"] = {
	get: {
		tags: ["Auto Deploy"],
		summary: "Get deploy history",
		operationId: "getDeployHistory",
		responses: { 200: { description: "Deploy history" } },
	},
}

s.paths["/auto-deploy/stats"] = {
	get: {
		tags: ["Auto Deploy"],
		summary: "Get deploy stats",
		operationId: "getDeployStats",
		responses: { 200: { description: "Deploy stats" } },
	},
}

s.paths["/auto-deploy/github-webhook"] = {
	post: {
		tags: ["Auto Deploy"],
		summary: "GitHub webhook receiver",
		operationId: "githubWebhook",
		responses: { 200: { description: "Webhook processed" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// AUTONOMOUS
// ═══════════════════════════════════════════════════════════════════

s.paths["/autonomous/start"] = {
	post: {
		tags: ["Autonomous"],
		summary: "Start autonomous loop",
		operationId: "startAutonomous",
		parameters: [bp()],
		responses: { 200: { description: "Autonomous loop started" } },
	},
}

s.paths["/autonomous/status"] = {
	get: {
		tags: ["Autonomous"],
		summary: "Get autonomous status",
		operationId: "getAutonomousStatus",
		responses: { 200: { description: "Autonomous status" } },
	},
}

s.paths["/autonomous/stop"] = {
	post: {
		tags: ["Autonomous"],
		summary: "Stop autonomous loop",
		operationId: "stopAutonomous",
		responses: { 200: { description: "Autonomous loop stopped" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// COMMISSIONING
// ═══════════════════════════════════════════════════════════════════

s.paths["/commissioning/start"] = {
	post: {
		tags: ["Commissioning"],
		summary: "Start commissioning",
		operationId: "startCommissioning",
		parameters: [bp()],
		responses: { 200: { description: "Commissioning started" } },
	},
}

s.paths["/commissioning/status"] = {
	get: {
		tags: ["Commissioning"],
		summary: "Get commissioning status",
		operationId: "getCommissioningStatus",
		responses: { 200: { description: "Commissioning status" } },
	},
}

s.paths["/commissioning/stop"] = {
	post: {
		tags: ["Commissioning"],
		summary: "Stop commissioning",
		operationId: "stopCommissioning",
		responses: { 200: { description: "Commissioning stopped" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// VISION
// ═══════════════════════════════════════════════════════════════════

s.paths["/vision/analyze"] = {
	post: {
		tags: ["Vision"],
		summary: "Analyze image",
		operationId: "analyzeImage",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["image", "mimeType"],
						properties: {
							image: { type: "string", description: "Base64-encoded image" },
							mimeType: { type: "string" },
							prompt: { type: "string" },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Image analysis result" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// CRAWLER
// ═══════════════════════════════════════════════════════════════════

s.paths["/crawler/sources"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "List crawler sources",
		operationId: "listCrawlerSources",
		responses: { 200: { description: "Source list" } },
	},
	post: {
		tags: ["Orchestrator"],
		summary: "Add crawler source",
		operationId: "addCrawlerSource",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["url", "type"],
						properties: {
							url: { type: "string" },
							type: { type: "string", enum: ["github", "docs", "rss", "web"] },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Source added" } },
	},
}

s.paths["/crawler/sources/{id}"] = {
	delete: {
		tags: ["Orchestrator"],
		summary: "Remove crawler source",
		operationId: "removeCrawlerSource",
		parameters: [pp("id", "Source ID")],
		responses: { 200: { description: "Source removed" } },
	},
}

s.paths["/crawler/crawl/{id}"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Crawl a source",
		operationId: "crawlSource",
		parameters: [pp("id", "Source ID")],
		responses: { 200: { description: "Crawl result" } },
	},
}

s.paths["/crawler/signals"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get crawler signals",
		operationId: "getCrawlerSignals",
		responses: { 200: { description: "Crawler signals" } },
	},
}

s.paths["/crawler/stats"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get crawler stats",
		operationId: "getCrawlerStats",
		responses: { 200: { description: "Crawler stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// FILE IMPORTER
// ═══════════════════════════════════════════════════════════════════

s.paths["/importer/import"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Import files",
		operationId: "importFiles",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: ["paths"],
						properties: {
							paths: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Import result" } },
	},
}

s.paths["/importer/stats"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get importer stats",
		operationId: "getImporterStats",
		responses: { 200: { description: "Importer stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// CPU GUARD
// ═══════════════════════════════════════════════════════════════════

s.paths["/system/cpu-guard"] = {
	get: {
		tags: ["Health"],
		summary: "Get CPU guard status",
		operationId: "getCpuGuard",
		responses: { 200: { description: "CPU guard status" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL EXECUTOR
// ═══════════════════════════════════════════════════════════════════

s.paths["/system/parallel-executor"] = {
	get: {
		tags: ["Health"],
		summary: "Get parallel executor stats",
		operationId: "getParallelExecutorStats",
		responses: { 200: { description: "Parallel executor stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// AGENT BUS
// ═══════════════════════════════════════════════════════════════════

s.paths["/system/agent-bus"] = {
	get: {
		tags: ["Health"],
		summary: "Get agent bus stats",
		operationId: "getAgentBusStats",
		responses: { 200: { description: "Agent bus stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// IMPROVEMENT LOOP
// ═══════════════════════════════════════════════════════════════════

s.paths["/system/improvement-loop"] = {
	get: {
		tags: ["Health"],
		summary: "Get improvement loop stats",
		operationId: "getImprovementLoopStats",
		responses: { 200: { description: "Improvement loop stats" } },
	},
	post: {
		tags: ["Health"],
		summary: "Trigger improvement cycle",
		operationId: "triggerImprovementCycle",
		responses: { 200: { description: "Cycle triggered" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// HERMES CLAW (KNOWLEDGE)
// ═══════════════════════════════════════════════════════════════════

s.paths["/knowledge/query"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Query knowledge base",
		operationId: "queryKnowledge",
		parameters: [bp(), qp("q", { type: "string" }, "Search query")],
		responses: { 200: { description: "Knowledge results" } },
	},
}

s.paths["/knowledge/learn"] = {
	post: {
		tags: ["Orchestrator"],
		summary: "Store knowledge",
		operationId: "storeKnowledge",
		parameters: [bp()],
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							content: { type: "string" },
							source: { type: "string" },
							tags: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		},
		responses: { 200: { description: "Knowledge stored" } },
	},
}

s.paths["/knowledge/stats"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get knowledge stats",
		operationId: "getKnowledgeStats",
		responses: { 200: { description: "Knowledge stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// HERMES CLAW (CONTEXT)
// ═══════════════════════════════════════════════════════════════════

s.paths["/hermes/context"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Recall context",
		operationId: "recallContext",
		parameters: [bp(), qp("q", { type: "string" }, "Context query"), qp("limit", { type: "integer", default: 5 })],
		responses: { 200: { description: "Context results" } },
	},
}

s.paths["/hermes/stats"] = {
	get: {
		tags: ["Orchestrator"],
		summary: "Get Hermes stats",
		operationId: "getHermesStats",
		responses: { 200: { description: "Hermes stats" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// API DOCS
// ═══════════════════════════════════════════════════════════════════

s.paths["/api-docs"] = {
	get: {
		tags: ["API Docs"],
		summary: "Get OpenAPI spec (JSON)",
		operationId: "getApiDocsJson",
		responses: { 200: { description: "OpenAPI JSON spec" } },
	},
}

s.paths["/api-docs/ui"] = {
	get: {
		tags: ["API Docs"],
		summary: "Get Swagger UI",
		operationId: "getSwaggerUi",
		responses: { 200: { description: "Swagger UI HTML" } },
	},
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ═══════════════════════════════════════════════════════════════════

fs.writeFileSync("openapi.json", JSON.stringify(s, null, 2))
console.log(`✅ openapi.json generated with ${Object.keys(s.paths).length} paths`)
