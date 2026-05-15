/**
 * SuperRoo Cloud — Tenant Manager
 *
 * Multi-tenant support foundation:
 * - Tenant CRUD (create, read, update, delete)
 * - User-tenant associations (membership)
 * - Tenant-scoped data isolation for projects, jobs, agents
 * - Invite codes for self-service onboarding
 * - Usage quotas per tenant
 *
 * Data is persisted as JSON files in the auth data directory.
 * Each tenant gets an isolated namespace for its resources.
 */

const crypto = require("crypto")
const fs = require("fs").promises
const path = require("path")

// ── Configuration ────────────────────────────────────────────────────────────────

const AUTH_DIR = process.env.AUTH_DIR || "/opt/superroo2/cloud/data/auth"
const TENANTS_FILE = path.join(AUTH_DIR, "tenants.json")
const TENANT_MEMBERS_FILE = path.join(AUTH_DIR, "tenant_members.json")
const TENANT_INVITES_FILE = path.join(AUTH_DIR, "tenant_invites.json")
const TENANT_QUOTAS_FILE = path.join(AUTH_DIR, "tenant_quotas.json")

// ── Helpers ──────────────────────────────────────────────────────────────────────

function generateId(prefix) {
	return prefix + "_" + crypto.randomBytes(12).toString("hex")
}

function nowISO() {
	return new Date().toISOString()
}

// ── In-memory stores ─────────────────────────────────────────────────────────────

let tenants = {} // tenantId -> tenant
let tenantMembers = {} // tenantId -> member[]
let tenantInvites = [] // invite[]
let tenantQuotas = {} // tenantId -> quota

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

// ── Initialization ───────────────────────────────────────────────────────────────

async function loadStore() {
	await ensureDir()
	tenants = await loadJSON(TENANTS_FILE, {})
	tenantMembers = await loadJSON(TENANT_MEMBERS_FILE, {})
	tenantInvites = await loadJSON(TENANT_INVITES_FILE, [])
	tenantQuotas = await loadJSON(TENANT_QUOTAS_FILE, {})
	console.log(
		`[tenant-manager] Loaded ${Object.keys(tenants).length} tenants, ${Object.keys(tenantMembers).length} member groups`,
	)
}

// ── Tenant CRUD ──────────────────────────────────────────────────────────────────

/**
 * Create a new tenant.
 * @param {Object} opts
 * @param {string} opts.name - Tenant display name
 * @param {string} opts.slug - URL-friendly unique slug
 * @param {string} opts.ownerUserId - User ID of the tenant owner
 * @param {string} [opts.plan] - Subscription plan (free/pro/enterprise)
 * @returns {Object} The created tenant
 */
async function createTenant({ name, slug, ownerUserId, plan = "free" }) {
	if (!name || !slug || !ownerUserId) {
		throw new Error("name, slug, and ownerUserId are required")
	}

	// Check slug uniqueness
	const existing = Object.values(tenants).find((t) => t.slug === slug)
	if (existing) {
		throw new Error(`Tenant with slug "${slug}" already exists`)
	}

	const tenantId = generateId("tnt")
	const now = nowISO()

	tenants[tenantId] = {
		tenantId,
		name,
		slug,
		plan,
		ownerUserId,
		createdAt: now,
		updatedAt: now,
		isActive: true,
		settings: {
			maxUsers: plan === "enterprise" ? 100 : plan === "pro" ? 25 : 5,
			maxProjects: plan === "enterprise" ? 50 : plan === "pro" ? 20 : 5,
			maxAgents: plan === "enterprise" ? 20 : plan === "pro" ? 10 : 3,
			allowTelegram: plan !== "free",
			allowCustomDomains: plan === "enterprise",
		},
	}

	// Auto-add owner as admin member
	tenantMembers[tenantId] = [
		{
			userId: ownerUserId,
			role: "admin",
			joinedAt: now,
		},
	]

	// Initialize quotas
	tenantQuotas[tenantId] = {
		projectsUsed: 0,
		agentsUsed: 0,
		usersUsed: 1,
		storageBytes: 0,
		apiCallsMonth: 0,
		monthlyReset: now,
	}

	await saveJSON(TENANTS_FILE, tenants)
	await saveJSON(TENANT_MEMBERS_FILE, tenantMembers)
	await saveJSON(TENANT_QUOTAS_FILE, tenantQuotas)

	return tenants[tenantId]
}

/**
 * Get a tenant by ID.
 */
function getTenant(tenantId) {
	return tenants[tenantId] || null
}

/**
 * Get a tenant by slug.
 */
function getTenantBySlug(slug) {
	return Object.values(tenants).find((t) => t.slug === slug) || null
}

/**
 * List all tenants (admin only).
 */
function listTenants() {
	return Object.values(tenants)
}

/**
 * List tenants for a user (tenants where user is a member).
 */
function listUserTenants(userId) {
	const result = []
	for (const [tenantId, members] of Object.entries(tenantMembers)) {
		if (members.some((m) => m.userId === userId)) {
			const tenant = tenants[tenantId]
			if (tenant && tenant.isActive) {
				result.push({
					...tenant,
					role: members.find((m) => m.userId === userId).role,
				})
			}
		}
	}
	return result
}

/**
 * Update a tenant.
 */
async function updateTenant(tenantId, updates) {
	const tenant = tenants[tenantId]
	if (!tenant) throw new Error("Tenant not found")

	const allowed = ["name", "plan", "isActive", "settings"]
	for (const key of allowed) {
		if (updates[key] !== undefined) {
			if (key === "settings" && typeof updates[key] === "object") {
				tenant.settings = { ...tenant.settings, ...updates[key] }
			} else {
				tenant[key] = updates[key]
			}
		}
	}
	tenant.updatedAt = nowISO()

	await saveJSON(TENANTS_FILE, tenants)
	return tenant
}

/**
 * Delete a tenant (soft-deactivate).
 */
async function deleteTenant(tenantId) {
	const tenant = tenants[tenantId]
	if (!tenant) throw new Error("Tenant not found")
	tenant.isActive = false
	tenant.updatedAt = nowISO()
	await saveJSON(TENANTS_FILE, tenants)
	return { ok: true }
}

// ── Membership Management ────────────────────────────────────────────────────────

/**
 * Add a user to a tenant.
 */
async function addMember(tenantId, userId, role = "member") {
	const tenant = tenants[tenantId]
	if (!tenant) throw new Error("Tenant not found")

	if (!tenantMembers[tenantId]) {
		tenantMembers[tenantId] = []
	}

	if (tenantMembers[tenantId].some((m) => m.userId === userId)) {
		throw new Error("User is already a member of this tenant")
	}

	// Check quota
	const quota = tenantQuotas[tenantId]
	if (quota && tenantMembers[tenantId].length >= tenant.settings.maxUsers) {
		throw new Error("Tenant user limit reached")
	}

	tenantMembers[tenantId].push({
		userId,
		role,
		joinedAt: nowISO(),
	})

	if (quota) {
		quota.usersUsed = tenantMembers[tenantId].length
	}

	await saveJSON(TENANT_MEMBERS_FILE, tenantMembers)
	await saveJSON(TENANT_QUOTAS_FILE, tenantQuotas)
	return { ok: true }
}

/**
 * Remove a user from a tenant.
 */
async function removeMember(tenantId, userId) {
	if (!tenantMembers[tenantId]) throw new Error("Tenant has no members")

	const idx = tenantMembers[tenantId].findIndex((m) => m.userId === userId)
	if (idx === -1) throw new Error("User is not a member of this tenant")

	tenantMembers[tenantId].splice(idx, 1)

	const quota = tenantQuotas[tenantId]
	if (quota) {
		quota.usersUsed = tenantMembers[tenantId].length
	}

	await saveJSON(TENANT_MEMBERS_FILE, tenantMembers)
	await saveJSON(TENANT_QUOTAS_FILE, tenantQuotas)
	return { ok: true }
}

/**
 * Update a member's role.
 */
async function updateMemberRole(tenantId, userId, role) {
	if (!tenantMembers[tenantId]) throw new Error("Tenant has no members")
	const member = tenantMembers[tenantId].find((m) => m.userId === userId)
	if (!member) throw new Error("User is not a member of this tenant")
	member.role = role
	await saveJSON(TENANT_MEMBERS_FILE, tenantMembers)
	return { ok: true }
}

/**
 * List members of a tenant.
 */
function listMembers(tenantId) {
	return tenantMembers[tenantId] || []
}

/**
 * Check if a user is a member of a tenant with a specific role.
 */
function checkMembership(tenantId, userId, requiredRole) {
	const members = tenantMembers[tenantId]
	if (!members) return false
	const member = members.find((m) => m.userId === userId)
	if (!member) return false
	if (requiredRole === "admin" && member.role !== "admin") return false
	return true
}

// ── Invite Codes ─────────────────────────────────────────────────────────────────

/**
 * Generate an invite code for a tenant.
 */
async function createInvite(tenantId, createdByUserId, maxUses = 10, expiresInDays = 30) {
	const tenant = tenants[tenantId]
	if (!tenant) throw new Error("Tenant not found")

	const invite = {
		id: generateId("inv"),
		tenantId,
		code: crypto.randomBytes(4).toString("hex").toUpperCase(),
		createdBy: createdByUserId,
		createdAt: nowISO(),
		expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
		maxUses,
		uses: 0,
		isActive: true,
	}

	tenantInvites.push(invite)
	await saveJSON(TENANT_INVITES_FILE, tenantInvites)
	return invite
}

/**
 * Redeem an invite code — adds the user to the tenant.
 */
async function redeemInvite(code, userId) {
	const invite = tenantInvites.find((i) => i.code === code && i.isActive)
	if (!invite) throw new Error("Invalid or expired invite code")
	if (new Date(invite.expiresAt) < new Date()) throw new Error("Invite code has expired")
	if (invite.uses >= invite.maxUses) throw new Error("Invite code has reached maximum uses")

	await addMember(invite.tenantId, userId, "member")

	invite.uses++
	if (invite.uses >= invite.maxUses) {
		invite.isActive = false
	}

	await saveJSON(TENANT_INVITES_FILE, tenantInvites)
	return { ok: true, tenantId: invite.tenantId }
}

/**
 * List invites for a tenant.
 */
function listInvites(tenantId) {
	return tenantInvites.filter((i) => i.tenantId === tenantId)
}

// ── Quota Management ─────────────────────────────────────────────────────────────

/**
 * Get quota for a tenant.
 */
function getQuota(tenantId) {
	return tenantQuotas[tenantId] || null
}

/**
 * Increment a quota counter.
 */
async function incrementQuota(tenantId, field, amount = 1) {
	if (!tenantQuotas[tenantId]) {
		tenantQuotas[tenantId] = {
			projectsUsed: 0,
			agentsUsed: 0,
			usersUsed: 0,
			storageBytes: 0,
			apiCallsMonth: 0,
			monthlyReset: nowISO(),
		}
	}
	tenantQuotas[tenantId][field] = (tenantQuotas[tenantId][field] || 0) + amount
	await saveJSON(TENANT_QUOTAS_FILE, tenantQuotas)
}

/**
 * Check if a tenant has capacity for a resource.
 */
function checkQuota(tenantId, field, requested = 1) {
	const tenant = tenants[tenantId]
	if (!tenant) return false
	const quota = tenantQuotas[tenantId]
	if (!quota) return true // no quota = unlimited
	const current = quota[field] || 0
	const maxKey =
		field.replace("Used", "") === "project"
			? "maxProjects"
			: field.replace("Used", "") === "agent"
				? "maxAgents"
				: field.replace("Used", "") === "user"
					? "maxUsers"
					: null
	if (maxKey && tenant.settings[maxKey] !== undefined) {
		return current + requested <= tenant.settings[maxKey]
	}
	return true
}

// ── Tenant-scoped data helpers ───────────────────────────────────────────────────

/**
 * Get the tenant ID for a user's session.
 * Returns the user's primary tenant or null.
 */
function resolveTenantForUser(userId) {
	for (const [tenantId, members] of Object.entries(tenantMembers)) {
		if (members.some((m) => m.userId === userId)) {
			const tenant = tenants[tenantId]
			if (tenant && tenant.isActive) return tenantId
		}
	}
	return null
}

/**
 * Get all tenant IDs a user belongs to.
 */
function resolveAllTenantsForUser(userId) {
	const result = []
	for (const [tenantId, members] of Object.entries(tenantMembers)) {
		if (members.some((m) => m.userId === userId)) {
			const tenant = tenants[tenantId]
			if (tenant && tenant.isActive) result.push(tenantId)
		}
	}
	return result
}

// ── Exports ──────────────────────────────────────────────────────────────────────

module.exports = {
	loadStore,
	createTenant,
	getTenant,
	getTenantBySlug,
	listTenants,
	listUserTenants,
	updateTenant,
	deleteTenant,
	addMember,
	removeMember,
	updateMemberRole,
	listMembers,
	checkMembership,
	createInvite,
	redeemInvite,
	listInvites,
	getQuota,
	incrementQuota,
	checkQuota,
	resolveTenantForUser,
	resolveAllTenantsForUser,
}
