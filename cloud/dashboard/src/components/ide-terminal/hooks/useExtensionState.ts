"use client"

import { useState, useEffect, useCallback } from "react"

export interface ExtensionManifest {
	id: string
	name: string
	version: string
	description: string
	publisher: string
	icon?: string
	categories?: string[]
	tags?: string[]
	installed?: boolean
	enabled?: boolean
	rating?: number
	downloads?: number
	repository?: string
	license?: string
}

const BUILTIN_EXTENSIONS: ExtensionManifest[] = [
	{
		id: "superroo.typescript",
		name: "TypeScript Intelligence",
		version: "1.0.0",
		description: "TypeScript/JavaScript language support with IntelliSense",
		publisher: "SuperRoo",
		categories: ["Programming Languages"],
		tags: ["typescript", "javascript"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 1200,
	},
	{
		id: "superroo.python",
		name: "Python Intelligence",
		version: "1.0.0",
		description: "Python language support with IntelliSense",
		publisher: "SuperRoo",
		categories: ["Programming Languages"],
		tags: ["python"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 800,
	},
	{
		id: "superroo.git",
		name: "Git Integration",
		version: "1.0.0",
		description: "Built-in Git source control",
		publisher: "SuperRoo",
		categories: ["Source Control"],
		tags: ["git"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 2000,
	},
	{
		id: "superroo.ai-assistant",
		name: "AI Assistant",
		version: "1.0.0",
		description: "AI-powered code assistance",
		publisher: "SuperRoo",
		categories: ["AI"],
		tags: ["ai", "assistant"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 3000,
	},
	{
		id: "superroo.telegram",
		name: "Telegram Integration",
		version: "1.0.0",
		description: "Telegram bot integration",
		publisher: "SuperRoo",
		categories: ["Notifications"],
		tags: ["telegram"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 500,
	},
	{
		id: "superroo.theme-dark",
		name: "SuperRoo Dark Theme",
		version: "1.0.0",
		description: "Custom dark theme",
		publisher: "SuperRoo",
		categories: ["Themes"],
		tags: ["theme", "dark"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 1500,
	},
]

const STORAGE_KEY = "superroo-extensions"

function loadExtensions(): ExtensionManifest[] {
	try {
		const saved = localStorage.getItem(STORAGE_KEY)
		if (saved) {
			const parsed = JSON.parse(saved) as ExtensionManifest[]
			// Merge with builtins to ensure new builtins are added
			const merged = [...BUILTIN_EXTENSIONS]
			for (const ext of parsed) {
				const idx = merged.findIndex((b) => b.id === ext.id)
				if (idx >= 0) {
					merged[idx] = { ...merged[idx], ...ext }
				} else {
					merged.push(ext)
				}
			}
			return merged
		}
	} catch {}
	return BUILTIN_EXTENSIONS
}

export function useExtensionState() {
	const [extensions, setExtensions] = useState<ExtensionManifest[]>(loadExtensions)

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(extensions))
	}, [extensions])

	const isEnabled = useCallback(
		(id: string) => {
			const ext = extensions.find((e) => e.id === id)
			return ext?.enabled ?? false
		},
		[extensions],
	)

	const isInstalled = useCallback(
		(id: string) => {
			return extensions.some((e) => e.id === id && e.installed)
		},
		[extensions],
	)

	const toggleEnabled = useCallback((id: string) => {
		setExtensions((prev) => prev.map((ext) => (ext.id === id ? { ...ext, enabled: !ext.enabled } : ext)))
	}, [])

	const install = useCallback((ext: ExtensionManifest) => {
		setExtensions((prev) => {
			if (prev.some((e) => e.id === ext.id)) return prev
			return [...prev, { ...ext, installed: true, enabled: true }]
		})
	}, [])

	const uninstall = useCallback((id: string) => {
		setExtensions((prev) => prev.filter((ext) => ext.id !== id))
	}, [])

	return { extensions, setExtensions, isEnabled, isInstalled, toggleEnabled, install, uninstall }
}
