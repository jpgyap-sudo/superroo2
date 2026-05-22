import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "./globals.css"
import "@/components/ide-terminal/terminal-themes.css"
import { IdeProvider } from "@/lib/ide-store"

export const metadata: Metadata = {
	title: {
		default: "SuperRoo — AI Agent Cloud Platform",
		template: "%s | SuperRoo",
	},
	description:
		"Autonomous AI agent orchestration platform with memory management, cloud deployment, and real-time monitoring. Deploy, manage, and scale AI agents with confidence.",
	manifest: "/manifest.json",
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
		title: "SuperRoo",
	},
	icons: {
		icon: [
			{ url: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
	},
	openGraph: {
		title: "SuperRoo — AI Agent Cloud Platform",
		description: "Autonomous AI agent orchestration, memory management, and cloud deployment platform.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "SuperRoo — AI Agent Cloud Platform",
		description: "Autonomous AI agent orchestration, memory management, and cloud deployment platform.",
	},
}

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	themeColor: "#7c3aed",
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<link rel="manifest" href="/manifest.json" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<meta name="apple-mobile-web-app-title" content="SuperRoo" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="application-name" content="SuperRoo" />
				<meta
					name="keywords"
					content="AI agents, orchestration, cloud deployment, memory management, autonomous agents"
				/>
			</head>
			<body className="antialiased">
				<IdeProvider>{children}</IdeProvider>
			</body>
		</html>
	)
}
