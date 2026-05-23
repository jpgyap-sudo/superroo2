"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import type { OutputBlock } from "@/lib/ide-store"

/**
 * WebGL-accelerated terminal renderer.
 *
 * Uses a <canvas> with WebGL2 context to render terminal output at high
 * frame rates. Falls back to CPU-based rendering when WebGL2 is unavailable.
 *
 * Architecture:
 *   - WebGL2 shader renders monospace glyphs from a texture atlas
 *   - Each character cell is a quad with UV coordinates into the atlas
 *   - Scrolling is handled by shifting the vertex buffer (no DOM reflow)
 *   - ANSI colors are passed as per-cell uniforms
 */

// ── Constants ──────────────────────────────────────────────────────────────

const CELL_WIDTH = 9.6 // px (approximate for 14px monospace)
const CELL_HEIGHT = 20 // px
const ATLAS_COLS = 16 // 16x16 grid in texture atlas
const ATLAS_ROWS = 16
const TAB_SIZE = 2

// ── WebGL Shaders ──────────────────────────────────────────────────────────

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
layout(location = 2) in vec4 a_fgColor;
layout(location = 3) in vec4 a_bgColor;

uniform vec2 u_resolution;
uniform vec2 u_scrollOffset;

out vec2 v_texCoord;
out vec4 v_fgColor;
out vec4 v_bgColor;

void main() {
    vec2 pos = a_position + u_scrollOffset;
    vec2 zeroToOne = pos / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_fgColor = a_fgColor;
    v_bgColor = a_bgColor;
}
`

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_texCoord;
in vec4 v_fgColor;
in vec4 v_bgColor;

uniform sampler2D u_texture;

out vec4 outColor;

void main() {
    vec4 texel = texture(u_texture, v_texCoord);
    float alpha = texel.a;
    // Blend foreground color over background color using glyph alpha
    vec4 blended = mix(v_bgColor, v_fgColor, alpha);
    outColor = blended;
}
`

// ── Glyph Atlas Builder ────────────────────────────────────────────────────

function buildGlyphAtlas(
	ctx: CanvasRenderingContext2D,
	font: string,
	fontSize: number,
): { canvas: HTMLCanvasElement; charMap: Map<string, { x: number; y: number }> } {
	const canvas = document.createElement("canvas")
	const atlasSize = 512
	canvas.width = atlasSize
	canvas.height = atlasSize
	ctx.font = font
	ctx.textBaseline = "top"

	const charMap = new Map<string, { x: number; y: number }>()
	const cellW = atlasSize / ATLAS_COLS
	const cellH = atlasSize / ATLAS_ROWS

	// Printable ASCII + common Unicode blocks
	const chars: string[] = []
	for (let i = 32; i < 127; i++) chars.push(String.fromCharCode(i))
	// Add common box-drawing characters
	chars.push("─", "│", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼", "╔", "╗", "╚", "╝", "║", "═")
	// Add common symbols
	chars.push("●", "◆", "■", "▲", "▼", "→", "←", "↑", "↓", "✔", "✘", "⚠", "⚡", "★", "☆", "✓", "✗")
	// Add block elements
	chars.push("▌", "▐", "▀", "▄", "█", "▌", "▐", "░", "▒", "▓")

	ctx.fillStyle = "#000000"
	ctx.fillRect(0, 0, atlasSize, atlasSize)

	let col = 0
	let row = 0
	for (const ch of chars) {
		if (charMap.has(ch)) continue
		const x = col * cellW
		const y = row * cellH
		charMap.set(ch, { x, y })
		ctx.fillStyle = "#ffffff"
		ctx.fillText(ch, x + 1, y + 2) // small padding
		col++
		if (col >= ATLAS_COLS) {
			col = 0
			row++
		}
	}

	return { canvas, charMap }
}

// ── ANSI Color Parsing ─────────────────────────────────────────────────────

interface AnsiColor {
	fg: [number, number, number, number]
	bg: [number, number, number, number]
	bold: boolean
}

const ANSI_COLORS: Record<number, [number, number, number]> = {
	30: [0, 0, 0], // Black
	31: [205, 49, 49], // Red
	32: [13, 188, 121], // Green
	33: [229, 229, 16], // Yellow
	34: [36, 114, 200], // Blue
	35: [188, 63, 188], // Magenta
	36: [17, 168, 205], // Cyan
	37: [229, 229, 229], // White
	90: [102, 102, 102], // Bright Black
	91: [241, 76, 76], // Bright Red
	92: [72, 220, 160], // Bright Green
	93: [255, 255, 102], // Bright Yellow
	94: [86, 156, 214], // Bright Blue
	95: [214, 120, 214], // Bright Magenta
	96: [77, 199, 230], // Bright Cyan
	97: [255, 255, 255], // Bright White
}

function parseAnsiToCells(text: string): Array<{
	char: string
	fg: [number, number, number, number]
	bg: [number, number, number, number]
}> {
	const cells: Array<{
		char: string
		fg: [number, number, number, number]
		bg: [number, number, number, number]
	}> = []

	let currentFg: [number, number, number, number] = [204, 204, 204, 255]
	let currentBg: [number, number, number, number] = [30, 30, 30, 255]
	let bold = false

	const ansiRegex = /\x1b\[([0-9;]*)m/g
	let lastIndex = 0

	const matches = Array.from(text.matchAll(ansiRegex))
	for (const match of matches) {
		// Emit text before this escape
		if (match.index > lastIndex) {
			const segment = text.slice(lastIndex, match.index)
			for (const ch of segment) {
				cells.push({ char: ch === " " ? " " : ch, fg: currentFg, bg: currentBg })
			}
		}
		lastIndex = match.index + match[0].length

		const codes = match[1].split(";").map(Number)
		for (const code of codes) {
			if (code === 0) {
				currentFg = [204, 204, 204, 255]
				currentBg = [30, 30, 30, 255]
				bold = false
			} else if (code === 1) {
				bold = true
			} else if (code >= 30 && code <= 37) {
				const base = ANSI_COLORS[code] || [204, 204, 204]
				currentFg = bold ? [(base[0] + 255) / 2, (base[1] + 255) / 2, (base[2] + 255) / 2, 255] : [...base, 255]
			} else if (code >= 90 && code <= 97) {
				const base = ANSI_COLORS[code] || [204, 204, 204]
				currentFg = [...base, 255]
			} else if (code >= 40 && code <= 47) {
				currentBg = [...(ANSI_COLORS[code - 10] || [30, 30, 30]), 255]
			} else if (code >= 100 && code <= 107) {
				currentBg = [...(ANSI_COLORS[code - 60] || [30, 30, 30]), 255]
			}
		}
	}

	// Emit remaining text
	if (lastIndex < text.length) {
		const segment = text.slice(lastIndex)
		for (const ch of segment) {
			cells.push({ char: ch === " " ? " " : ch, fg: currentFg, bg: currentBg })
		}
	}

	return cells
}

// ── Props ──────────────────────────────────────────────────────────────────

interface WebGLTerminalRendererProps {
	outputBlocks: OutputBlock[]
	visibleRange: { start: number; end: number }
	scrollTop: number
	fontSize?: number
	width: number
	height: number
	onReady?: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WebGLTerminalRenderer({
	outputBlocks,
	visibleRange,
	scrollTop,
	fontSize = 14,
	width,
	height,
	onReady,
}: WebGLTerminalRendererProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const glRef = useRef<WebGL2RenderingContext | null>(null)
	const programRef = useRef<WebGLProgram | null>(null)
	const atlasRef = useRef<HTMLCanvasElement | null>(null)
	const charMapRef = useRef<Map<string, { x: number; y: number }> | null>(null)
	const vaoRef = useRef<WebGLVertexArrayObject | null>(null)
	const vboRef = useRef<WebGLBuffer | null>(null)
	const [webglSupported, setWebglSupported] = useState(true)
	const [fps, setFps] = useState(0)
	const frameCountRef = useRef(0)
	const lastFpsTimeRef = useRef(performance.now())

	// ── Initialize WebGL ──────────────────────────────────────────────────
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
		})

		if (!gl) {
			setWebglSupported(false)
			return
		}

		glRef.current = gl

		// Compile shaders
		function compileShader(src: string, type: number): WebGLShader | null {
			if (!gl) return null
			const shader = gl.createShader(type)
			if (!shader) return null
			gl.shaderSource(shader, src)
			gl.compileShader(shader)
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				console.warn("[WebGL] Shader compile error:", gl.getShaderInfoLog(shader))
				gl.deleteShader(shader)
				return null
			}
			return shader
		}

		const vs = compileShader(VERTEX_SHADER_SRC, gl.VERTEX_SHADER)
		const fs = compileShader(FRAGMENT_SHADER_SRC, gl.FRAGMENT_SHADER)
		if (!vs || !fs) {
			setWebglSupported(false)
			return
		}

		const program = gl.createProgram()
		if (!program) {
			setWebglSupported(false)
			return
		}
		gl.attachShader(program, vs)
		gl.attachShader(program, fs)
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.warn("[WebGL] Program link error:", gl.getProgramInfoLog(program))
			setWebglSupported(false)
			return
		}

		gl.useProgram(program)
		programRef.current = program
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

		// Build glyph atlas
		const tempCtx = document.createElement("canvas").getContext("2d")
		if (tempCtx) {
			const { canvas: atlasCanvas, charMap } = buildGlyphAtlas(
				tempCtx,
				`${fontSize}px "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace`,
				fontSize,
			)
			atlasRef.current = atlasCanvas
			charMapRef.current = charMap

			// Upload atlas texture
			const texture = gl.createTexture()
			gl.bindTexture(gl.TEXTURE_2D, texture)
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		}

		// Create VAO and VBO
		const vao = gl.createVertexArray()
		const vbo = gl.createBuffer()
		vaoRef.current = vao
		vboRef.current = vbo

		gl.bindVertexArray(vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo)

		// Each vertex: position (2 floats), texCoord (2 floats), fgColor (4 floats), bgColor (4 floats) = 12 floats
		const stride = 12 * Float32Array.BYTES_PER_ELEMENT
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0) // position
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT) // texCoord
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT) // fgColor
		gl.enableVertexAttribArray(2)
		gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 8 * Float32Array.BYTES_PER_ELEMENT) // bgColor
		gl.enableVertexAttribArray(3)

		gl.bindVertexArray(null)

		setWebglSupported(true)
		onReady?.()

		return () => {
			gl.deleteProgram(program)
			gl.deleteBuffer(vbo)
			gl.deleteVertexArray(vao)
			glRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fontSize])

	// ── Render loop ───────────────────────────────────────────────────────
	useEffect(() => {
		const gl = glRef.current
		const program = programRef.current
		const vao = vaoRef.current
		const vbo = vboRef.current
		const atlas = atlasRef.current
		const charMap = charMapRef.current
		if (!gl || !program || !vao || !vbo || !atlas || !charMap) return

		const canvas = canvasRef.current
		if (!canvas) return

		// Set canvas size
		const dpr = window.devicePixelRatio || 1
		canvas.width = width * dpr
		canvas.height = height * dpr
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
		gl.viewport(0, 0, canvas.width, canvas.height)

		gl.useProgram(program)

		// Set uniforms
		const resLoc = gl.getUniformLocation(program, "u_resolution")
		gl.uniform2f(resLoc, canvas.width, canvas.height)

		const scrollLoc = gl.getUniformLocation(program, "u_scrollOffset")
		gl.uniform2f(scrollLoc, 0, -scrollTop * dpr)

		// Build vertex data from visible output blocks
		const cellW = CELL_WIDTH * dpr
		const cellH = CELL_HEIGHT * dpr
		const atlasCellW = atlas.width / ATLAS_COLS
		const atlasCellH = atlas.height / ATLAS_ROWS

		const vertices: number[] = []
		let yOffset = 0

		for (let i = visibleRange.start; i < Math.min(visibleRange.end, outputBlocks.length); i++) {
			const block = outputBlocks[i]
			const text = block.content || ""
			const cells = parseAnsiToCells(text)

			let xOffset = 0
			for (const cell of cells) {
				if (cell.char === "\n" || cell.char === "\r") {
					yOffset += cellH
					xOffset = 0
					continue
				}
				if (cell.char === "\t") {
					xOffset += cellW * TAB_SIZE
					continue
				}

				// Look up glyph in atlas
				const atlasPos = charMap.get(cell.char) || charMap.get("�") || { x: 0, y: 0 }
				const tx = atlasPos.x / atlas.width
				const ty = atlasPos.y / atlas.height
				const tw = atlasCellW / atlas.width
				const th = atlasCellH / atlas.height

				const x = xOffset
				const y = yOffset
				const w = cellW
				const h = cellH

				// Normalize colors to 0-1
				const fg = cell.fg.map((c) => c / 255) as [number, number, number, number]
				const bg = cell.bg.map((c) => c / 255) as [number, number, number, number]

				// Two triangles forming a quad (6 vertices)
				// Each vertex: pos(2), tex(2), fg(4), bg(4)
				const pushVertex = (px: number, py: number, tu: number, tv: number) => {
					vertices.push(px, py, tu, tv, ...fg, ...bg)
				}

				pushVertex(x, y, tx, ty)
				pushVertex(x + w, y, tx + tw, ty)
				pushVertex(x, y + h, tx, ty + th)
				pushVertex(x + w, y, tx + tw, ty)
				pushVertex(x + w, y + h, tx + tw, ty + th)
				pushVertex(x, y + h, tx, ty + th)

				xOffset += w
			}
			yOffset += cellH
		}

		// Upload vertex data
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW)

		// Clear and draw
		gl.clearColor(0.118, 0.118, 0.118, 1.0) // #1e1e1e
		gl.clear(gl.COLOR_BUFFER_BIT)

		gl.bindVertexArray(vao)
		gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 12)
		gl.bindVertexArray(null)

		// FPS counter
		frameCountRef.current++
		const now = performance.now()
		if (now - lastFpsTimeRef.current >= 1000) {
			setFps(frameCountRef.current)
			frameCountRef.current = 0
			lastFpsTimeRef.current = now
		}
	}, [outputBlocks, visibleRange, scrollTop, width, height])

	if (!webglSupported) {
		return null // Fall back to CPU rendering (TerminalPanel handles this)
	}

	return (
		<div className="relative" style={{ width, height }}>
			<canvas ref={canvasRef} className="block" style={{ width, height }} />
			{fps > 0 && (
				<div className="absolute top-1 right-1 text-[10px] text-gray-500 bg-[#1e1e1e]/80 px-1 rounded">
					{fps} FPS
				</div>
			)}
		</div>
	)
}
