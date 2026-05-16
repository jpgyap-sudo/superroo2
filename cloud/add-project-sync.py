#!/usr/bin/env python3
"""
Add a POST /projects/sync endpoint to auth.js so VSCode/agents can push project data.
Also add a POST /projects/presence/sync endpoint for real-time workspace presence.
"""
import re

AUTH_FILE = "/opt/superroo2/cloud/api/auth.js"

with open(AUTH_FILE, "r") as f:
    content = f.read()

# ── 1. Add handleProjectSync function before the Route Dispatcher section ──

old_dispatcher = """// ── Route Dispatcher ─────────────────────────────────────────────────────────────

async function handleAuthRoute(method, url, req, res) {"""

new_functions = """// ── Project Sync ────────────────────────────────────────────────────────────────

/**
 * POST /projects/sync
 * Sync projects from VSCode extension or agents to the cloud.
 * Body: { projects: [{ id, name, repoName, branch, status, language, localPath, repoUrl }] }
 */
async function handleProjectSync(email, body) {
	const { projects: incomingProjects } = body || {}
	if (!Array.isArray(incomingProjects)) return { ok: false, error: "projects array is required." }

	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }

	const now_ts = nowISO()
	let added = 0, updated = 0

	for (const incoming of incomingProjects) {
		const projectId = incoming.id || generateId("proj")
		const existing = projects.find((p) => p.id === projectId && p.userId === user.userId)

		if (existing) {
			Object.assign(existing, incoming, { userId: user.userId, lastActivityAt: now_ts })
			updated++
		} else {
			projects.push({
				id: projectId,
				userId: user.userId,
				name: incoming.name || incoming.repoName || "Untitled Project",
				repoName: incoming.repoName || null,
				branch: incoming.branch || "main",
				status: incoming.status || "active",
				language: incoming.language || null,
				localPath: incoming.localPath || null,
				repoUrl: incoming.repoUrl || null,
				lastActivityAt: now_ts,
			})
			added++
		}
	}

	await saveJSON(PROJECTS_FILE, projects)

	await addAuditLog({
		userId: user.userId,
		source: "project_sync",
		event: "projects_synced",
		metadata: { added, updated, total: projects.filter((p) => p.userId === user.userId).length },
	})

	return { ok: true, message: `Synced ${incomingProjects.length} projects (${added} new, ${updated} updated).` }
}

/**
 * POST /projects/presence/sync
 * Sync real-time workspace presence from VSCode (active file, current task, active agent).
 * Body: { projectId, activeFile, currentTask, activeAgent }
 */
async function handleProjectPresenceSync(email, body) {
	const { projectId, activeFile, currentTask, activeAgent } = body || {}
	if (!projectId) return { ok: false, error: "projectId is required." }

	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }

	const now_ts = nowISO()

	// Find existing presence record for this user + project
	const existing = projectPresence.find(
		(pp) => pp.projectId === projectId && pp.userId === user.userId
	)

	if (existing) {
		existing.activeFile = activeFile || existing.activeFile
		existing.currentTask = currentTask || existing.currentTask
		existing.activeAgent = activeAgent || existing.activeAgent
		existing.status = "active"
		existing.lastSyncAt = now_ts
		existing.source = "vscode"
	} else {
		projectPresence.push({
			id: randomUUID(),
			projectId,
			userId: user.userId,
			source: "vscode",
			activeFile: activeFile || null,
			currentTask: currentTask || null,
			activeAgent: activeAgent || null,
			status: "active",
			lastSyncAt: now_ts,
		})
	}

	await saveJSON(PROJECT_PRESENCE_FILE, projectPresence)
	return { ok: true, message: "Presence synced." }
}

// ── Route Dispatcher ─────────────────────────────────────────────────────────────

async function handleAuthRoute(method, url, req, res) {"""

content = content.replace(old_dispatcher, new_functions)

# ── 2. Add routes in the dispatcher (after the /tasks/delete route, before "return false") ──

old_return_false = """	return false // Not handled
}"""

new_routes = """	// ── Project Sync Routes ────────────────────────────────────────────────

	if (method === "POST" && normalizedPath === "/projects/sync") {
		try {
			const body = await parseBody(req)
			const result = await handleProjectSync(email, body)
			sendJson(res, result.ok ? 200 : 400, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath === "/projects/presence/sync") {
		try {
			const body = await parseBody(req)
			const result = await handleProjectPresenceSync(email, body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	return false // Not handled
}"""

content = content.replace(old_return_false, new_routes)

# ── 3. Add exports ──

old_exports = """module.exports = {
	loadStore,
	handleAuthRoute,
	authenticate,
	requireAuth,
	handleTelegramSessionCheck,
	handleTelegramProjects,
	handleTelegramProjectSelect,
	handleOrchestratorInstruction,
}"""

new_exports = """module.exports = {
	loadStore,
	handleAuthRoute,
	authenticate,
	requireAuth,
	handleTelegramSessionCheck,
	handleTelegramProjects,
	handleTelegramProjectSelect,
	handleOrchestratorInstruction,
	handleProjectSync,
	handleProjectPresenceSync,
}"""

content = content.replace(old_exports, new_exports)

with open(AUTH_FILE, "w") as f:
    f.write(content)

print("✅ auth.js updated with project sync endpoints")
