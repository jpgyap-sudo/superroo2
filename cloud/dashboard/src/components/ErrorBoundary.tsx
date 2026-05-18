"use client"

import React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorBoundaryProps {
	children: React.ReactNode
	fallback?: React.ReactNode
	name?: string
}

interface ErrorBoundaryState {
	hasError: boolean
	error: Error | null
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, errorInfo)
	}

	handleRetry = () => {
		this.setState({ hasError: false, error: null })
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback
			}

			const viewName = this.props.name || "this view"

			return (
				<div className="flex flex-col items-center justify-center h-full bg-[#0a0d14] p-6 min-h-[200px]">
					<AlertTriangle className="w-10 h-10 text-[#f85149] mb-3" />
					<h3 className="text-[14px] font-medium text-[#e6edf3] mb-1">Something went wrong</h3>
					<p className="text-[11px] text-[#8b949e] text-center mb-3 max-w-[300px]">
						{this.state.error?.message || `An unexpected error occurred in ${viewName}`}
					</p>
					<button
						className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1f6feb] text-white text-[12px] rounded hover:bg-[#388bfd] transition-colors"
						onClick={this.handleRetry}>
						<RefreshCw className="w-3.5 h-3.5" />
						Retry
					</button>
					<details className="mt-3 max-w-[400px]">
						<summary className="text-[10px] text-[#484f58] cursor-pointer hover:text-[#8b949e]">
							Error details
						</summary>
						<pre className="mt-1 p-2 text-[10px] font-mono text-[#f85149] bg-[#0d1117] rounded border border-[#1e2535] overflow-x-auto whitespace-pre-wrap">
							{this.state.error?.stack || this.state.error?.message || "No details available"}
						</pre>
					</details>
				</div>
			)
		}

		return this.props.children
	}
}
