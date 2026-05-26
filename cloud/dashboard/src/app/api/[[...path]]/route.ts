import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.API_URL || "http://127.0.0.1:8787"

// Generic proxy for any /api/* request not handled by a specific route.
// This prevents Next.js from returning HTML 404s for API calls.
async function proxyRequest(req: NextRequest, method: string) {
	try {
		const url = new URL(req.url)
		const path = url.pathname + url.search
		const headers: Record<string, string> = {}
		const auth = req.headers.get("authorization")
		if (auth) headers["Authorization"] = auth
		const contentType = req.headers.get("content-type")
		if (contentType) headers["Content-Type"] = contentType

		const body = ["GET", "HEAD"].includes(method) ? undefined : await req.text()

		const res = await fetch(`${API_URL}${path}`, {
			method,
			headers,
			body,
			cache: "no-store",
		})

		const resContentType = res.headers.get("content-type") || ""
		if (resContentType.includes("application/json")) {
			return NextResponse.json(await res.json(), { status: res.status })
		}
		return new NextResponse(await res.text(), { status: res.status })
	} catch (err) {
		console.error(`[api-proxy] ${method} ${req.url} error:`, err)
		return NextResponse.json(
			{ success: false, error: "API proxy failed. Ensure the API server is running on port 8787." },
			{ status: 502 },
		)
	}
}

export async function GET(req: NextRequest) {
	return proxyRequest(req, "GET")
}

export async function POST(req: NextRequest) {
	return proxyRequest(req, "POST")
}

export async function PUT(req: NextRequest) {
	return proxyRequest(req, "PUT")
}

export async function PATCH(req: NextRequest) {
	return proxyRequest(req, "PATCH")
}

export async function DELETE(req: NextRequest) {
	return proxyRequest(req, "DELETE")
}
