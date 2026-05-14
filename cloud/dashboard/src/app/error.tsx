"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		console.error("[Dashboard ErrorBoundary]", error)
	}, [error])

	return (
		<div className="flex h-screen items-center justify-center bg-[#070b14] p-6">
			<div className="flex flex-col items-center text-center max-w-md">
				<AlertTriangle className="w-12 h-12 text-[#f85149] mb-4" />
				<h2 className="text-lg font-semibold text-[#e2e8f0] mb-2">Something went wrong</h2>
				<p className="text-sm text-[#8b949e] mb-6">
					A client-side error occurred. Please try again or return to the overview.
				</p>
				{error.digest && <p className="text-[10px] text-[#484f58] mb-4 font-mono">Error ID: {error.digest}</p>}
				<div className="flex gap-3">
					<button
						onClick={() => reset()}
						className="flex items-center gap-1.5 px-4 py-2 bg-[#1f6feb] text-white text-sm rounded-lg hover:bg-[#388bfd] transition-colors">
						<RefreshCw className="w-4 h-4" />
						Try again
					</button>
					<button
						onClick={() => (window.location.href = "/")}
						className="flex items-center gap-1.5 px-4 py-2 bg-[#1e2535] text-[#e2e8f0] text-sm rounded-lg hover:bg-[#2a3345] transition-colors">
						<Home className="w-4 h-4" />
						Go to Overview
					</button>
				</div>
				<details className="mt-6 max-w-full">
					<summary className="text-[11px] text-[#484f58] cursor-pointer hover:text-[#8b949e]">
						Error details
					</summary>
					<pre className="mt-2 p-3 text-[11px] font-mono text-[#f85149] bg-[#0d1117] rounded-lg border border-[#1e2535] overflow-x-auto whitespace-pre-wrap text-left max-h-64 overflow-y-auto">
						{error.stack || error.message || "No details available"}
					</pre>
				</details>
			</div>
		</div>
	)
}
