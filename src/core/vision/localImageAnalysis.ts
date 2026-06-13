/**
 * Local image analysis via MCP vision tools (Ollama llava, falling back to the
 * central-brain image analyzer).
 *
 * Used when the active model cannot natively see images, or when the user has
 * enabled "Always analyze images locally" (forceLocalImageAnalysis). Pasted /
 * attached images are described as text and that text is injected into the
 * conversation, so a text-only model still gets the image content.
 *
 * Shared by Task#submitUserMessage and the webview newTask / askResponse paths
 * so every send route behaves the same.
 */

/** Minimal structural type for the MCP hub's callTool, to avoid a hard import. */
export interface VisionMcpHub {
	callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>
}

/** Strip a `data:image/...;base64,` prefix so MCP tools get raw base64. */
export function normalizeImageDataForVision(imageData: string): string {
	const trimmed = imageData.trim()
	const dataUrlMatch = trimmed.match(/^data:image\/[\w.+-]+;base64,(.+)$/i)
	return dataUrlMatch?.[1] ?? trimmed
}

/** Pull plain text out of an MCP tool result (string or content-block array). */
export function extractMcpVisionText(result: unknown): string | null {
	if (!result) {
		return null
	}
	const content = (result as { content?: unknown }).content
	if (typeof content === "string") {
		return content.trim() || null
	}
	if (Array.isArray(content)) {
		const text = content
			.map((item) => {
				if (typeof item === "string") {
					return item
				}
				if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
					return (item as { text: string }).text
				}
				return ""
			})
			.filter(Boolean)
			.join("\n")
			.trim()
		return text || null
	}
	return null
}

const DEFAULT_VISION_PROMPT = "Analyze this image and extract all text, UI elements, and key information."

/**
 * Analyze images with the local Ollama vision tool, falling back to
 * central-brain. Returns a single combined analysis string, or null when no
 * vision backend is reachable / nothing could be analyzed.
 */
export async function analyzeImagesWithMcp(
	mcpHub: VisionMcpHub | undefined,
	images: string[],
	prompt?: string,
): Promise<string | null> {
	if (!mcpHub || images.length === 0) {
		return null
	}

	const analysisResults: string[] = []
	for (const imageData of images) {
		const base64Data = normalizeImageDataForVision(imageData)
		const args = { image_base64: base64Data, prompt: prompt || DEFAULT_VISION_PROMPT }

		try {
			const result = await mcpHub.callTool("ollama", "ollama_vision_data", args)
			const analysis = extractMcpVisionText(result)
			if (analysis) {
				analysisResults.push(analysis)
			}
		} catch (toolError) {
			// Ollama server unavailable — try the central-brain analyzer.
			try {
				const result = await mcpHub.callTool("central-brain", "brain_analyze_image", args)
				const analysis = extractMcpVisionText(result)
				if (analysis) {
					analysisResults.push(analysis)
				}
			} catch (brainError) {
				console.error("[analyzeImagesWithMcp] Both MCP vision tools failed:", toolError, brainError)
			}
		}
	}

	if (analysisResults.length === 0) {
		return null
	}
	return analysisResults.join("\n\n")
}
