"use client"

import { useState } from "react"

const ALLOWED_EMAIL = "jpgyap@gmail.com"

export function LoginPage({ onLogin }: { onLogin: () => void }) {
	const [email, setEmail] = useState("")
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError("")

		const trimmedEmail = email.trim().toLowerCase()

		if (trimmedEmail !== ALLOWED_EMAIL) {
			setError("Access denied. Only jpgyap@gmail.com is allowed.")
			return
		}

		setLoading(true)

		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: trimmedEmail }),
			})

			const data = await res.json()

			if (!res.ok || !data.ok) {
				setError(data.error || "Access denied.")
				return
			}

			// Store auth token
			localStorage.setItem("superroo_auth_token", data.token)
			localStorage.setItem("superroo_auth_email", trimmedEmail)
			onLogin()
		} catch {
			setError("Network error. Please try again.")
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-[#070b14] px-4">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-sm rounded-xl border border-[#1e2535] bg-[#0a0e1a] p-6 sm:p-8 shadow-2xl">
				<div className="mb-6 text-center">
					<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400">
						<svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</div>
					<h1 className="text-xl font-semibold text-[#e2e8f0]">SuperRoo Dashboard</h1>
					<p className="mt-1 text-sm text-gray-500">Sign in with your email</p>
				</div>

				<div className="space-y-4">
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@email.com"
							autoComplete="email"
							autoFocus
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2.5 sm:py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]"
							required
						/>
					</div>

					{error && (
						<div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
							{error}
						</div>
					)}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-lg bg-[#3b82f6] px-4 py-2.5 sm:py-2 text-sm font-medium text-white hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]">
						{loading ? "Signing in..." : "Sign In"}
					</button>
				</div>

				<p className="mt-6 text-center text-[10px] text-gray-700">SuperRoo Cloud Dashboard v2.0.0</p>
			</form>
		</div>
	)
}
