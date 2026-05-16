import type { Config } from "tailwindcss"

const config: Config = {
	content: [
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			colors: {
				background: "#070b14",
				foreground: "#e2e8f0",
				card: "#0f1117",
				"card-border": "#1e2535",
				muted: "#6b7280",
				"muted-foreground": "#4b5563",
				accent: "#7c3aed",
				"accent-light": "#a78bfa",
				success: "#22c55e",
				warning: "#eab308",
				error: "#ef4444",
				info: "#3b82f6",
				idle: "#3b82f6",
			},
			fontFamily: {
				sans: ["Inter", "system-ui", "sans-serif"],
				mono: ["JetBrains Mono", "monospace"],
			},
		},
	},
	plugins: [],
}

export default config
