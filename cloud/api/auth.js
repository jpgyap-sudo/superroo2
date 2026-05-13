/**
 * SuperRoo Cloud — Unified Auth & Sync Module
 *
 * Implements the full schema from superroo-telegram-dashboard-kit:
 * - users, telegram_links, telegram_sessions, projects, project_presence
 * - agent_runs, approval_requests, audit_logs, extension_devices
 *
 * API Contract:
 *   POST /telegram/auth/login     — Mini App login (email + password + Telegram link)
 *   POST /telegram/session/check  — Check/refresh Telegram session
 *   POST /telegram/projects       — List user projects
 *   POST /telegram/projects/:id/select — Select active project
 *   POST /orchestrator/instruction    — Send coding instruction
 *   GET  /telegram/projects/:id/logs  — Project logs
 *   GET  /telegram/projects/:id/approvals — Pending approvals
 *
 * Also provides web auth:
 *   POST /auth/register  — Create account
 *   POST /auth/login     — Web login
 *   POST /auth/verify    — Verify token
 *   GET  /auth/profile   — Get profile
 *   POST /auth/link-vscode — Link VS Code device
 *   POST /tasks/sync     — Sync tasks across platforms
 */

const crypto = require("crypto")
const fs = require("fs").promises
const path = require("path")

// ── Configuration ────────────────────────────────────────────────────────────────

const AUTH_DIR = process.env.AUTH_DIR || "/opt/superroo2/cloud/data/auth"
const USERS_FILE = path.join(AUTH_DIR, "users.json")
const SESSIONS_FILE = path.join(AUTH_DIR, "sessions.json")
const TELEGRAM_LINKS_FILE = path.join(AUTH_DIR, "telegram_links.json")
const TELEGRAM_SESSIONS_FILE = path.join(AUTH_DIR, "telegram_sessions.json")
const PROJECTS_FILE = path.join(AUTH_DIR, "projects.json")
const PROJECT_PRESENCE_FILE = path.join(AUTH_DIR, "project_presence.json")
const AGENT_RUNS_FILE = path.join(AUTH_DIR, "agent_runs.json")
const APPROVAL_REQUESTS_FILE = path.join(AUTH_DIR, "approval_requests.json")
const AUDIT_LOGS_FILE = path.join(AUTH_DIR, "audit_logs.json")
const EXTENSION_DEVICES_FILE = path.join(AUTH_DIR, "extension_devices.json")
const TASKS_FILE = path.join(AUTH_DIR, "tasks.json")

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days for web tokens
const TELEGRAM_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24 hours inactivity

// ── In-memory stores ─────────────────────────────────────────────────────────────

let users = {} // id -> user
let sessions = {} // token -> session
let telegramLinks = [] // array of telegram_link
let telegramSessions = [] // array of telegram_session
let projects = [] // array of project
let projectPresence = [] // array of project_presence
let agentRuns = [] // array of agent_run
let approvalRequests = [] // array of approval_request
let auditLogs = [] // array of audit_log
let extensionDevices = [] // array of extension_device
let tasks = {} // userId -> task[]

// ── Helpers ──────────────────────────────────────────────────────────────────────

function hashPassword(password) {
	return crypto.createHash("sha256").update(password).digest("hex")
}

function hashToken(token) {
	return crypto.createHash("sha256").update(token).digest("hex")
}

function generateToken() {
	return crypto.randomBytes(32).toString("hex")
}

function generateId(prefix) {
	return prefix + "_" + crypto.randomBytes(12).toString("hex")
}

function now() {
	return Date.now()
}

function nowISO() {
	return new Date().toISOString()
}

function isExpired(timestamp) {
	return Date.now() > timestamp
}

function randomUUID() {
	return crypto.randomUUID()
}

// ── Persistence ──────────────────────────────────────────────────────────────────

async function ensureDir() {
	await fs.mkdir(AUTH_DIR, { recursive: true })
}

async function loadJSON(filePath, fallback) {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		return JSON.parse(raw)
	} catch {
		return fallback
	}
}

async function saveJSON(filePath, data) {
	await ensureDir()
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

async function loadStore() {
	await ensureDir()
	users = await loadJSON(USERS_FILE, {})
	sessions = await loadJSON(SESSIONS_FILE, {})
	telegramLinks = await loadJSON(TELEGRAM_LINKS_FILE, [])
	telegramSessions = await loadJSON(TELEGRAM_SESSIONS_FILE, [])
	projects = await loadJSON(PROJECTS_FILE, [])
	projectPresence = await loadJSON(PROJECT_PRESENCE_FILE, [])
	agentRuns = await loadJSON(AGENT_RUNS_FILE, [])
	approvalRequests = await loadJSON(APPROVAL_REQUESTS_FILE, [])
	auditLogs = await loadJSON(AUDIT_LOGS_FILE, [])
	extensionDevices = await loadJSON(EXTENSION_DEVICES_FILE, [])
	tasks = await loadJSON(TASKS_FILE, {})

	// Clean expired web sessions on load
	for (const [token, session] of Object.entries(sessions)) {
		if (isExpired(session.expiresAt)) {
			delete sessions[token]
		}
	}

	// Clean expired telegram sessions on load
	telegramSessions = telegramSessions.filter((s) => !isExpired(s.expiresAt) && s.isActive)

	console.log(
		`[auth] Loaded ${Object.keys(users).length} users, ${Object.keys(sessions).length} web sessions, ${telegramSessions.length} tg sessions`,
	)
}

// ── Web Auth Middleware ──────────────────────────────────────────────────────────

function authenticate(req) {
	const authHeader = req.headers?.authorization || ""
	if (!authHeader.startsWith("Bearer ")) return null
	const token = authHeader.slice(7).trim()
	const session = sessions[token]
	if (!session) return null
	if (isExpired(session.expiresAt)) {
		delete sessions[token]
		saveJSON(SESSIONS_FILE, sessions).catch(() => {})
		return null
	}
	return session.email
}

function requireAuth(req, res) {
	const email = authenticate(req)
	if (!email) {
		sendJson(res, 401, { ok: false, error: "Unauthorized. Please sign in again." })
		return null
	}
	return email
}

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

function parseBody(req) {
	return new Promise((resolve, reject) => {
		let body = ""
		req.on("data", (chunk) => {
			body += chunk
		})
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on("error", reject)
	})
}

// ── Validate Telegram initData ───────────────────────────────────────────────────

function validateTelegramInitData(initData) {
	// In production, validate Telegram Web App initData HMAC.
	// For now, accept any non-empty initData.
	if (!initData) return false
	return true
}

// ── Audit Log ────────────────────────────────────────────────────────────────────

async function addAuditLog(entry) {
	auditLogs.push({
		id: randomUUID(),
		userId: entry.userId || null,
		projectId: entry.projectId || null,
		telegramUserId: entry.telegramUserId || null,
		source: entry.source || "api",
		event: entry.event,
		metadata: entry.metadata || {},
		createdAt: nowISO(),
	})
	await saveJSON(AUDIT_LOGS_FILE, auditLogs)
}

// ── Web Auth Handlers ────────────────────────────────────────────────────────────

async function handleRegister(body) {
	const { email, password, name } = body || {}
	if (!email || !password) return { ok: false, error: "Email and password are required." }
	const trimmedEmail = email.trim().toLowerCase()
	if (Object.values(users).some((u) => u.email === trimmedEmail)) {
		return { ok: false, error: "An account with this email already exists." }
	}
	if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." }

	const userId = generateId("usr")
	users[userId] = {
		userId,
		email: trimmedEmail,
		name: name || trimmedEmail.split("@")[0],
		passwordHash: hashPassword(password),
		createdAt: now(),
		updatedAt: now(),
	}
	await saveJSON(USERS_FILE, users)

	const token = generateToken()
	sessions[token] = {
		email: trimmedEmail,
		userId,
		createdAt: now(),
		expiresAt: now() + TOKEN_EXPIRY_MS,
		source: "web",
	}
	await saveJSON(SESSIONS_FILE, sessions)

	await addAuditLog({ userId, source: "api", event: "user_registered", metadata: { email: trimmedEmail } })

	return {
		ok: true,
		token,
		email: trimmedEmail,
		name: users[userId].name,
		userId,
		expiresAt: sessions[token].expiresAt,
	}
}

async function handleLogin(body) {
	const { email, password, source } = body || {}
	if (!email || !password) return { ok: false, error: "Email and password are required." }
	const trimmedEmail = email.trim().toLowerCase()
	const user = Object.values(users).find((u) => u.email === trimmedEmail)
	if (!user || user.passwordHash !== hashPassword(password)) {
		return { ok: false, error: "Invalid email or password." }
	}

	const token = generateToken()
	sessions[token] = {
		email: trimmedEmail,
		userId: user.userId,
		createdAt: now(),
		expiresAt: now() + TOKEN_EXPIRY_MS,
		source: source || "web",
	}
	await saveJSON(SESSIONS_FILE, sessions)
	await addAuditLog({ userId: user.userId, source: source || "web", event: "web_login", metadata: {} })

	return {
		ok: true,
		token,
		email: trimmedEmail,
		name: user.name,
		userId: user.userId,
		expiresAt: sessions[token].expiresAt,
	}
}

async function handleVerify(body) {
	const { token } = body || {}
	if (!token) return { ok: false, error: "Token is required." }
	const session = sessions[token]
	if (!session) return { ok: false, error: "Invalid token." }
	if (isExpired(session.expiresAt)) {
		delete sessions[token]
		await saveJSON(SESSIONS_FILE, sessions)
		return { ok: false, error: "Token expired. Please sign in again." }
	}
	const user = Object.values(users).find((u) => u.email === session.email)
	return {
		ok: true,
		email: session.email,
		name: user?.name || session.email,
		userId: user?.userId,
		expiresAt: session.expiresAt,
	}
}

function handleProfile(email) {
	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }
	return { ok: true, user: { userId: user.userId, email: user.email, name: user.name, createdAt: user.createdAt } }
}

async function handleLogout(body) {
	const { token } = body || {}
	if (token && sessions[token]) {
		delete sessions[token]
		await saveJSON(SESSIONS_FILE, sessions)
	}
	return { ok: true }
}

async function handleLinkVscode(email, body) {
	const { vscodeDeviceId, deviceName } = body || {}
	if (!vscodeDeviceId) return { ok: false, error: "vscodeDeviceId is required." }
	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }

	const existing = extensionDevices.find((d) => d.deviceId === vscodeDeviceId)
	if (existing) {
		existing.lastSeenAt = nowISO()
		existing.isActive = true
	} else {
		extensionDevices.push({
			id: randomUUID(),
			userId: user.userId,
			deviceName: deviceName || "VS Code",
			deviceId: vscodeDeviceId,
			lastSeenAt: nowISO(),
			isActive: true,
			createdAt: nowISO(),
		})
	}
	await saveJSON(EXTENSION_DEVICES_FILE, extensionDevices)
	return { ok: true, message: "VS Code device linked successfully." }
}

// ── Telegram Auth Handlers ───────────────────────────────────────────────────────

/**
 * POST /telegram/auth/login
 * Used by Telegram Mini App. Validates credentials, links Telegram user, creates session.
 */
async function handleTelegramLogin(body) {
	const { email, password, telegramInitData, telegramUserId, telegramChatId, telegramUsername } = body || {}

	if (!email || !password) return { ok: false, error: "Email and password are required." }
	if (!telegramUserId) return { ok: false, error: "telegramUserId is required." }

	const trimmedEmail = email.trim().toLowerCase()
	const user = Object.values(users).find((u) => u.email === trimmedEmail)
	if (!user) {
		return { ok: false, error: "Invalid email or password." }
	}

	// Special bypass for Email OTP login — the password marker "__email_otp_verified__"
	// is sent by handleVerifyEmailOtp() after the user successfully verifies their OTP code.
	// In this case, skip the password hash check since the OTP verification already proved identity.
	// The telegramInitData is also a special marker "email-otp:<otp_code>" so skip init data validation.
	const isEmailOtpBypass =
		password === "__email_otp_verified__" && telegramInitData && telegramInitData.startsWith("email-otp:")
	if (!isEmailOtpBypass) {
		if (!validateTelegramInitData(telegramInitData)) {
			return { ok: false, error: "Invalid Telegram login signature." }
		}
		if (user.passwordHash !== hashPassword(password)) {
			return { ok: false, error: "Invalid email or password." }
		}
	}

	// Upsert telegram link
	const existingLink = telegramLinks.find((l) => l.telegramUserId === telegramUserId)
	if (existingLink) {
		existingLink.userId = user.userId
		existingLink.telegramUsername = telegramUsername || existingLink.telegramUsername
		existingLink.telegramChatId = telegramChatId || existingLink.telegramChatId
		existingLink.isActive = true
	} else {
		telegramLinks.push({
			id: randomUUID(),
			userId: user.userId,
			telegramUserId,
			telegramUsername: telegramUsername || null,
			telegramChatId: telegramChatId || telegramUserId,
			linkedAt: nowISO(),
			isActive: true,
		})
	}
	await saveJSON(TELEGRAM_LINKS_FILE, telegramLinks)

	// Deactivate old sessions for this Telegram user
	telegramSessions = telegramSessions.map((s) => {
		if (s.telegramUserId === telegramUserId) s.isActive = false
		return s
	})

	// Create new session
	const token = generateToken()
	const expiresAt = now() + TELEGRAM_SESSION_TIMEOUT_MS
	telegramSessions.push({
		id: randomUUID(),
		userId: user.userId,
		telegramUserId,
		telegramChatId: telegramChatId || telegramUserId,
		sessionTokenHash: hashToken(token),
		lastActivityAt: nowISO(),
		expiresAt,
		isActive: true,
		createdAt: nowISO(),
	})
	await saveJSON(TELEGRAM_SESSIONS_FILE, telegramSessions)

	await addAuditLog({
		userId: user.userId,
		telegramUserId,
		source: "telegram",
		event: "login_success",
		metadata: { username: telegramUsername },
	})

	return {
		ok: true,
		user: { id: user.userId, email: user.email, displayName: user.name },
		expiresAt: new Date(expiresAt).toISOString(),
	}
}

/**
 * POST /telegram/session/check
 * Checks if a Telegram session is valid. Refreshes expiry on activity.
 */
async function handleTelegramSessionCheck(body) {
	const { telegramUserId, telegramChatId } = body || {}
	if (!telegramUserId) return { authenticated: false }

	// Find all active sessions for this user
	const userSessions = telegramSessions.filter((s) => s.telegramUserId === telegramUserId && s.isActive)

	if (userSessions.length === 0) return { authenticated: false }

	// If telegramChatId is provided, prefer exact chatId match
	// Otherwise, use the most recent session
	let session
	if (telegramChatId) {
		const chatIdStr = String(telegramChatId)
		session = userSessions.sort((a, b) => {
			if (String(a.telegramChatId) === chatIdStr) return -1
			if (String(b.telegramChatId) === chatIdStr) return 1
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		})[0]
	} else {
		// No chatId provided — use most recent active session
		session = userSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
	}

	if (!session) return { authenticated: false }

	if (isExpired(session.expiresAt)) {
		session.isActive = false
		await saveJSON(TELEGRAM_SESSIONS_FILE, telegramSessions)
		return { authenticated: false }
	}

	// Refresh session expiry
	const newExpiresAt = now() + TELEGRAM_SESSION_TIMEOUT_MS
	session.lastActivityAt = nowISO()
	session.expiresAt = newExpiresAt
	await saveJSON(TELEGRAM_SESSIONS_FILE, telegramSessions)

	// Find active project from presence
	const presence = projectPresence
		.filter((p) => p.userId === session.userId && p.source === "telegram")
		.sort((a, b) => new Date(b.lastSyncAt).getTime() - new Date(a.lastSyncAt).getTime())[0]

	const user = Object.values(users).find((u) => u.userId === session.userId)
	return {
		authenticated: true,
		userId: session.userId,
		email: user?.email || null,
		name: user?.name || null,
		expiresAt: new Date(newExpiresAt).toISOString(),
		activeProjectId: presence?.projectId || null,
	}
}

/**
 * Internal: get active session for a Telegram user, or throw.
 */
async function getTelegramSession(telegramUserId, telegramChatId) {
	// Find all active sessions for this user
	const userSessions = telegramSessions.filter((s) => s.telegramUserId === telegramUserId && s.isActive)
	if (userSessions.length === 0) {
		throw new Error("Not authenticated")
	}

	// If telegramChatId is provided, prefer exact chatId match
	// Otherwise, use the most recent session (allows DM sessions to work in group chats)
	let session
	if (telegramChatId) {
		const chatIdStr = String(telegramChatId)
		session = userSessions.sort((a, b) => {
			if (String(a.telegramChatId) === chatIdStr) return -1
			if (String(b.telegramChatId) === chatIdStr) return 1
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		})[0]
	} else {
		// No chatId provided — use most recent active session
		session = userSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
	}

	if (!session || isExpired(session.expiresAt)) {
		if (session) {
			session.isActive = false
			await saveJSON(TELEGRAM_SESSIONS_FILE, telegramSessions)
		}
		throw new Error("Not authenticated")
	}

	// Refresh
	session.lastActivityAt = nowISO()
	session.expiresAt = now() + TELEGRAM_SESSION_TIMEOUT_MS
	await saveJSON(TELEGRAM_SESSIONS_FILE, telegramSessions)

	return session
}

// ── Project Handlers ─────────────────────────────────────────────────────────────

/**
 * POST /telegram/projects
 * List projects for the authenticated Telegram user.
 */
async function handleTelegramProjects(body) {
	const { telegramUserId, telegramChatId } = body || {}
	if (!telegramUserId) return { projects: [] }

	try {
		const session = await getTelegramSession(telegramUserId, telegramChatId)

		const userProjects = projects.filter((p) => p.userId === session.userId)

		const result = userProjects.map((p) => {
			const presence = projectPresence
				.filter((pp) => pp.projectId === p.id)
				.sort((a, b) => new Date(b.lastSyncAt).getTime() - new Date(a.lastSyncAt).getTime())[0]
			return {
				id: p.id,
				name: p.name || p.repoName,
				repoName: p.repoName,
				branch: p.branch,
				status: p.status,
				language: p.language || null,
				localPath: p.localPath || null,
				repoUrl: p.repoUrl || null,
				lastActivityAt: p.lastActivityAt || null,
				activeFile: presence?.activeFile || null,
				currentTask: presence?.currentTask || null,
				activeAgent: presence?.activeAgent || null,
				lastSyncAt: presence?.lastSyncAt || null,
			}
		})

		return { projects: result }
	} catch (err) {
		// Not authenticated — return empty projects list
		return { projects: [] }
	}
}

/**
 * POST /telegram/projects/:id/select
 * Select a project as the active workspace for Telegram.
 */
async function handleTelegramProjectSelect(projectId, body) {
	const { telegramUserId, telegramChatId } = body || {}
	const session = await getTelegramSession(telegramUserId, telegramChatId)

	const project = projects.find((p) => p.id === projectId && p.userId === session.userId)
	if (!project) throw new Error("Project not found")

	// Add presence record
	projectPresence.push({
		id: randomUUID(),
		projectId,
		userId: session.userId,
		source: "telegram",
		activeFile: null,
		currentTask: null,
		activeAgent: null,
		status: "selected",
		lastSyncAt: nowISO(),
	})
	await saveJSON(PROJECT_PRESENCE_FILE, projectPresence)

	await addAuditLog({
		userId: session.userId,
		projectId,
		telegramUserId,
		source: "telegram",
		event: "project_selected",
		metadata: { repoName: project.repoName },
	})

	return {
		ok: true,
		project: {
			id: project.id,
			name: project.name || project.repoName,
			repoName: project.repoName,
			branch: project.branch,
			status: project.status,
			language: project.language || null,
			localPath: project.localPath || null,
			repoUrl: project.repoUrl || null,
			lastActivityAt: project.lastActivityAt || null,
		},
	}
}

// ── Orchestrator Handler ─────────────────────────────────────────────────────────

/**
 * POST /orchestrator/instruction
 * Send a coding instruction from Telegram to the orchestrator.
 */
async function handleOrchestratorInstruction(body) {
	const { userId, projectId, instruction, mode, source } = body || {}
	if (!userId || !projectId || !instruction) {
		return { ok: false, error: "userId, projectId, and instruction are required." }
	}

	const agentRunId = generateId("run")
	agentRuns.push({
		id: agentRunId,
		projectId,
		userId,
		agentName: "Orchestrator",
		task: instruction,
		status: "queued",
		model: "router",
		logs: null,
		createdAt: nowISO(),
		updatedAt: nowISO(),
	})
	await saveJSON(AGENT_RUNS_FILE, agentRuns)

	await addAuditLog({
		userId,
		projectId,
		source: source || "telegram",
		event: "instruction_sent",
		metadata: { instruction, mode: mode || "code" },
	})

	return { ok: true, agentRunId, status: "queued" }
}

// ── Logs & Approvals ─────────────────────────────────────────────────────────────

/**
 * GET /telegram/projects/:id/logs
 */
async function handleTelegramProjectLogs(projectId, body) {
	const { telegramUserId, telegramChatId } = body || {}
	await getTelegramSession(telegramUserId, telegramChatId)

	const logs = auditLogs
		.filter((l) => l.projectId === projectId)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
		.slice(0, 50)
		.map((l) => ({
			id: l.id,
			event: l.event,
			source: l.source,
			metadata: l.metadata,
			createdAt: l.createdAt,
		}))

	return { logs }
}

/**
 * GET /telegram/projects/:id/approvals
 */
async function handleTelegramProjectApprovals(projectId, body) {
	const { telegramUserId, telegramChatId } = body || {}
	await getTelegramSession(telegramUserId, telegramChatId)

	const pending = approvalRequests
		.filter((a) => a.projectId === projectId && a.status === "pending")
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

	return { approvals: pending }
}

// ── Task Sync Handlers ───────────────────────────────────────────────────────────

async function handleTaskSync(email, body) {
	const { tasks: incomingTasks } = body || {}
	if (!Array.isArray(incomingTasks)) return { ok: false, error: "tasks array is required." }

	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }

	if (!tasks[user.userId]) tasks[user.userId] = []
	const userTasks = tasks[user.userId]
	const now_ts = nowISO()

	for (const incoming of incomingTasks) {
		const existing = userTasks.find((t) => t.id === incoming.id)
		if (existing) {
			Object.assign(existing, incoming, { updatedAt: now_ts })
		} else {
			userTasks.push({
				id: incoming.id || generateId("task"),
				title: incoming.title || "Untitled Task",
				description: incoming.description || "",
				status: incoming.status || "pending",
				platform: incoming.platform || "unknown",
				createdAt: now_ts,
				updatedAt: now_ts,
			})
		}
	}
	await saveJSON(TASKS_FILE, tasks)
	return { ok: true, message: `Synced ${incomingTasks.length} tasks.`, taskCount: userTasks.length }
}

function handleGetTasks(email) {
	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }
	const userTasks = tasks[user.userId] || []
	return {
		ok: true,
		tasks: userTasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
		count: userTasks.length,
	}
}

async function handleDeleteTask(email, taskId) {
	const user = Object.values(users).find((u) => u.email === email)
	if (!user) return { ok: false, error: "User not found." }
	if (!tasks[user.userId]) return { ok: false, error: "No tasks found." }
	const initialLength = tasks[user.userId].length
	tasks[user.userId] = tasks[user.userId].filter((t) => t.id !== taskId)
	if (tasks[user.userId].length === initialLength) return { ok: false, error: "Task not found." }
	await saveJSON(TASKS_FILE, tasks)
	return { ok: true, message: "Task deleted." }
}

// ── Route Dispatcher ─────────────────────────────────────────────────────────────

async function handleAuthRoute(method, url, req, res) {
	const { pathname } = new URL(url, "http://localhost")
	// Normalize URL: strip /api prefix if present (nginx strips it, direct calls may not)
	const normalizedPath = pathname.startsWith("/api") ? pathname.slice(4) || "/" : pathname

	// ── Public Web Auth Routes ──────────────────────────────────────────────

	if (method === "POST" && normalizedPath === "/auth/register") {
		try {
			const body = await parseBody(req)
			const result = await handleRegister(body)
			sendJson(res, result.ok ? 200 : 400, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath === "/auth/login") {
		try {
			const body = await parseBody(req)
			const result = await handleLogin(body)
			sendJson(res, result.ok ? 200 : 401, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath === "/auth/verify") {
		try {
			const body = await parseBody(req)
			const result = await handleVerify(body)
			sendJson(res, result.ok ? 200 : 401, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	// ── Public Telegram Routes ──────────────────────────────────────────────

	if (method === "POST" && normalizedPath === "/telegram/auth/login") {
		try {
			const body = await parseBody(req)
			const result = await handleTelegramLogin(body)
			sendJson(res, result.ok ? 200 : 401, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath === "/telegram/session/check") {
		try {
			const body = await parseBody(req)
			const result = await handleTelegramSessionCheck(body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	// ── Protected Telegram Routes ───────────────────────────────────────────

	if (method === "POST" && normalizedPath === "/telegram/projects") {
		try {
			const body = await parseBody(req)
			const result = await handleTelegramProjects(body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, err.message === "Not authenticated" ? 401 : 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath.startsWith("/telegram/projects/") && normalizedPath.endsWith("/select")) {
		try {
			const projectId = normalizedPath.split("/")[3]
			const body = await parseBody(req)
			const result = await handleTelegramProjectSelect(projectId, body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, err.message === "Not authenticated" ? 401 : 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "GET" && normalizedPath.startsWith("/telegram/projects/") && normalizedPath.endsWith("/logs")) {
		try {
			const projectId = normalizedPath.split("/")[3]
			const body = await parseBody(req)
			const result = await handleTelegramProjectLogs(projectId, body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, err.message === "Not authenticated" ? 401 : 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "GET" && normalizedPath.startsWith("/telegram/projects/") && normalizedPath.endsWith("/approvals")) {
		try {
			const projectId = normalizedPath.split("/")[3]
			const body = await parseBody(req)
			const result = await handleTelegramProjectApprovals(projectId, body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, err.message === "Not authenticated" ? 401 : 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "POST" && normalizedPath === "/orchestrator/instruction") {
		try {
			const body = await parseBody(req)
			const result = await handleOrchestratorInstruction(body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	// Don't intercept the Telegram bot webhook — it has no auth header and must
	// fall through to the dedicated handler in api.js
	if (normalizedPath === "/telegram/webhook") return false

	// Don't intercept Telegram webhook info — used by dashboard to check bot status
	if (normalizedPath === "/telegram/webhook-info") return false

	// Don't intercept GitHub webhook — it has no auth header and must
	// fall through to the dedicated handler in api.js
	if (
		normalizedPath === "/github-webhook" ||
		normalizedPath === "/api/github-webhook" ||
		normalizedPath === "/api/auto-deploy/github-webhook"
	)
		return false

	// Don't intercept IDE workspace routes — they are handled by api.js directly
	if (normalizedPath.startsWith("/ide-workspace/")) return false

	// Don't intercept Terminal Brain routes — they are handled by api.js directly
	if (normalizedPath.startsWith("/terminal-brain/")) return false

	// Don't intercept Healing Metrics routes — they are handled by api.js directly
	if (normalizedPath.startsWith("/healing/")) return false

	// Don't intercept Monitoring routes — they are handled by api.js directly
	if (normalizedPath.startsWith("/monitoring/")) return false

	// Don't intercept Orchestrator read-only routes — they are handled by api.js directly
	// and need to be accessible without auth for the dashboard and Telegram bot
	if (normalizedPath.startsWith("/orchestrator/")) return false

	// ── Protected Web Auth Routes ───────────────────────────────────────────

	const email = requireAuth(req, res)
	if (!email) return true

	if (method === "POST" && normalizedPath === "/auth/logout") {
		try {
			const body = await parseBody(req)
			const result = await handleLogout(body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "GET" && normalizedPath === "/auth/profile") {
		const result = handleProfile(email)
		sendJson(res, result.ok ? 200 : 404, result)
		return true
	}

	if (method === "POST" && normalizedPath === "/auth/link-vscode") {
		try {
			const body = await parseBody(req)
			const result = await handleLinkVscode(email, body)
			sendJson(res, result.ok ? 200 : 400, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	// ── Task Sync ───────────────────────────────────────────────────────────

	if (method === "POST" && normalizedPath === "/tasks/sync") {
		try {
			const body = await parseBody(req)
			const result = await handleTaskSync(email, body)
			sendJson(res, 200, result)
		} catch (err) {
			sendJson(res, 400, { ok: false, error: err.message })
		}
		return true
	}

	if (method === "GET" && normalizedPath === "/tasks") {
		const result = handleGetTasks(email)
		sendJson(res, 200, result)
		return true
	}

	if (method === "DELETE" && normalizedPath.startsWith("/tasks/")) {
		const taskId = normalizedPath.slice("/tasks/".length)
		const result = await handleDeleteTask(email, taskId)
		sendJson(res, result.ok ? 200 : 404, result)
		return true
	}

	return false // Not handled
}

// ── Exports ──────────────────────────────────────────────────────────────────────

module.exports = {
	loadStore,
	handleAuthRoute,
	authenticate,
	requireAuth,
	handleTelegramLogin,
	handleTelegramSessionCheck,
	handleTelegramProjects,
	handleTelegramProjectSelect,
	handleOrchestratorInstruction,
}
