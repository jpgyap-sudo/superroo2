import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
	title: "SuperRoo Cloud Dashboard",
	description: "Monitor jobs, agents, and system health for SuperRoo Cloud",
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body className="antialiased">{children}</body>
		</html>
	)
}
