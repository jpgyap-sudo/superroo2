"use client"

import { useState, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
	Users,
	UserPlus,
	UserMinus,
	FileCode,
	Lock,
	Unlock,
	MousePointer2,
	RefreshCw,
	Play,
	StopCircle,
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Clock,
	Copy,
	Share2,
	Link2,
	MessageSquare,
	Eye,
	EyeOff,
	Search,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

interface Collaborator {
	sessionId: string
	userId: string
	userName: string
	workspaceId: string
	joinedAt: number
	cursor?: { line: number; column: number }
	selection?: { start: { line: number; column: number }; end: { line: number; column: number } }
}

interface CollaborationSession {
	id: string
	workspaceId: string
	collaborators: Collaborator[]
	createdAt: number
	status: "active" | "closed"
}

interface SharedWorkspace {
	id: string
	name: string
	rootPath: string
	openFiles: string[]
	fileLocks: Map<string, string>
	createdAt: number
	status: "active" | "archived"
}

interface FileSnapshot {
	filePath: string
	content: string
	version: number
	lastModified: number
	lastModifiedBy: string
}

interface CursorUpdate {
	sessionId: string
	userId: string
	userName: string
	position: { line: number; column: number }
	selection?: { start: { line: number; column: number }; end: { line: number; column: number } }
	timestamp: number
}

// ── API Helpers ────────────────────────────────────────────────────────────

const API_BASE = ""

async function fetchSessions(): Promise<CollaborationSession[]> {
	try {
		const res = await fetch(`${API_BASE}/collaboration/sessions`)
		if (!res.ok) return []
		const data = await res.json()
		return data.sessions || []
	} catch {
		return []
	}
}

async function fetchSessionCollaborators(sessionId: string): Promise<Collaborator[]> {
	try {
		const res = await fetch(`${API_BASE}/collaboration/collaborators/${encodeURIComponent(sessionId)}`)
		if (!res.ok) return []
		const data = await res.json()
		return data.collaborators || []
	} catch {
		return []
	}
}

async function fetchCollaborationStatus(): Promise<{ available: boolean; sessionCount: number }> {
	try {
		const res = await fetch(`${API_BASE}/collaboration/status`)
		if (!res.ok) return { available: false, sessionCount: 0 }
		const data = await res.json()
		return { available: data.available ?? false, sessionCount: data.sessionCount ?? 0 }
	} catch {
		return { available: false, sessionCount: 0 }
	}
}

// ── Sub-Components ─────────────────────────────────────────────────────────

function CollaboratorAvatar({ name, isOnline = true }: { name: string; isOnline?: boolean }) {
	const initials = name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2)

	const colors = [
		"bg-blue-500",
		"bg-green-500",
		"bg-purple-500",
		"bg-orange-500",
		"bg-pink-500",
		"bg-teal-500",
		"bg-indigo-500",
		"bg-rose-500",
	]
	const colorIndex = name.length % colors.length

	return (
		<div className="relative inline-flex items-center justify-center">
			<div
				className={cn(
					"flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white",
					colors[colorIndex],
				)}>
				{initials}
			</div>
			{isOnline && (
				<span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
					<span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
				</span>
			)}
		</div>
	)
}

function CursorBadge({ cursor, userName }: { cursor: CursorUpdate; userName: string }) {
	return (
		<div className="flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
			<MousePointer2 className="h-3 w-3" />
			<span className="font-medium">{userName}</span>
			<span className="text-blue-400/60">
				L:{cursor.position.line} C:{cursor.position.column}
			</span>
		</div>
	)
}

function SessionCard({ session }: { session: CollaborationSession }) {
	const [showDetails, setShowDetails] = useState(false)

	const duration = Math.floor((Date.now() - session.createdAt) / 60000)
	const durationStr = duration >= 60 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : `${duration}m`

	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]">
			<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5">
						<Users className="h-4 w-4 text-gray-200" />
						<span className="text-sm font-medium text-gray-200">{session.workspaceId}</span>
					</div>
					<Badge status={session.status === "active" ? "active" : "idle"} className="text-xs" />
				</div>
				<div className="flex items-center gap-3">
					<span className="text-xs text-gray-500">
						{session.collaborators.length} collaborator{session.collaborators.length !== 1 ? "s" : ""}
					</span>
					<span className="text-xs text-gray-500">{durationStr}</span>
					<button
						onClick={() => setShowDetails(!showDetails)}
						className="rounded p-1 text-gray-500 hover:bg-[#1a1f2e]">
						<Eye className={cn("h-3.5 w-3.5", showDetails && "text-blue-400")} />
					</button>
				</div>
			</div>

			{/* Collaborators */}
			<div className="space-y-2 px-4 py-3">
				{session.collaborators.map((collab) => (
					<div
						key={collab.sessionId}
						className="flex items-center justify-between rounded-md bg-[#1a1f2e] px-3 py-2">
						<div className="flex items-center gap-3">
							<CollaboratorAvatar name={collab.userName} />
							<div>
								<div className="text-sm font-medium text-gray-200">{collab.userName}</div>
								<div className="text-xs text-gray-500">
									Joined {Math.floor((Date.now() - collab.joinedAt) / 60000)}m ago
								</div>
							</div>
						</div>
						{collab.cursor && (
							<CursorBadge
								cursor={{
									sessionId: session.id,
									userId: collab.userId,
									userName: collab.userName,
									position: collab.cursor,
									timestamp: Date.now(),
								}}
								userName={collab.userName}
							/>
						)}
					</div>
				))}
			</div>

			{/* Details */}
			{showDetails && (
				<div className="border-t border-[#1e2535] px-4 py-3">
					<div className="mb-2 text-xs font-medium text-gray-500">Session Details</div>
					<div className="space-y-1 text-xs text-gray-500">
						<div className="flex justify-between">
							<span>Session ID</span>
							<code className="rounded bg-[#1a1f2e] px-1 font-mono">{session.id}</code>
						</div>
						<div className="flex justify-between">
							<span>Workspace</span>
							<span>{session.workspaceId}</span>
						</div>
						<div className="flex justify-between">
							<span>Created</span>
							<span>{new Date(session.createdAt).toLocaleString()}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

function WorkspaceCard({ workspace }: { workspace: SharedWorkspace }) {
	const [showFiles, setShowFiles] = useState(false)

	const lockEntries = Array.from(workspace.fileLocks.entries())

	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]">
			<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
				<div className="flex items-center gap-3">
					<FileCode className="h-4 w-4 text-gray-200" />
					<span className="text-sm font-medium text-gray-200">{workspace.name}</span>
					<Badge
						status={workspace.status === "active" ? "active" : "warning"}
						label={workspace.status}
						className="text-xs"
					/>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-gray-500">{workspace.openFiles.length} open</span>
					{lockEntries.length > 0 && (
						<Badge status="warning" label={`${lockEntries.length} locked`} className="text-xs" />
					)}
					<button
						onClick={() => setShowFiles(!showFiles)}
						className="rounded p-1 text-gray-500 hover:bg-[#1a1f2e]">
						<Eye className={cn("h-3.5 w-3.5", showFiles && "text-blue-400")} />
					</button>
				</div>
			</div>

			<div className="px-4 py-2">
				<div className="text-xs text-gray-500">
					Root: <code className="rounded bg-[#1a1f2e] px-1 font-mono">{workspace.rootPath}</code>
				</div>
			</div>

			{showFiles && (
				<div className="border-t border-[#1e2535] px-4 py-3">
					<div className="mb-2 text-xs font-medium text-gray-500">Open Files</div>
					<div className="space-y-1">
						{workspace.openFiles.map((file) => {
							const lockOwner = lockEntries.find(([, f]) => f === file)
							return (
								<div
									key={file}
									className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[#1a1f2e]">
									<div className="flex items-center gap-2">
										<FileCode className="h-3 w-3 text-gray-500" />
										<span className="font-mono text-gray-200">{file}</span>
									</div>
									{lockOwner ? (
										<div className="flex items-center gap-1 text-orange-400">
											<Lock className="h-3 w-3" />
											<span>{lockOwner[0]}</span>
										</div>
									) : (
										<div className="flex items-center gap-1 text-green-400">
											<Unlock className="h-3 w-3" />
											<span>free</span>
										</div>
									)}
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

function LiveCursorsPanel({ cursors }: { cursors: CursorUpdate[] }) {
	return (
		<div className="rounded-lg border border-[#1e2535] bg-[#0f1117]">
			<div className="flex items-center justify-between border-b border-[#1e2535] px-4 py-3">
				<div className="flex items-center gap-2">
					<MousePointer2 className="h-4 w-4 text-gray-200" />
					<span className="text-sm font-medium text-gray-200">Live Cursors</span>
				</div>
				<Badge status="active" label={`${cursors.length} active`} className="text-xs" />
			</div>
			<div className="space-y-2 px-4 py-3">
				{cursors.length === 0 ? (
					<div className="py-4 text-center text-xs text-gray-500">No active cursors</div>
				) : (
					cursors.map((cursor) => (
						<div
							key={`${cursor.sessionId}_${cursor.userId}`}
							className="flex items-center justify-between rounded-md bg-[#1a1f2e] px-3 py-2">
							<div className="flex items-center gap-2">
								<CollaboratorAvatar name={cursor.userName} />
								<span className="text-sm text-gray-200">{cursor.userName}</span>
							</div>
							<div className="flex items-center gap-3 text-xs text-gray-500">
								<span>
									L:{cursor.position.line} C:{cursor.position.column}
								</span>
								<span>{Math.floor((Date.now() - cursor.timestamp) / 1000)}s ago</span>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	)
}

// ── Main View ──────────────────────────────────────────────────────────────

export function CollaborationView() {
	const [sessions, setSessions] = useState<CollaborationSession[]>([])
	const [workspaces, setWorkspaces] = useState<SharedWorkspace[]>([])
	const [cursors, setCursors] = useState<CursorUpdate[]>([])
	const [activeTab, setActiveTab] = useState<"sessions" | "workspaces" | "cursors">("sessions")
	const [isLive, setIsLive] = useState(true)
	const [searchQuery, setSearchQuery] = useState("")
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [backendAvailable, setBackendAvailable] = useState(false)

	// Fetch collaboration data from the real backend
	const fetchData = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			// Check backend availability
			const status = await fetchCollaborationStatus()
			setBackendAvailable(status.available)

			// Fetch sessions
			const sessionData = await fetchSessions()
			setSessions(sessionData)

			// Fetch collaborators for each session to build cursor data
			const allCursors: CursorUpdate[] = []
			for (const session of sessionData) {
				const collaborators = await fetchSessionCollaborators(session.id)
				for (const collab of collaborators) {
					if (collab.cursor) {
						allCursors.push({
							sessionId: session.id,
							userId: collab.userId,
							userName: collab.userName,
							position: collab.cursor,
							timestamp: collab.joinedAt,
						})
					}
				}
			}
			setCursors(allCursors)
		} catch (err: any) {
			setError(err.message || "Failed to fetch collaboration data")
		} finally {
			setLoading(false)
		}
	}, [])

	// Initial fetch
	useEffect(() => {
		fetchData()
	}, [fetchData])

	// Poll for live updates
	useEffect(() => {
		if (!isLive) return

		const interval = setInterval(() => {
			fetchData()
		}, 5000)

		return () => clearInterval(interval)
	}, [isLive, fetchData])

	const filteredSessions = sessions.filter(
		(s) =>
			s.workspaceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			s.collaborators.some((c) => c.userName.toLowerCase().includes(searchQuery.toLowerCase())),
	)

	const filteredWorkspaces = workspaces.filter(
		(w) =>
			w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			w.id.toLowerCase().includes(searchQuery.toLowerCase()),
	)

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Users className="h-5 w-5 text-gray-200" />
					<h1 className="text-lg font-semibold text-gray-200">Collaboration</h1>
					<Badge
						status={backendAvailable ? "active" : "idle"}
						label={backendAvailable ? "Live" : "Offline"}
						className="text-xs"
					/>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setIsLive(!isLive)}
						className={cn(
							"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
							isLive
								? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
								: "bg-[#1a1f2e] text-gray-500 hover:bg-[#1a1f2e]",
						)}>
						{isLive ? (
							<>
								<span className="flex h-2 w-2 rounded-full bg-green-500" />
								Live
							</>
						) : (
							<>
								<EyeOff className="h-3 w-3" />
								Paused
							</>
						)}
					</button>
					<button
						onClick={fetchData}
						disabled={loading}
						className="flex items-center gap-1.5 rounded-md bg-[#1a1f2e] px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-[#1a1f2e] disabled:opacity-50">
						<RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
						Refresh
					</button>
				</div>
			</div>

			{/* Search */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
				<input
					type="text"
					placeholder="Search sessions, workspaces, or collaborators..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="w-full rounded-md border border-[#1e2535] bg-[#0a0e1a] py-2 pl-10 pr-4 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
				/>
			</div>

			{/* Error banner */}
			{error && (
				<div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{/* Backend unavailable notice */}
			{!loading && !backendAvailable && !error && (
				<div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-400">
					<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
					<span>
						Collaboration backend is not available. Start the API server to enable real-time collaboration.
					</span>
				</div>
			)}

			{/* Tabs */}
			<div className="flex gap-1 rounded-lg border border-[#1e2535] bg-[#0f1117] p-1">
				{[
					{ id: "sessions" as const, icon: Users, label: "Sessions", count: sessions.length },
					{ id: "workspaces" as const, icon: FileCode, label: "Workspaces", count: workspaces.length },
					{ id: "cursors" as const, icon: MousePointer2, label: "Cursors", count: cursors.length },
				].map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
							activeTab === tab.id ? "bg-[#1a1f2e] text-gray-200" : "text-gray-500 hover:text-gray-200",
						)}>
						<tab.icon className="h-4 w-4" />
						<span>{tab.label}</span>
						<Badge status="idle" label={String(tab.count)} className="ml-1 text-xs" />
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 space-y-4 overflow-y-auto">
				{loading ? (
					<div className="flex flex-col items-center justify-center py-12 text-gray-500">
						<RefreshCw className="mb-3 h-8 w-8 animate-spin opacity-30" />
						<p className="text-sm">Loading collaboration data...</p>
					</div>
				) : activeTab === "sessions" ? (
					<>
						{filteredSessions.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-gray-500">
								<Users className="mb-3 h-12 w-12 opacity-20" />
								<p className="text-sm">No active collaboration sessions</p>
								<p className="mt-1 text-xs">Share a workspace to start collaborating</p>
							</div>
						) : (
							filteredSessions.map((session) => <SessionCard key={session.id} session={session} />)
						)}
					</>
				) : activeTab === "workspaces" ? (
					<>
						{filteredWorkspaces.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-gray-500">
								<FileCode className="mb-3 h-12 w-12 opacity-20" />
								<p className="text-sm">No shared workspaces</p>
								<p className="mt-1 text-xs">Register a workspace to enable collaboration</p>
							</div>
						) : (
							filteredWorkspaces.map((workspace) => (
								<WorkspaceCard key={workspace.id} workspace={workspace} />
							))
						)}
					</>
				) : (
					<LiveCursorsPanel cursors={cursors} />
				)}
			</div>

			{/* Status bar */}
			<div className="flex items-center justify-between border-t border-[#1e2535] pt-2 text-xs text-gray-500">
				<div className="flex items-center gap-4">
					<span>
						<Users className="mr-1 inline-block h-3 w-3" />
						{sessions.reduce((acc, s) => acc + s.collaborators.length, 0)} total collaborators
					</span>
					<span>
						<FileCode className="mr-1 inline-block h-3 w-3" />
						{workspaces.reduce((acc, w) => acc + w.openFiles.length, 0)} open files
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="flex items-center gap-1">
						<span
							className={cn("h-2 w-2 rounded-full", backendAvailable ? "bg-green-500" : "bg-yellow-500")}
						/>
						{backendAvailable ? "Connected" : "Offline"}
					</span>
				</div>
			</div>
		</div>
	)
}
