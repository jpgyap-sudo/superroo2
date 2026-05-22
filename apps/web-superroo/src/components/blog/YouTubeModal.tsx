"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/modal"

import { extractYouTubeVideoId, extractYouTubeTimestamp, isYouTubeUrl } from "./YouTubeModal.utils"

export { extractYouTubeVideoId, extractYouTubeTimestamp, isYouTubeUrl }

interface YouTubeModalProps {
	/** Whether the modal is open */
	open: boolean
	/** Callback when the modal open state changes */
	onOpenChange: (open: boolean) => void
	/** The YouTube video ID */
	videoId: string
	/** The start time in seconds (optional) */
	startTime?: number
	/** The video title for accessibility (optional) */
	title?: string
}

/**
 * YouTubeModal component
 *
 * A modal dialog that embeds a YouTube video player.
 * Supports starting playback at a specific timestamp.
 *
 * @example
 * ```tsx
 * <YouTubeModal
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   videoId="dQw4w9WgXcQ"
 *   startTime={42}
 *   title="Never Gonna Give You Up"
 * />
 * ```
 */
export function YouTubeModal({ open, onOpenChange, videoId, startTime = 0, title }: YouTubeModalProps) {
	// Build the YouTube embed URL with parameters
	const embedUrl = React.useMemo(() => {
		const params = new URLSearchParams({
			autoplay: "1",
			rel: "0", // Don't show related videos from other channels
			modestbranding: "1", // Minimal YouTube branding
		})

		if (startTime > 0) {
			params.set("start", startTime.toString())
		}

		return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
	}, [videoId, startTime])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl w-[90vw] p-0 overflow-hidden bg-black" aria-describedby={undefined}>
				{/* Visually hidden title for accessibility */}
				<DialogTitle className="sr-only">{title ?? "YouTube Video"}</DialogTitle>
				<div className="relative w-full pt-[56.25%]">
					{/* 16:9 aspect ratio container */}
					{open && (
						<iframe
							className="absolute inset-0 w-full h-full"
							src={embedUrl}
							title={title ?? "YouTube Video"}
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowFullScreen
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default YouTubeModal
