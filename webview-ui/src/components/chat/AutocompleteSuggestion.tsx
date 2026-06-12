import React, { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"

export interface AutocompleteSuggestionProps {
	/** The suggested completion text */
	suggestion: string
	/** Whether the suggestion is loading */
	loading?: boolean
	/** Callback when user accepts the suggestion (Tab) */
	onAccept: () => void
	/** Callback when user dismisses the suggestion (Escape) */
	onDismiss: () => void
	/** Whether autocomplete is available */
	available?: boolean
}

export const AutocompleteSuggestion: React.FC<AutocompleteSuggestionProps> = ({
	suggestion,
	loading = false,
	onAccept,
	onDismiss,
	available = true,
}) => {
	const [visible, setVisible] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (suggestion && available) {
			setVisible(true)
		} else {
			setVisible(false)
		}
	}, [suggestion, available])

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Tab" && visible) {
				e.preventDefault()
				onAccept()
			} else if (e.key === "Escape" && visible) {
				e.preventDefault()
				onDismiss()
				setVisible(false)
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [visible, onAccept, onDismiss])

	if (!visible || !suggestion) {
		return null
	}

	return (
		<div
			ref={containerRef}
			className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-lg border border-vscode-focusBorder bg-vscode-editor-background shadow-lg"
			style={{ maxWidth: "100%" }}>
			<div className="flex items-center gap-2 mb-1">
				<Sparkles size={14} className="text-vscode-textLink-foreground" />
				<span className="text-xs text-vscode-descriptionForeground">
					{loading ? "Generating suggestion..." : "Press Tab to accept, Esc to dismiss"}
				</span>
			</div>
			<div className="text-sm text-vscode-foreground font-mono whitespace-pre-wrap break-words">
				{loading ? (
					<span className="text-vscode-descriptionForeground italic">Thinking...</span>
				) : (
					suggestion
				)}
			</div>
		</div>
	)
}
