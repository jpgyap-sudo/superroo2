"use client"

import type { DiffData, DiffChange } from "./types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api"

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const token = typeof window !== "undefined" ? localStorage.getItem("superroo_auth_token") : null
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	}
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: { ...headers, ...(init?.headers as Record<string, string>) },
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`API ${res.status}: ${text.slice(0, 200)}`)
	}
	return res.json()
}

/* ── Workspace ─────────────────────────────────────────── */

export async function fetchWorkspace() {
	return apiFetch<{ files: any[]; openFiles: any[]; tasks: any[]; recentWorkspaces: any[] }>("/workspace")
}

export async function fetchFileContent(filePath: string) {
	return apiFetch<{ content: string; language: string }>(
		`/ide-workspace/file/read?path=${encodeURIComponent(filePath)}`,
	)
}

export async function saveFileContent(filePath: string, content: string) {
	return apiFetch<{ success: boolean }>("/ide-workspace/file/save", {
		method: "POST",
		body: JSON.stringify({ path: filePath, content }),
	})
}

export async function createFile(filePath: string, content: string) {
	return apiFetch<{ success: boolean }>("/ide-workspace/file/save", {
		method: "POST",
		body: JSON.stringify({ path: filePath, content }),
	})
}

export async function fetchDiff(filePath: string, content: string) {
	const { content: original } = await fetchFileContent(filePath)
	const diffRes = await apiFetch<{
		changes: Array<{ line: number; original: string; modified: string; type: string }>
	}>("/ide-workspace/diff", {
		method: "POST",
		body: JSON.stringify({ original, modified: content }),
	})
	const changes: DiffChange[] = diffRes.changes.map((c) => ({
		lineNumber: c.line,
		content: c.modified || c.original,
		type: c.type === "added" ? "added" : c.type === "removed" ? "removed" : "unchanged",
	}))
	return {
		filePath,
		original,
		modified: content,
		changes,
	} as DiffData
}

/* ── Terminal ──────────────────────────────────────────── */

export async function sendTerminalCommand(
	command: string,
	sessionId?: string,
	mode: "shell" | "agent" | "skill" = "shell",
) {
	return apiFetch<{ ok: boolean; output: string[]; agent?: string; skill?: string }>(
		"/ide-workspace/terminal/execute",
		{
			method: "POST",
			body: JSON.stringify({ command, terminalId: sessionId || "term-1", mode }),
		},
	)
}

/* ── GitHub Import ─────────────────────────────────────── */

export async function importGithubRepo(repoUrl: string, branch?: string) {
	return apiFetch<{ success: boolean; workspaceId: string }>("/ide-workspace/workspace/import-github", {
		method: "POST",
		body: JSON.stringify({ repoUrl, branch }),
	})
}

/* ── Open Workspace ────────────────────────────────────── */

export async function openWorkspace(path?: string) {
	return apiFetch<{ success: boolean; files: any[] }>("/ide-workspace/workspace/open", {
		method: "POST",
		body: JSON.stringify({ path }),
	})
}

/* ── Orchestrator ──────────────────────────────────────── */

export async function fetchOrchestratorStatus() {
	return apiFetch<{ running: boolean; mode: string; modules: Record<string, any>; tasks: any[] }>(
		"/orchestrator/status",
	)
}

export async function fetchHermesStats() {
	return apiFetch<{ stats: any[] }>("/hermes/stats")
}

export async function fetchDeployments() {
	return apiFetch<{ deployments: any[] }>("/deployments")
}

/* ── Brain / AI Chat ───────────────────────────────────── */

export async function sendBrainMessage(request: {
	message: string
	sessionId?: string
	context?: {
		openFiles?: { path: string; content: string; language: string }[]
		workspaceFiles?: { path: string; content: string }[]
		recentHistory?: { role: string; content: string }[]
	}
}) {
	return apiFetch<{ reply: string; suggestions?: string[] }>("/brain/ask", {
		method: "POST",
		body: JSON.stringify(request),
	})
}

export async function fetchBrainSession(sessionId: string) {
	return apiFetch<{ summary: string; commands: string[] }>(
		`/brain/session?sessionId=${encodeURIComponent(sessionId)}`,
	)
}

/* ── Search ────────────────────────────────────────────── */

export async function searchWorkspaceFiles(query: string) {
	return apiFetch<{ results: { file: string; line: number; content: string; match: string }[] }>(
		`/ide-workspace/search?q=${encodeURIComponent(query)}`,
	)
}

/* ── Git ───────────────────────────────────────────────── */

export async function gitCommand(action: string, payload?: Record<string, string>) {
	return apiFetch<{ success: boolean; output: string }>("/ide-workspace/git", {
		method: "POST",
		body: JSON.stringify({ action, ...payload }),
	})
}

/* ── Diff helpers ──────────────────────────────────────── */

export function computeDiff(original: string, modified: string): DiffChange[] {
	const origLines = original.split("\n")
	const modLines = modified.split("\n")
	const changes: DiffChange[] = []
	const maxLen = Math.max(origLines.length, modLines.length)
	for (let i = 0; i < maxLen; i++) {
		if (i >= origLines.length) {
			changes.push({ type: "added", content: modLines[i], lineNumber: i + 1 })
		} else if (i >= modLines.length) {
			changes.push({ type: "removed", content: origLines[i], lineNumber: i + 1 })
		} else if (origLines[i] !== modLines[i]) {
			changes.push({ type: "removed", content: origLines[i], lineNumber: i + 1 })
			changes.push({ type: "added", content: modLines[i], lineNumber: i + 1 })
		} else {
			changes.push({ type: "unchanged", content: origLines[i], lineNumber: i + 1 })
		}
	}
	return changes
}
