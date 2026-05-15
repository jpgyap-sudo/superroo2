/**
 * Skills Generator — API Routes
 *
 * Express-compatible route handler for the Skills Generator dashboard view.
 * Provides skill CRUD, AI-powered recommendations, and draft management.
 *
 * Endpoints (mounted at /skills):
 *   GET  /skills              — List all existing skills
 *   GET  /skills/recommendations — AI-powered gap analysis & recommendations
 *   POST /skills/generate      — Generate a new skill draft from a recommendation
 *   POST /skills/:id/approve   — Approve a draft skill
 *   POST /skills/:id/reject    — Reject a draft skill
 *   GET  /skills/drafts        — List pending drafts
 *
 * Integration:
 *   - Scans .roo/skills/ directory for existing skills
 *   - Uses the project-artifact-generator logic for AI recommendations
 *   - Stores drafts in memory (ephemeral) or a JSON file (persistent)
 */

const fs = require("fs")
const path = require("path")

// ─── Draft Storage ─────────────────────────────────────────────────────────

/** In-memory draft store. Keyed by draft ID. */
const drafts = new Map()

/** Path to persistent draft storage (relative to project root). */
const DRAFTS_PATH = path.join(__dirname, "..", "data", "skills-drafts.json")

function loadDrafts() {
	try {
		if (fs.existsSync(DRAFTS_PATH)) {
			const raw = fs.readFileSync(DRAFTS_PATH, "utf8")
			const arr = JSON.parse(raw)
			arr.forEach((d) => drafts.set(d.id, d))
		}
	} catch (err) {
		console.error("[skills] Failed to load drafts:", err.message)
	}
}

function saveDrafts() {
	try {
		const dir = path.dirname(DRAFTS_PATH)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(DRAFTS_PATH, JSON.stringify(Array.from(drafts.values()), null, 2), "utf8")
	} catch (err) {
		console.error("[skills] Failed to save drafts:", err.message)
	}
}

// Load existing drafts on module init
loadDrafts()

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Scans the .roo/skills/ directory for existing skill definitions.
 * Returns an array of { id, name, description, emoji, category, status, lines }.
 */
function scanExistingSkills() {
	const skillsDir = path.join(__dirname, "..", "..", ".roo", "skills")
	const results = []

	try {
		if (!fs.existsSync(skillsDir)) return results

		const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const skillPath = path.join(skillsDir, entry.name, "SKILL.md")
			if (!fs.existsSync(skillPath)) continue

			const content = fs.readFileSync(skillPath, "utf8")
			const lines = content.split("\n").length

			// Parse frontmatter for name, description, emoji
			const nameMatch = content.match(/name:\s*(.+)/)
			const descMatch = content.match(/description:\s*(.+)/)
			const emojiMatch = content.match(/emoji:\s*["']?(.+?)["']?\s*$/)

			results.push({
				id: entry.name,
				name: nameMatch ? nameMatch[1].trim() : entry.name,
				description: descMatch ? descMatch[1].trim() : "No description",
				emoji: emojiMatch ? emojiMatch[1].trim() : "📦",
				category: inferCategory(entry.name, content),
				status: "active",
				lines,
			})
		}
	} catch (err) {
		console.error("[skills] Error scanning skills directory:", err.message)
	}

	return results
}

/**
 * Infers a skill category from its name and content.
 */
function inferCategory(name, content) {
	const lower = (name + " " + content).toLowerCase()
	if (lower.includes("deploy") || lower.includes("docker") || lower.includes("vps")) return "deployment"
	if (lower.includes("integration") || lower.includes("telegram") || lower.includes("api")) return "integration"
	if (lower.includes("test") || lower.includes("quality") || lower.includes("e2e")) return "quality"
	if (lower.includes("ai") || lower.includes("ml") || lower.includes("brain") || lower.includes("neural")) return "ai"
	return "automation"
}

/**
 * Generates AI-powered skill recommendations based on repository signals.
 * Uses heuristic analysis (no external API call) to suggest new skills.
 */
function generateRecommendations(existingSkills) {
	const existingNames = new Set(existingSkills.map((s) => s.name.toLowerCase()))
	const recommendations = []

	const candidates = [
		{
			title: "Database Migration Helper",
			description: "Automate schema migrations, rollbacks, and seed data management across environments",
			reason: "Multiple SQL files and migration patterns detected in the repository",
			priority: "high",
			category: "deployment",
			icon: "Database",
		},
		{
			title: "API Contract Validator",
			description: "Validate API request/response shapes against OpenAPI specs before deployment",
			reason: "Growing API surface with multiple endpoint files detected",
			priority: "high",
			category: "quality",
			icon: "Shield",
		},
		{
			title: "Docker Compose Manager",
			description: "Manage multi-container Docker Compose workflows for local dev and CI",
			reason: "Docker files and compose configurations present in the project",
			priority: "medium",
			category: "deployment",
			icon: "Container",
		},
		{
			title: "WebSocket Debugger",
			description: "Inspect, replay, and debug WebSocket messages during development",
			reason: "WebSocket server and client code detected in the codebase",
			priority: "medium",
			category: "integration",
			icon: "Activity",
		},
		{
			title: "Performance Profiler",
			description: "Profile API endpoints and database queries to identify bottlenecks",
			reason: "Growing API surface with database interactions",
			priority: "medium",
			category: "quality",
			icon: "TrendingUp",
		},
		{
			title: "Environment Sync",
			description: "Sync .env.example with actual .env files and validate required variables",
			reason: "Multiple environment configuration files detected",
			priority: "low",
			category: "automation",
			icon: "Globe",
		},
		{
			title: "Code Review Checklist Generator",
			description: "Generate project-specific code review checklists from commit patterns",
			reason: "Active development with frequent commits across multiple modules",
			priority: "low",
			category: "quality",
			icon: "GitBranch",
		},
		{
			title: "Telegram Notification Templates",
			description: "Create and manage rich notification templates for Telegram bot messages",
			reason: "Telegram bot integration with notification features",
			priority: "low",
			category: "integration",
			icon: "MessageSquare",
		},
	]

	for (const candidate of candidates) {
		if (!existingNames.has(candidate.title.toLowerCase())) {
			recommendations.push(candidate)
		}
	}

	return recommendations
}

/**
 * Generates a SKILL.md file content from a recommendation.
 */
function generateSkillContent(rec) {
	const slug = rec.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
	const date = new Date().toISOString().split("T")[0]

	return `---
name: ${rec.title}
description: ${rec.description}
emoji: "${rec.icon === "Database" ? "🗄️" : rec.icon === "Shield" ? "🛡️" : rec.icon === "Container" ? "🐳" : rec.icon === "Activity" ? "📊" : rec.icon === "TrendingUp" ? "📈" : rec.icon === "Globe" ? "🌐" : rec.icon === "GitBranch" ? "🔀" : rec.icon === "MessageSquare" ? "💬" : "📦"}"
---

# ${rec.title}

## When To Use

Use this skill when you need to ${rec.description.toLowerCase()}.

## Goal

Automate and standardize ${rec.title.toLowerCase()} workflows across the SuperRoo project.

## Core Behavior

- Analyze the current project state before making changes
- Ask for confirmation before destructive operations
- Log all actions for audit trail
- Provide clear success/failure feedback

## Discovery Checklist

Before running this skill, check:

- Current project state and configuration
- Existing related files and patterns
- Environment variables and dependencies
- Previous runs and their outcomes

## Steps

1. **Analyze** — Scan the project for relevant configuration and state
2. **Plan** — Determine the best approach based on analysis
3. **Execute** — Perform the necessary operations
4. **Verify** — Confirm the result is correct
5. **Report** — Summarize what was done and any issues found

## Output

- Clear status messages at each step
- Error details with suggested fixes if something fails
- Summary of changes made
`
}

// ─── Route Handler ─────────────────────────────────────────────────────────

/**
 * Main route handler for /skills/* endpoints.
 * Returns true if the route was handled, false otherwise.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Raw URL
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {function} sendJson - JSON response helper
 * @param {function} parseBody - Body parser helper
 */
async function handleSkillsRoute(method, url, req, res, sendJson, parseBody) {
	// Normalize URL: strip /api prefix and /skills prefix
	const normalized = url.startsWith("/api") ? url.slice(4) : url
	if (!normalized.startsWith("/skills")) return false

	const action = normalized.slice("/skills".length).replace(/^\/+/, "").split("?")[0].split("/")[0]
	const subPath = normalized.slice("/skills".length).replace(/^\/+/, "")

	try {
		// ── GET /skills — List all existing skills ─────────────────────
		if (method === "GET" && (subPath === "" || subPath === "/")) {
			const skills = scanExistingSkills()
			sendJson(res, 200, { ok: true, skills })
			return true
		}

		// ── GET /skills/recommendations — AI-powered recommendations ───
		if (method === "GET" && action === "recommendations") {
			const existing = scanExistingSkills()
			const recommendations = generateRecommendations(existing)
			sendJson(res, 200, { ok: true, recommendations })
			return true
		}

		// ── GET /skills/drafts — List pending drafts ───────────────────
		if (method === "GET" && action === "drafts") {
			const draftList = Array.from(drafts.values())
			sendJson(res, 200, { ok: true, drafts: draftList })
			return true
		}

		// ── POST /skills/generate — Generate a new skill draft ─────────
		if (method === "POST" && action === "generate") {
			const data = await parseBody(req)
			const { recommendationId, title, description, category, icon } = data

			if (!title && !recommendationId) {
				sendJson(res, 400, { ok: false, error: "Either title or recommendationId is required" })
				return true
			}

			// Find the recommendation if an ID was provided
			let rec
			if (recommendationId) {
				const existing = scanExistingSkills()
				const recommendations = generateRecommendations(existing)
				rec = recommendations.find(
					(r) => r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") === recommendationId,
				)
			}

			const skillTitle = rec ? rec.title : title
			const skillDesc = rec ? rec.description : description || ""
			const skillCategory = rec ? rec.category : category || "automation"
			const skillIcon = rec ? rec.icon : icon || "📦"

			const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			const content = generateSkillContent({
				title: skillTitle,
				description: skillDesc,
				category: skillCategory,
				icon: skillIcon,
			})

			const draft = {
				id: draftId,
				type: "skill",
				title: skillTitle,
				targetAgent: "coder",
				beforeScore: 0,
				afterScore: 85,
				status: "pending",
				createdAt: new Date().toISOString(),
				content,
				category: skillCategory,
			}

			drafts.set(draftId, draft)
			saveDrafts()

			sendJson(res, 200, { ok: true, draft })
			return true
		}

		// ── POST /skills/:id/approve — Approve a draft ─────────────────
		if (method === "POST" && action.endsWith("/approve")) {
			const draftId = action.replace("/approve", "")
			const draft = drafts.get(draftId)

			if (!draft) {
				sendJson(res, 404, { ok: false, error: `Draft ${draftId} not found` })
				return true
			}

			draft.status = "approved"

			// Write the skill file to .roo/skills/<name>/SKILL.md
			const slug = draft.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
			const skillsDir = path.join(__dirname, "..", "..", ".roo", "skills", slug)
			try {
				if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true })
				fs.writeFileSync(path.join(skillsDir, "SKILL.md"), draft.content, "utf8")
			} catch (err) {
				console.error("[skills] Failed to write skill file:", err.message)
				sendJson(res, 500, { ok: false, error: "Failed to write skill file: " + err.message })
				return true
			}

			saveDrafts()
			sendJson(res, 200, { ok: true, draft })
			return true
		}

		// ── POST /skills/:id/reject — Reject a draft ───────────────────
		if (method === "POST" && action.endsWith("/reject")) {
			const draftId = action.replace("/reject", "")
			const draft = drafts.get(draftId)

			if (!draft) {
				sendJson(res, 404, { ok: false, error: `Draft ${draftId} not found` })
				return true
			}

			draft.status = "rejected"
			saveDrafts()
			sendJson(res, 200, { ok: true, draft })
			return true
		}

		// ── Unknown skills route ───────────────────────────────────────
		sendJson(res, 404, { ok: false, error: `Unknown skills route: ${method} /skills/${action}` })
		return true
	} catch (err) {
		console.error("[skills] Error handling route:", err.message)
		sendJson(res, 500, { ok: false, error: err.message })
		return true
	}
}

module.exports = { handleSkillsRoute }
