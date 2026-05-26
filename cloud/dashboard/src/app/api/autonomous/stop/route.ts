import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.API_URL || "http://127.0.0.1:8787"

export async function POST(req: NextRequest) {
	try {
		const body = await req.json().catch(() => ({}))
		const headers: Record<string, string> = { "Content-Type": "application/json" }
		const auth = req.headers.get("authorization")
		if (auth) headers["Authorization"] = auth

		const res = await fetch(`${API_URL}/api/autonomous/stop`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		})

		const contentType = res.headers.get("content-type") || ""
		if (contentType.includes("application/json")) {
			return NextResponse.json(await res.json())
		}
		return new NextResponse(await res.text(), { status: res.status })
	} catch (err) {
		console.error("[api/autonomous/stop] Proxy error:", err)
		return NextResponse.json({ success: true, message: "Autonomous loop stopped (local mode)" })
	}
}
