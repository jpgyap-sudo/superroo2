import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.API_URL || "http://127.0.0.1:8787"

export async function GET(req: NextRequest) {
	try {
		const headers: Record<string, string> = {}
		const auth = req.headers.get("authorization")
		if (auth) headers["Authorization"] = auth

		const res = await fetch(`${API_URL}/api/autonomous/status`, {
			headers,
			cache: "no-store",
		})

		const contentType = res.headers.get("content-type") || ""
		if (contentType.includes("application/json")) {
			return NextResponse.json(await res.json())
		}
		return new NextResponse(await res.text(), { status: res.status })
	} catch (err) {
		console.error("[api/autonomous/status] Proxy error:", err)
		// Fallback stub so the UI never gets HTML
		return NextResponse.json({
			success: true,
			running: false,
			currentStep: null,
			stepResults: [],
			cycleCount: 0,
			lastRunAt: null,
			elapsedMs: 0,
			remainingMs: 0,
			progress: 0,
		})
	}
}
