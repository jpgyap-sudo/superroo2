import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
	title: "SuperRoo Cloud Dashboard",
	description: "Monitor jobs, agents, and system health for SuperRoo Cloud",
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
}

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	themeColor: "#070b14",
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
			</head>
			<body className="antialiased">{children}</body>
		</html>
	)
}
