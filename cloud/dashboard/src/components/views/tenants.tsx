"use client"

import { useEffect, useState, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
	Building2,
	Users,
	KeyRound,
	Shield,
	Plus,
	Copy,
	Check,
	X,
	RefreshCw,
	UserPlus,
	UserX,
	Settings,
	Trash2,
	AlertTriangle,
	Loader2,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Tenant {
	tenantId: string
	name: string
	slug: string
	plan: string
	ownerUserId: string
	createdAt: string
	updatedAt: string
	isActive: boolean
	settings: {
		maxUsers: number
		maxProjects: number
		maxAgents: number
		allowTelegram: boolean
		allowCustomDomains: boolean
	}
	role?: string
}

interface TenantMember {
	userId: string
	role: string
	joinedAt: string
}

interface TenantInvite {
	id: string
	tenantId: string
	code: string
	createdBy: string
	createdAt: string
	expiresAt: string
	maxUses: number
	uses: number
	isActive: boolean
}

interface TenantQuota {
	projectsUsed: number
	agentsUsed: number
	usersUsed: number
	storageBytes: number
	apiCallsMonth: number
	monthlyReset: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(ts: string): string {
	try {
		return new Date(ts).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		})
	} catch {
		return ts
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function planColor(plan: string): string {
	switch (plan) {
		case "enterprise":
			return "bg-purple-900/30 text-purple-400 border-purple-700/50"
		case "pro":
			return "bg-blue-900/30 text-blue-400 border-blue-700/50"
		default:
			return "bg-gray-800/50 text-gray-400 border-gray-700/50"
	}
}

// ── Create Tenant Modal ────────────────────────────────────────────────────────

function CreateTenantModal({
	open,
	onClose,
	onCreated,
}: {
	open: boolean
	onClose: () => void
	onCreated: () => void
}) {
	const [name, setName] = useState("")
	const [slug, setSlug] = useState("")
	const [plan, setPlan] = useState("free")
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError("")
		if (!name.trim() || !slug.trim()) {
			setError("Name and slug are required")
			return
		}
		setLoading(true)
		try {
			const res = await fetch("/api/tenants", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + localStorage.getItem("superroo_auth_token"),
				},
				body: JSON.stringify({ name: name.trim(), slug: slug.trim(), plan }),
			})
			const data = await res.json()
			if (!data.ok) throw new Error(data.error || "Failed to create tenant")
			onCreated()
			onClose()
			setName("")
			setSlug("")
			setPlan("free")
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-md rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-6 shadow-2xl">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-[#e2e8f0]">Create Tenant</h2>
					<button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300">
						<X size={18} />
					</button>
				</div>

				<div className="space-y-4">
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Tenant Name</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Organization"
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
							autoFocus
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Slug (URL-friendly)</label>
						<input
							type="text"
							value={slug}
							onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, "").toLowerCase())}
							placeholder="my-org"
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Plan</label>
						<select
							value={plan}
							onChange={(e) => setPlan(e.target.value)}
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-[#3b82f6]">
							<option value="free">Free (5 users, 5 projects)</option>
							<option value="pro">Pro (25 users, 20 projects)</option>
							<option value="enterprise">Enterprise (100 users, 50 projects)</option>
						</select>
					</div>

					{error && (
						<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
							{error}
						</div>
					)}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2563eb] disabled:opacity-50 transition-colors">
						{loading ? "Creating..." : "Create Tenant"}
					</button>
				</div>
			</form>
		</div>
	)
}

// ── Invite Code Display ────────────────────────────────────────────────────────

function InviteCodeDisplay({ code }: { code: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		navigator.clipboard.writeText(code)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="flex items-center gap-2 rounded-lg bg-[#0f1117] border border-[#1e2535] px-3 py-2">
			<code className="flex-1 text-sm font-mono text-[#22c55e]">{code}</code>
			<button
				onClick={handleCopy}
				className="text-gray-500 hover:text-gray-300 transition-colors"
				title="Copy invite code">
				{copied ? <Check size={14} className="text-[#22c55e]" /> : <Copy size={14} />}
			</button>
		</div>
	)
}

// ── Tenant Detail View ─────────────────────────────────────────────────────────

function TenantDetail({ tenant, onBack }: { tenant: Tenant; onBack: () => void }) {
	const [members, setMembers] = useState<TenantMember[]>([])
	const [invites, setInvites] = useState<TenantInvite[]>([])
	const [quota, setQuota] = useState<TenantQuota | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState("")
	const [addEmail, setAddEmail] = useState("")
	const [addRole, setAddRole] = useState("member")
	const [adding, setAdding] = useState(false)
	const [creatingInvite, setCreatingInvite] = useState(false)
	const [newInvite, setNewInvite] = useState<TenantInvite | null>(null)

	const authToken = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : ""

	const fetchDetails = useCallback(async () => {
		setLoading(true)
		try {
			const headers = { Authorization: "Bearer " + authToken }
			const [membersRes, invitesRes, quotaRes] = await Promise.all([
				fetch("/api/tenants/" + tenant.tenantId + "/members", { headers }),
				fetch("/api/tenants/" + tenant.tenantId + "/invites", { headers }),
				fetch("/api/tenants/" + tenant.tenantId + "/quota", { headers }),
			])
			const membersData = await membersRes.json()
			const invitesData = await invitesRes.json()
			const quotaData = await quotaRes.json()
			if (membersData.ok) setMembers(membersData.members)
			if (invitesData.ok) setInvites(invitesData.invites)
			if (quotaData.ok) setQuota(quotaData.quota)
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [tenant.tenantId, authToken])

	useEffect(() => {
		fetchDetails()
	}, [fetchDetails])

	const handleAddMember = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!addEmail.trim()) return
		setAdding(true)
		try {
			// Look up user by email via auth profile endpoint
			const profileRes = await fetch("/auth/profile", {
				headers: { Authorization: "Bearer " + authToken },
			})
			const profileData = await profileRes.json()
			// For now, we need the userId — the auth module needs a user lookup endpoint
			// Use the email as a placeholder; the backend will resolve it
			const res = await fetch("/api/tenants/" + tenant.tenantId + "/members", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
				body: JSON.stringify({ userId: addEmail.trim(), role: addRole }),
			})
			const data = await res.json()
			if (!data.ok) throw new Error(data.error || "Failed to add member")
			setAddEmail("")
			fetchDetails()
		} catch (err: any) {
			setError(err.message)
		} finally {
			setAdding(false)
		}
	}

	const handleRemoveMember = async (userId: string) => {
		try {
			const res = await fetch("/api/tenants/" + tenant.tenantId + "/members/" + userId, {
				method: "DELETE",
				headers: { Authorization: "Bearer " + authToken },
			})
			const data = await res.json()
			if (!data.ok) throw new Error(data.error || "Failed to remove member")
			fetchDetails()
		} catch (err: any) {
			setError(err.message)
		}
	}

	const handleCreateInvite = async () => {
		setCreatingInvite(true)
		setNewInvite(null)
		try {
			const res = await fetch("/api/tenants/" + tenant.tenantId + "/invites", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
				body: JSON.stringify({ maxUses: 10, expiresInDays: 30 }),
			})
			const data = await res.json()
			if (!data.ok) throw new Error(data.error || "Failed to create invite")
			setNewInvite(data.invite)
			fetchDetails()
		} catch (err: any) {
			setError(err.message)
		} finally {
			setCreatingInvite(false)
		}
	}

	const isAdmin = tenant.role === "admin"

	return (
		<div className="space-y-6">
			{/* Back button */}
			<button
				onClick={onBack}
				className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
				← Back to Tenants
			</button>

			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold text-[#e2e8f0]">{tenant.name}</h2>
					<p className="text-xs text-gray-500">/{tenant.slug}</p>
				</div>
				<Badge status={tenant.plan} label={tenant.plan} className={planColor(tenant.plan)} />
			</div>

			{/* Quota bar */}
			{quota && (
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<Card className="border-[#1e2535] bg-[#0f1117] p-3">
						<div className="text-[10px] text-gray-500 uppercase tracking-wider">Users</div>
						<div className="mt-1 text-sm font-semibold text-[#e2e8f0]">
							{quota.usersUsed}/{tenant.settings.maxUsers}
						</div>
					</Card>
					<Card className="border-[#1e2535] bg-[#0f1117] p-3">
						<div className="text-[10px] text-gray-500 uppercase tracking-wider">Projects</div>
						<div className="mt-1 text-sm font-semibold text-[#e2e8f0]">
							{quota.projectsUsed}/{tenant.settings.maxProjects}
						</div>
					</Card>
					<Card className="border-[#1e2535] bg-[#0f1117] p-3">
						<div className="text-[10px] text-gray-500 uppercase tracking-wider">Storage</div>
						<div className="mt-1 text-sm font-semibold text-[#e2e8f0]">
							{formatBytes(quota.storageBytes)}
						</div>
					</Card>
					<Card className="border-[#1e2535] bg-[#0f1117] p-3">
						<div className="text-[10px] text-gray-500 uppercase tracking-wider">API Calls (Month)</div>
						<div className="mt-1 text-sm font-semibold text-[#e2e8f0]">
							{quota.apiCallsMonth.toLocaleString()}
						</div>
					</Card>
				</div>
			)}

			{error && (
				<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
					{error}
				</div>
			)}

			{/* Members */}
			<Card className="border-[#1e2535] bg-[#0f1117]">
				<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
					<div className="flex items-center gap-2">
						<Users size={14} className="text-gray-500" />
						<span className="text-sm font-medium text-[#e2e8f0]">Members ({members.length})</span>
					</div>
					{isAdmin && (
						<form onSubmit={handleAddMember} className="flex items-center gap-2">
							<input
								type="text"
								value={addEmail}
								onChange={(e) => setAddEmail(e.target.value)}
								placeholder="User ID or email"
								className="w-40 rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-xs text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
							/>
							<select
								value={addRole}
								onChange={(e) => setAddRole(e.target.value)}
								className="rounded-lg border border-[#1e2535] bg-[#0a0e1a] px-2 py-1 text-xs text-[#e2e8f0] outline-none">
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
							<button
								type="submit"
								disabled={adding || !addEmail.trim()}
								className="rounded-lg bg-[#3b82f6] px-2 py-1 text-xs text-white hover:bg-[#2563eb] disabled:opacity-50 transition-colors">
								{adding ? "..." : "Add"}
							</button>
						</form>
					)}
				</div>
				<div className="divide-y divide-[#1e2535]">
					{loading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 size={20} className="animate-spin text-gray-500" />
						</div>
					) : members.length === 0 ? (
						<div className="px-4 py-6 text-center text-xs text-gray-500">No members yet</div>
					) : (
						members.map((m) => (
							<div key={m.userId} className="flex items-center justify-between px-4 py-2.5">
								<div className="flex items-center gap-2">
									<div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1e2535] text-[10px] text-gray-400">
										{m.userId.slice(0, 2).toUpperCase()}
									</div>
									<div>
										<div className="text-xs text-[#e2e8f0]">{m.userId}</div>
										<div className="text-[10px] text-gray-500">Joined {formatDate(m.joinedAt)}</div>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Badge
										status={m.role}
										label={m.role}
										className={
											m.role === "admin"
												? "bg-purple-900/30 text-purple-400 border-purple-700/50"
												: "bg-gray-800/50 text-gray-400 border-gray-700/50"
										}
									/>
									{isAdmin && m.role !== "admin" && (
										<button
											onClick={() => handleRemoveMember(m.userId)}
											className="text-gray-600 hover:text-red-400 transition-colors"
											title="Remove member">
											<UserX size={14} />
										</button>
									)}
								</div>
							</div>
						))
					)}
				</div>
			</Card>

			{/* Invite Codes */}
			{isAdmin && (
				<Card className="border-[#1e2535] bg-[#0f1117]">
					<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
						<div className="flex items-center gap-2">
							<KeyRound size={14} className="text-gray-500" />
							<span className="text-sm font-medium text-[#e2e8f0]">Invite Codes</span>
						</div>
						<button
							onClick={handleCreateInvite}
							disabled={creatingInvite}
							className="flex items-center gap-1 rounded-lg bg-[#3b82f6] px-2.5 py-1 text-xs text-white hover:bg-[#2563eb] disabled:opacity-50 transition-colors">
							{creatingInvite ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
							Generate
						</button>
					</div>
					<div className="p-4 space-y-3">
						{newInvite && (
							<div className="rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/5 p-3">
								<div className="mb-1 text-[10px] text-[#22c55e] uppercase tracking-wider">
									New Invite Code
								</div>
								<InviteCodeDisplay code={newInvite.code} />
								<div className="mt-1 text-[10px] text-gray-500">
									Expires {formatDate(newInvite.expiresAt)} · {newInvite.maxUses} max uses
								</div>
							</div>
						)}
						{invites.length === 0 && !newInvite ? (
							<div className="text-center text-xs text-gray-500 py-4">
								No invite codes yet. Generate one to invite team members.
							</div>
						) : (
							invites
								.filter((i) => i.isActive)
								.map((inv) => (
									<div key={inv.id} className="flex items-center justify-between">
										<div>
											<InviteCodeDisplay code={inv.code} />
											<div className="mt-0.5 text-[10px] text-gray-500">
												{inv.uses}/{inv.maxUses} used · Expires {formatDate(inv.expiresAt)}
											</div>
										</div>
									</div>
								))
						)}
					</div>
				</Card>
			)}

			{/* Settings */}
			{isAdmin && (
				<Card className="border-[#1e2535] bg-[#0f1117]">
					<div className="flex items-center gap-2 border-b border-[#1e2535] px-4 py-3">
						<Settings size={14} className="text-gray-500" />
						<span className="text-sm font-medium text-[#e2e8f0]">Settings</span>
					</div>
					<div className="divide-y divide-[#1e2535] text-xs">
						<div className="flex items-center justify-between px-4 py-2.5">
							<span className="text-gray-500">Telegram Integration</span>
							<span className={tenant.settings.allowTelegram ? "text-[#22c55e]" : "text-gray-600"}>
								{tenant.settings.allowTelegram ? "Enabled" : "Disabled"}
							</span>
						</div>
						<div className="flex items-center justify-between px-4 py-2.5">
							<span className="text-gray-500">Custom Domains</span>
							<span className={tenant.settings.allowCustomDomains ? "text-[#22c55e]" : "text-gray-600"}>
								{tenant.settings.allowCustomDomains ? "Enabled" : "Disabled"}
							</span>
						</div>
						<div className="flex items-center justify-between px-4 py-2.5">
							<span className="text-gray-500">Max Users</span>
							<span className="text-[#e2e8f0]">{tenant.settings.maxUsers}</span>
						</div>
						<div className="flex items-center justify-between px-4 py-2.5">
							<span className="text-gray-500">Max Projects</span>
							<span className="text-[#e2e8f0]">{tenant.settings.maxProjects}</span>
						</div>
						<div className="flex items-center justify-between px-4 py-2.5">
							<span className="text-gray-500">Max Agents</span>
							<span className="text-[#e2e8f0]">{tenant.settings.maxAgents}</span>
						</div>
					</div>
				</Card>
			)}
		</div>
	)
}

// ── Main Tenants View ──────────────────────────────────────────────────────────

export function TenantsView() {
	const [tenants, setTenants] = useState<Tenant[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState("")
	const [showCreate, setShowCreate] = useState(false)
	const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
	const [redeemCode, setRedeemCode] = useState("")
	const [redeeming, setRedeeming] = useState(false)
	const [redeemError, setRedeemError] = useState("")

	const fetchTenants = useCallback(async () => {
		setLoading(true)
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const res = await fetch("/api/tenants", {
				headers: { Authorization: "Bearer " + token },
			})
			const data = await res.json()
			if (data.ok) {
				setTenants(data.tenants)
			} else {
				setError(data.error || "Failed to load tenants")
			}
		} catch (err: any) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchTenants()
	}, [fetchTenants])

	const handleRedeem = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!redeemCode.trim()) return
		setRedeeming(true)
		setRedeemError("")
		try {
			const token = localStorage.getItem("superroo_auth_token")
			const res = await fetch("/api/tenants/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
				body: JSON.stringify({ code: redeemCode.trim().toUpperCase() }),
			})
			const data = await res.json()
			if (!data.ok) throw new Error(data.error || "Invalid invite code")
			setRedeemCode("")
			fetchTenants()
		} catch (err: any) {
			setRedeemError(err.message)
		} finally {
			setRedeeming(false)
		}
	}

	if (selectedTenant) {
		return <TenantDetail tenant={selectedTenant} onBack={() => setSelectedTenant(null)} />
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold text-[#e2e8f0]">Organizations</h2>
					<p className="text-xs text-gray-500">Manage your teams and multi-tenant workspaces</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowCreate(true)}
						className="flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2563eb] transition-colors">
						<Plus size={14} />
						New Organization
					</button>
					<button
						onClick={fetchTenants}
						className="rounded-lg border border-[#1e2535] p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
						title="Refresh">
						<RefreshCw size={14} />
					</button>
				</div>
			</div>

			{/* Redeem invite code */}
			<form onSubmit={handleRedeem} className="flex items-center gap-2">
				<input
					type="text"
					value={redeemCode}
					onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
					placeholder="Enter invite code (e.g., A1B2C3D4)"
					className="flex-1 max-w-xs rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-xs text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6]"
				/>
				<button
					type="submit"
					disabled={redeeming || !redeemCode.trim()}
					className="flex items-center gap-1 rounded-lg border border-[#1e2535] px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:opacity-50 transition-colors">
					{redeeming ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
					Redeem
				</button>
				{redeemError && <span className="text-[10px] text-red-400">{redeemError}</span>}
			</form>

			{/* Tenant list */}
			{loading ? (
				<div className="flex items-center justify-center py-12">
					<Loader2 size={24} className="animate-spin text-gray-500" />
				</div>
			) : error ? (
				<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-4 py-3 text-xs text-red-400">
					{error}
				</div>
			) : tenants.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<Building2 size={40} className="text-gray-700 mb-3" />
					<p className="text-sm text-gray-500 mb-1">No organizations yet</p>
					<p className="text-xs text-gray-600">Create an organization to collaborate with your team</p>
				</div>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{tenants.map((t) => (
						<div
							key={t.tenantId}
							className="rounded-lg border border-[#1e2535] bg-[#0f1117] hover:border-[#2a3450] cursor-pointer transition-colors"
							onClick={() => setSelectedTenant(t)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === "Enter") setSelectedTenant(t)
							}}>
							<div className="p-4">
								<div className="flex items-center justify-between mb-3">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1e2535]">
										<Building2 size={18} className="text-gray-400" />
									</div>
									<Badge status={t.plan} label={t.plan} className={planColor(t.plan)} />
								</div>
								<h3 className="text-sm font-semibold text-[#e2e8f0]">{t.name}</h3>
								<p className="text-[10px] text-gray-500 mb-3">/{t.slug}</p>
								<div className="flex items-center gap-3 text-[10px] text-gray-500">
									<span className="flex items-center gap-1">
										<Users size={10} />
										{t.role}
									</span>
									<span>Created {formatDate(t.createdAt)}</span>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			<CreateTenantModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchTenants} />
		</div>
	)
}
