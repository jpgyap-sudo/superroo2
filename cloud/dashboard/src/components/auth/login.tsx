"use client"

import { useState } from "react"

export function LoginPage({ onLogin }: { onLogin: () => void }) {
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [name, setName] = useState("")
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)
	const [isRegistering, setIsRegistering] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError("")

		const trimmedEmail = email.trim().toLowerCase()
		if (!trimmedEmail || !password) {
			setError("Email and password are required.")
			return
		}
		if (isRegistering && (!name || name.trim().length < 1)) {
			setError("Name is required for registration.")
			return
		}

		setLoading(true)

		try {
			const endpoint = isRegistering ? "/api/auth/register" : "/api/auth/login"
			const body: Record<string, string> = { email: trimmedEmail, password }
			if (isRegistering) body.name = name.trim()

			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})

			const data = await res.json()

			if (!res.ok || !data.ok) {
				setError(data.error || "Authentication failed.")
				return
			}

			// Store auth token
			localStorage.setItem("superroo_auth_token", data.token)
			localStorage.setItem("superroo_auth_email", trimmedEmail)
			if (data.userId) localStorage.setItem("superroo_user_id", data.userId)
			if (data.name) localStorage.setItem("superroo_user_name", data.name)
			onLogin()
		} catch {
			setError("Network error. Please try again.")
		} finally {
			setLoading(false)
		}
	}

	const toggleMode = () => {
		setIsRegistering(!isRegistering)
		setError("")
		setPassword("")
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
					<p className="mt-1 text-sm text-gray-500">
						{isRegistering ? "Create your account" : "Sign in to your account"}
					</p>
				</div>

				<div className="space-y-4">
					{isRegistering && (
						<div>
							<label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Your name"
								autoComplete="name"
								autoFocus
								className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2.5 sm:py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]"
								required
							/>
						</div>
					)}
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@email.com"
							autoComplete="email"
							autoFocus={!isRegistering}
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2.5 sm:py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]"
							required
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder={isRegistering ? "At least 6 characters" : "Your password"}
							autoComplete={isRegistering ? "new-password" : "current-password"}
							className="w-full rounded-lg border border-[#1e2535] bg-[#0f1117] px-3 py-2.5 sm:py-2 text-sm text-[#e2e8f0] placeholder-gray-600 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]"
							required
							minLength={6}
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
						{loading ? "Please wait..." : isRegistering ? "Create Account" : "Sign In"}
					</button>

					<div className="text-center">
						<button
							type="button"
							onClick={toggleMode}
							className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
							{isRegistering ? "Already have an account? Sign In" : "Don't have an account? Create one"}
						</button>
					</div>
				</div>

				<p className="mt-6 text-center text-[10px] text-gray-700">SuperRoo Cloud Dashboard v2.0.0</p>
			</form>
		</div>
	)
}
