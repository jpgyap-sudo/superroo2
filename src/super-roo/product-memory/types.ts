/**
 * Super Roo — Product Memory types.
 *
 * Tracks product features, updates, test history, bug-to-feature mappings,
 * and agent notes. This is the "product control center" layer that gives
 * SuperRoo persistent knowledge about what features exist, what changed,
 * what is broken, what was tested, and which agent owns the next action.
 */

// ── Feature Status ────────────────────────────────────────────────────────────

export type ProductFeatureStatus = "working" | "needs_test" | "broken" | "planned" | "deprecated"

// ── Update Types ──────────────────────────────────────────────────────────────

export type ProductUpdateType =
	| "feature_added"
	| "bug_fixed"
	| "ui_changed"
	| "agent_updated"
	| "api_changed"
	| "deployment"
	| "rollback"
	| "test_result"
	| "security_change"

// ── Product Feature ───────────────────────────────────────────────────────────

export interface ProductFeature {
	id: string
	name: string
	category: string
	description: string
	status: ProductFeatureStatus
	confidence: number
	ownerAgent: string
	relatedFiles: string[]
	lastTestedAt: string | null
	knownBugs: string[]
	testChecklist: string[]
}

// ── Product Update ────────────────────────────────────────────────────────────

export interface ProductUpdate {
	id: string
	timestamp: string
	type: ProductUpdateType
	title: string
	summary: string
	filesChanged: string[]
	status: string
	linkedFeatures: string[]
	rollbackAvailable: boolean
}

// ── Feature Test Record ───────────────────────────────────────────────────────

export interface FeatureTestRecord {
	id: string
	featureId: string
	testedAt: string
	testedBy: string
	result: "pass" | "fail" | "warning"
	issuesFound: string[]
	notes: string
}

// ── Bug-Feature Mapping ──────────────────────────────────────────────────────

export interface BugFeatureMapping {
	id: string
	bugId: string
	featureId: string
	severity: "low" | "medium" | "high" | "critical"
	title: string
	description: string
	logs: string[]
	status: "open" | "investigating" | "fixed" | "wontfix"
	createdAt: string
}

// ── Agent Note ────────────────────────────────────────────────────────────────

export interface AgentNote {
	id: string
	timestamp: string
	agent: string
	note: string
}

// ── Memory File Containers ────────────────────────────────────────────────────

export interface ProductFeaturesFile {
	features: ProductFeature[]
}

export interface ProductUpdatesFile {
	updates: ProductUpdate[]
}

export interface FeatureTestHistoryFile {
	tests: FeatureTestRecord[]
}

export interface BugFeatureMapFile {
	mappings: BugFeatureMapping[]
}

export interface AgentNotesFile {
	notes: AgentNote[]
}
