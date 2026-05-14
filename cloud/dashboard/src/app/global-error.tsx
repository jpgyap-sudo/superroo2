"use client"

import { useEffect } from "react"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		console.error("[Dashboard GlobalErrorBoundary]", error)
	}, [error])

	return (
		<html lang="en">
			<body className="antialiased" style={{ margin: 0, background: "#070b14", color: "#e2e8f0" }}>
				<div
					style={{
						display: "flex",
						height: "100vh",
						alignItems: "center",
						justifyContent: "center",
						padding: "24px",
						background: "#070b14",
					}}>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							textAlign: "center",
							maxWidth: "400px",
						}}>
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#f85149"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ marginBottom: "16px" }}>
							<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
						<h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px 0" }}>
							Critical Application Error
						</h2>
						<p style={{ fontSize: "14px", color: "#8b949e", margin: "0 0 24px 0" }}>
							A critical error occurred while loading the dashboard. Please try again.
						</p>
						{error.digest && (
							<p
								style={{
									fontSize: "10px",
									color: "#484f58",
									marginBottom: "16px",
									fontFamily: "monospace",
								}}>
								Error ID: {error.digest}
							</p>
						)}
						<button
							onClick={() => reset()}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								padding: "8px 16px",
								background: "#1f6feb",
								color: "#fff",
								fontSize: "14px",
								border: "none",
								borderRadius: "8px",
								cursor: "pointer",
							}}>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<polyline points="23 4 23 10 17 10" />
								<polyline points="1 20 1 14 7 14" />
								<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
							</svg>
							Try again
						</button>
					</div>
				</div>
			</body>
		</html>
	)
}
