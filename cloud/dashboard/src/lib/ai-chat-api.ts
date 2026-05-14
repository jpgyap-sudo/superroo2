"use client"

export interface BrainAskRequest {
	question: string
	projectId?: string
	history?: Array<{ role: string; content: string }>
}

export interface BrainAskResponse {
	ok: boolean
	answer: string
	projectId?: string
	contextCounts?: {
		features: number
		bugs: number
		tasks: number
		deploys: number
	}
	error?: string
}

/**
 * Send a conversational question to the daemon's /brain/ask endpoint.
 * Unlike /brain/run (which submits to the orchestrator queue),
 * this endpoint queries memory and calls Ollama directly for an actual answer.
 */
export async function sendBrainMessage(request: BrainAskRequest): Promise<BrainAskResponse> {
	const res = await fetch("/api/brain/ask", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			question: request.question,
			projectId: request.projectId || "superroo2",
			history: request.history || [],
		}),
	})
	if (!res.ok) {
		const text = await res.text().catch(() => "")
		throw new Error(`Brain API error (${res.status}): ${text || res.statusText}`)
	}
	return res.json()
}

/**
 * Fetch session summary from the daemon.
 */
export async function fetchSessionSummary(projectId = "superroo2"): Promise<string> {
	try {
		const res = await fetch(`/api/brain/session?projectId=${encodeURIComponent(projectId)}`)
		if (!res.ok) return ""
		const data = await res.json()
		return data.summary || ""
	} catch {
		return ""
	}
}
