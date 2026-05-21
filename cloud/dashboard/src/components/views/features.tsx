"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { StatCard } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
	Layers,
	Plus,
	Search,
	X,
	ChevronDown,
	ChevronRight,
	Activity,
	CheckCircle,
	AlertTriangle,
	AlertCircle,
	Trash2,
	Edit3,
	Save,
	Ban,
	RefreshCw,
	FileText,
} from "lucide-react"
import { PieChart, Pie, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"

interface FeatureEntry {
	id: string
	name: string
	description?: string
	status: "planned" | "building" | "testing" | "working" | "deprecated"
	health: "unknown" | "healthy" | "degraded" | "failing"
	tags?: string[]
	owner?: string
	createdAt?: string
	updatedAt?: string
	metadata?: Record<string, unknown>
}

interface FeaturesResponse {
	success: boolean
	features: FeatureEntry[]
	count: number
}

const STATUS_OPTIONS = ["all", "planned", "building", "testing", "working", "deprecated"] as const
const HEALTH_OPTIONS = ["all", "unknown", "healthy", "degraded", "failing"] as const

const STATUS_COLORS: Record<string, string> = {
	planned: "text-blue-400 bg-blue-400/10 border-blue-400/30",
	building: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
	testing: "text-purple-400 bg-purple-400/10 border-purple-400/30",
	working: "text-green-400 bg-green-400/10 border-green-400/30",
	deprecated: "text-gray-500 bg-gray-500/10 border-gray-500/30",
}

const HEALTH_COLORS: Record<string, string> = {
	unknown: "text-gray-400 bg-gray-400/10 border-gray-400/30",
	healthy: "text-green-400 bg-green-400/10 border-green-400/30",
	degraded: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
	failing: "text-red-400 bg-red-400/10 border-red-400/30",
}

const CHART_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6", "#ec4899"]

async function fetchFeatures(status?: string, health?: string): Promise<FeaturesResponse> {
	const params = new URLSearchParams()
	if (status && status !== "all") params.set("status", status)
	if (health && health !== "all") params.set("health", health)
	const qs = params.toString()
	const res = await fetch(`/api/orchestrator/features${qs ? `?${qs}` : ""}`)
	return res.json()
}

async function createFeature(data: Partial<FeatureEntry>): Promise<{ success: boolean; feature?: FeatureEntry }> {
	const res = await fetch("/api/orchestrator/features", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	})
	return res.json()
}

async function updateFeature(id: string, data: Partial<FeatureEntry>): Promise<{ success: boolean; feature?: FeatureEntry }> {
	const res = await fetch(`/api/orchestrator/features/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	})
	return res.json()
}

async function deleteFeature(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`/api/orchestrator/features/${id}`, { method: "DELETE" })
	return res.json()
}

function StatusBadge({ status }: { status: FeatureEntry["status"] }) {
	return (
		<span className={cn("px-2 py-0.5 rounded text-xs font-medium border", STATUS_COLORS[status])}>
			{status}
		</span>
	)
}

function HealthBadge({ health }: { health: FeatureEntry["health"] }) {
	return (
		<span className={cn("px-2 py-0.5 rounded text-xs font-medium border", HEALTH_COLORS[health])}>
			{health}
		</span>
	)
}

function FeatureRow({
	feature,
	onEdit,
	onDelete,
}: {
	feature: FeatureEntry
	onEdit: (f: FeatureEntry) => void
	onDelete: (id: string) => void
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="border border-[#1e2535] rounded-lg bg-[#0f1117]/60 overflow-hidden">
			<div
				className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1f2e]/50 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				<div className="text-gray-500">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium text-white truncate">{feature.name}</span>
						<StatusBadge status={feature.status} />
						<HealthBadge health={feature.health} />
					</div>
					{feature.description && (
						<p className="text-xs text-gray-500 mt-0.5 truncate">{feature.description}</p>
					)}
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={(e) => {
							e.stopPropagation()
							onEdit(feature)
						}}
						className="p-1.5 rounded hover:bg-[#1e2535] text-gray-500 hover:text-blue-400 transition-colors"
						title="Edit"
					>
						<Edit3 size={14} />
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation()
							onDelete(feature.id)
						}}
						className="p-1.5 rounded hover:bg-[#1e2535] text-gray-500 hover:text-red-400 transition-colors"
						title="Delete"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>
			{expanded && (
				<div className="px-4 pb-3 pt-1 border-t border-[#1e2535]">
					<div className="grid grid-cols-2 gap-3 text-xs mt-2">
						<div>
							<span className="text-gray-500">ID:</span>
							<span className="text-gray-300 ml-1 font-mono">{feature.id}</span>
						</div>
						<div>
							<span className="text-gray-500">Owner:</span>
							<span className="text-gray-300 ml-1">{feature.owner || "—"}</span>
						</div>
						<div>
							<span className="text-gray-500">Created:</span>
							<span className="text-gray-300 ml-1">{feature.createdAt ? new Date(feature.createdAt).toLocaleString() : "—"}</span>
						</div>
						<div>
							<span className="text-gray-500">Updated:</span>
							<span className="text-gray-300 ml-1">{feature.updatedAt ? new Date(feature.updatedAt).toLocaleString() : "—"}</span>
						</div>
					</div>
					{feature.tags && feature.tags.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mt-2">
							{feature.tags.map((tag) => (
								<span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-[#1e2535] text-gray-400">
									{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function CreateFeatureForm({
	onCreate,
	onCancel,
}: {
	onCreate: (data: Partial<FeatureEntry>) => Promise<void>
	onCancel: () => void
}) {
	const [name, setName] = useState("")
	const [description, setDescription] = useState("")
	const [status, setStatus] = useState<FeatureEntry["status"]>("planned")
	const [health, setHealth] = useState<FeatureEntry["health"]>("unknown")
	const [owner, setOwner] = useState("")
	const [tags, setTags] = useState("")
	const [saving, setSaving] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!name.trim()) return
		setSaving(true)
		await onCreate({
			name: name.trim(),
			description: description.trim() || undefined,
			status,
			health,
			owner: owner.trim() || undefined,
			tags: tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
		})
		setSaving(false)
	}

	return (
		<form onSubmit={handleSubmit} className="border border-[#1e2535] rounded-lg bg-[#0f1117]/80 p-4 mb-4">
			<h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
				<Plus size={14} className="text-green-400" />
				New Feature
			</h3>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2">
					<label className="text-xs text-gray-500 mb-1 block">Name *</label>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="Feature name"
					/>
				</div>
				<div className="col-span-2">
					<label className="text-xs text-gray-500 mb-1 block">Description</label>
					<input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="Optional description"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Status</label>
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value as FeatureEntry["status"])}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					>
						{STATUS_OPTIONS.filter((s) => s !== "all").map((s) => (
							<option key={s} value={s}>{s}</option>
						))}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Health</label>
					<select
						value={health}
						onChange={(e) => setHealth(e.target.value as FeatureEntry["health"])}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					>
						{HEALTH_OPTIONS.filter((h) => h !== "all").map((h) => (
							<option key={h} value={h}>{h}</option>
						))}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Owner</label>
					<input
						value={owner}
						onChange={(e) => setOwner(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="Optional"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Tags (comma-separated)</label>
					<input
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
						placeholder="e.g. core, ui, api"
					/>
				</div>
			</div>
			<div className="flex gap-2 mt-3">
				<button
					type="submit"
					disabled={saving || !name.trim()}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
				>
					<Save size={12} />
					{saving ? "Creating..." : "Create"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white transition-colors"
				>
					<Ban size={12} />
					Cancel
				</button>
			</div>
		</form>
	)
}

function EditFeatureForm({
	feature,
	onSave,
	onCancel,
}: {
	feature: FeatureEntry
	onSave: (id: string, data: Partial<FeatureEntry>) => Promise<void>
	onCancel: () => void
}) {
	const [name, setName] = useState(feature.name)
	const [description, setDescription] = useState(feature.description || "")
	const [status, setStatus] = useState(feature.status)
	const [health, setHealth] = useState(feature.health)
	const [owner, setOwner] = useState(feature.owner || "")
	const [tags, setTags] = useState((feature.tags || []).join(", "))
	const [saving, setSaving] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!name.trim()) return
		setSaving(true)
		await onSave(feature.id, {
			name: name.trim(),
			description: description.trim() || undefined,
			status,
			health,
			owner: owner.trim() || undefined,
			tags: tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
		})
		setSaving(false)
	}

	return (
		<form onSubmit={handleSubmit} className="border border-[#1e2535] rounded-lg bg-[#0f1117]/80 p-4 mb-4">
			<h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
				<Edit3 size={14} className="text-blue-400" />
				Edit Feature: {feature.name}
			</h3>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2">
					<label className="text-xs text-gray-500 mb-1 block">Name *</label>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					/>
				</div>
				<div className="col-span-2">
					<label className="text-xs text-gray-500 mb-1 block">Description</label>
					<input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Status</label>
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value as FeatureEntry["status"])}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					>
						{STATUS_OPTIONS.filter((s) => s !== "all").map((s) => (
							<option key={s} value={s}>{s}</option>
						))}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Health</label>
					<select
						value={health}
						onChange={(e) => setHealth(e.target.value as FeatureEntry["health"])}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					>
						{HEALTH_OPTIONS.filter((h) => h !== "all").map((h) => (
							<option key={h} value={h}>{h}</option>
						))}
					</select>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Owner</label>
					<input
						value={owner}
						onChange={(e) => setOwner(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-500 mb-1 block">Tags (comma-separated)</label>
					<input
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
					/>
				</div>
			</div>
			<div className="flex gap-2 mt-3">
				<button
					type="submit"
					disabled={saving || !name.trim()}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
				>
					<Save size={12} />
					{saving ? "Saving..." : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1e2535] text-gray-400 hover:text-white transition-colors"
				>
					<Ban size={12} />
					Cancel
				</button>
			</div>
		</form>
	)
}

export function FeaturesView() {
	const [features, setFeatures] = useState<FeatureEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [search, setSearch] = useState("")
	const [statusFilter, setStatusFilter] = useState<string>("all")
	const [healthFilter, setHealthFilter] = useState<string>("all")
	const [showCreate, setShowCreate] = useState(false)
	const [editingFeature, setEditingFeature] = useState<FeatureEntry | null>(null)

	const fetchData = useCallback(async () => {
		try {
			setError(null)
			const data = await fetchFeatures(statusFilter, healthFilter)
			if (data.success) {
				setFeatures(data.features || [])
			} else {
				setError("Failed to fetch features")
			}
		} catch (err) {
			setError("API server unreachable")
		} finally {
			setLoading(false)
		}
	}, [statusFilter, healthFilter])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	const filtered = useMemo(() => {
		return features.filter((f) => {
			if (search) {
				const q = search.toLowerCase()
				if (
					!f.name.toLowerCase().includes(q) &&
					!(f.description || "").toLowerCase().includes(q) &&
					!(f.owner || "").toLowerCase().includes(q)
				)
					return false
			}
			return true
		})
	}, [features, search])

	const stats = useMemo(() => {
		const total = features.length
		const byStatus = STATUS_OPTIONS.filter((s) => s !== "all").map((s) => ({
			name: s,
			count: features.filter((f) => f.status === s).length,
		}))
		const byHealth = HEALTH_OPTIONS.filter((h) => h !== "all").map((h) => ({
			name: h,
			count: features.filter((f) => f.health === h).length,
		}))
		const working = features.filter((f) => f.status === "working").length
		const failing = features.filter((f) => f.health === "failing").length
		return { total, byStatus, byHealth, working, failing }
	}, [features])

	const handleCreate = async (data: Partial<FeatureEntry>) => {
		const result = await createFeature(data)
		if (result.success) {
			setShowCreate(false)
			fetchData()
		}
	}

	const handleUpdate = async (id: string, data: Partial<FeatureEntry>) => {
		const result = await updateFeature(id, data)
		if (result.success) {
			setEditingFeature(null)
			fetchData()
		}
	}

	const handleDelete = async (id: string) => {
		if (!confirm("Delete this feature?")) return
		const result = await deleteFeature(id)
		if (result.success) {
			fetchData()
		}
	}

	return (
		<div className="p-4 space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold text-white flex items-center gap-2">
						<Layers size={18} className="text-blue-400" />
						Feature Registry
					</h1>
					<p className="text-xs text-gray-500 mt-0.5">
						Track feature lifecycle, health, and ownership across the product
					</p>
				</div>
				<button
					onClick={() => {
						setShowCreate(!showCreate)
						setEditingFeature(null)
					}}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
				>
					<Plus size={14} />
					New Feature
				</button>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Total Features"
					value={<><Layers className="inline h-4 w-4 mr-1 text-blue-400" />{stats.total}</>}
				/>
				<StatCard
					label="Working"
					value={<><CheckCircle className="inline h-4 w-4 mr-1 text-green-400" />{stats.working}</>}
				/>
				<StatCard
					label="Failing"
					value={<><AlertTriangle className="inline h-4 w-4 mr-1 text-red-400" />{stats.failing}</>}
				/>
				<StatCard
					label="Statuses"
					value={<><Activity className="inline h-4 w-4 mr-1 text-purple-400" />{stats.byStatus.filter((s) => s.count > 0).length}/5</>}
				/>
			</div>

			{/* Charts */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
					<h3 className="text-xs font-semibold text-gray-400 mb-2">By Status</h3>
					<ResponsiveContainer width="100%" height={140}>
						<PieChart>
							<Pie
								data={stats.byStatus}
								dataKey="count"
								cx="50%"
								cy="50%"
								innerRadius={36}
								outerRadius={58}
							>
								{stats.byStatus.map((_, i) => (
									<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
								))}
							</Pie>
							<Tooltip
								contentStyle={{
									background: "#0f1117",
									border: "1px solid #1e2535",
									borderRadius: "8px",
									fontSize: "12px",
								}}
							/>
						</PieChart>
					</ResponsiveContainer>
					<div className="flex flex-wrap gap-2 mt-1">
						{stats.byStatus.map((s, i) => (
							<div key={s.name} className="flex items-center gap-1 text-[10px]">
								<div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
								<span className="text-gray-500">{s.name}</span>
								<span className="text-gray-300">{s.count}</span>
							</div>
						))}
					</div>
				</div>
				<div className="rounded-xl border border-[#1e2535] bg-gradient-to-b from-[#0f1117] to-[#0a0e1a] p-3">
					<h3 className="text-xs font-semibold text-gray-400 mb-2">By Health</h3>
					<ResponsiveContainer width="100%" height={140}>
						<BarChart data={stats.byHealth}>
							<XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
							<YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
							<Tooltip
								contentStyle={{
									background: "#0f1117",
									border: "1px solid #1e2535",
									borderRadius: "8px",
									fontSize: "12px",
								}}
							/>
							<Bar dataKey="count" radius={[4, 4, 0, 0]}>
								{stats.byHealth.map((_, i) => (
									<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
								))}
							</Bar>
						</BarChart>
					</ResponsiveContainer>
				</div>
			</div>

			{/* Create / Edit Form */}
			{showCreate && (
				<CreateFeatureForm onCreate={handleCreate} onCancel={() => setShowCreate(false)} />
			)}
			{editingFeature && (
				<EditFeatureForm
					feature={editingFeature}
					onSave={handleUpdate}
					onCancel={() => setEditingFeature(null)}
				/>
			)}

			{/* Search & Filters */}
			<div className="flex items-center gap-3 flex-wrap">
				<div className="relative flex-1 min-w-[200px] max-w-xs">
					<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full bg-[#0a0e1a] border border-[#1e2535] rounded pl-8 pr-8 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
						placeholder="Search features..."
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
							<X size={14} />
						</button>
					)}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-gray-500 uppercase tracking-wider">Status:</span>
					{STATUS_OPTIONS.map((s) => (
						<button
							key={s}
							onClick={() => setStatusFilter(s)}
							className={cn(
								"px-2 py-1 rounded text-[11px] font-medium transition-colors",
								statusFilter === s
									? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
									: "text-gray-500 hover:text-gray-300 border border-transparent",
							)}
						>
							{s}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-gray-500 uppercase tracking-wider">Health:</span>
					{HEALTH_OPTIONS.map((h) => (
						<button
							key={h}
							onClick={() => setHealthFilter(h)}
							className={cn(
								"px-2 py-1 rounded text-[11px] font-medium transition-colors",
								healthFilter === h
									? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
									: "text-gray-500 hover:text-gray-300 border border-transparent",
							)}
						>
							{h}
						</button>
					))}
				</div>
			</div>

			{/* Feature List */}
			{loading ? (
				<div className="flex items-center justify-center py-12 text-gray-500">
					<RefreshCw size={20} className="animate-spin mr-2" />
					<span className="text-sm">Loading features...</span>
				</div>
			) : error ? (
				<div className="flex items-center justify-center py-12 text-red-400">
					<AlertCircle size={20} className="mr-2" />
					<span className="text-sm">{error}</span>
				</div>
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-gray-500">
					<FileText size={32} className="mb-2 opacity-50" />
					<p className="text-sm">No features found</p>
					<p className="text-xs mt-1">
						{search ? "Try a different search" : "Create your first feature to get started"}
					</p>
				</div>
			) : (
				<div className="space-y-2">
					<div className="text-xs text-gray-500 mb-1">
						Showing {filtered.length} of {features.length} features
					</div>
					{filtered.map((feature) => (
						<FeatureRow
							key={feature.id}
							feature={feature}
							onEdit={setEditingFeature}
							onDelete={handleDelete}
						/>
					))}
				</div>
			)}
		</div>
	)
}
