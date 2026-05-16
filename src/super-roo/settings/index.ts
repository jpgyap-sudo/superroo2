/**
 * SuperRoo Settings Module — barrel exports.
 *
 * This module provides the settings infrastructure for the SuperRoo system:
 * - Provider management (API keys, testing, status)
 * - Agent routing (model-to-agent mapping with fallbacks)
 * - Approval engine (action/command evaluation)
 * - Secret vault (AES-256-GCM encrypted key storage)
 * - Provider sync (runtime config loading)
 */

// ── Services ─────────────────────────────────────────────────────────────────

export { encryptSecret, decryptSecret, maskSecret, hashApiKey } from "./services/secretVault"
export { testProviderKey, getTestableProviders } from "./services/providerTest"
export type { ProviderTestResult } from "./services/providerTest"
export { getRouteForAgent, validateRoutes, DEFAULT_AGENT_ROUTES } from "./services/modelRouter"
export type { AgentName, AgentRoute, RouteResult, ProviderAvailability } from "./services/modelRouter"
export { evaluateApproval, getDangerousPatterns } from "./services/approvalEngine"
export type { ApprovalDecision, ApprovalRule, ApprovalResult } from "./services/approvalEngine"
export { loadProviderRuntimeConfig, getProviderForAgent, testProviderConnection } from "./services/providerSync"
export type { ProviderRuntimeConfig, ProviderStatus } from "./services/providerSync"

// ── Config ───────────────────────────────────────────────────────────────────

export { PROVIDERS } from "./config/providers"
export type { ProviderConfig, ProviderModel } from "./config/providers"
export { DEFAULT_AGENT_ROUTES as DEFAULT_AGENT_ROUTES_CONFIG } from "./config/agentRouting"
export type { AgentRoute as AgentRouteConfig } from "./config/agentRouting"

// ── Types ────────────────────────────────────────────────────────────────────

export type {
	ProviderEntry,
	ProviderKeyPayload,
	AgentRouteConfig as AgentRouteConfigType,
	RouteValidationResult,
	ApprovalRuleConfig,
	ApprovalEvaluationRequest,
	ApprovalEvaluationResult,
	VpsGuardrailsConfig,
	MCPServerEntry,
	SuperRooSettings,
	RiskLevel,
} from "./types"

// ── Routes (Express routers) ─────────────────────────────────────────────────

export { createProviderRouter } from "./routes/providerRoutes"
export { createRoutingRouter } from "./routes/routingRoutes"
export { createSettingsRouter } from "./routes/settingsRoutes"
