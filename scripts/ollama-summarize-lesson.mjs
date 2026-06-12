#!/usr/bin/env node
/**
 * Lesson Summarizer
 *
 * Summarizes lessons from memory files using Hermes 3 (local Ollama) for natural
 * language summarization and nomic-embed-text for embedding generation.
 *
 * Usage: node scripts/ollama-summarize-lesson.mjs [file]
 * Default: processes memory/lessons-learned.md
 *
 * Supports both modern "### Lesson:" and legacy "### Legacy Lesson:" formats.
 * Gracefully handles Ollama being offline — logs warning and exits cleanly.
 *
 * NOTE: Both summarization and embeddings use local Ollama (no cloud API required).
 *   Summarization: hermes3 via curl.exe helper
 *   Embeddings:    nomic-embed-text via curl.exe helper
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Lightweight .env loader (no dotenv dependency) ──
function loadEnvFile(filePath) {
	try {
		const content = fsSync.readFileSync(filePath, "utf8")
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#")) continue
			const eqIdx = trimmed.indexOf("=")
			if (eqIdx === -1) continue
			const key = trimmed.slice(0, eqIdx).trim()
			let value = trimmed.slice(eqIdx + 1).trim()
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1)
			}
			if (!process.env[key]) {
				process.env[key] = value
			}
		}
	} catch { /* skip silently */ }
}
loadEnvFile(path.join(ROOT, ".env"))
loadEnvFile(path.join(ROOT, "cloud", ".env"))

// ── Ollama configuration (summarization + embeddings) ──
const HERMES_MODEL = process.env.HERMES_MODEL || "hermes3"
const LOCAL_OLLAMA_URL = 'http://127.0.0.1:11434'
const VPS_OLLAMA_URL = 'http://100.64.175.88:11434'
const OLLAMA_URL = process.env.OLLAMA_URL || LOCAL_OLLAMA_URL
const HELPER_SCRIPT = path.join(__dirname, 'ml', 'ollama-curl-helper.cmd')
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sr-ollama-sum-'))

// Module-level quiet flag — set by main(), read by isOllamaReachable()
let quiet = false

/**
 * Call Ollama API via curl.exe helper (avoids Node.js fetch() hanging on Tailscale IPs on Windows).
 * @param {string} url - Full Ollama API URL
 * @param {object|null} body - JSON body for POST, or null for GET
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {object|null} Parsed JSON response, or null on failure
 */
function curlOllama(url, body, timeoutMs) {
	const outFile = path.join(TMP_DIR, `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
	try {
		if (body) {
			const bodyFile = path.join(TMP_DIR, `body_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
			fsSync.writeFileSync(bodyFile, JSON.stringify(body), 'utf8')
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}" "${bodyFile}"`, {
				timeout: (timeoutMs || 120000) + 5000,
				stdio: ['pipe', 'pipe', 'ignore'],
				windowsHide: true,
			})
			try { fsSync.unlinkSync(bodyFile) } catch {}
		} else {
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}"`, {
				timeout: (timeoutMs || 5000) + 5000,
				stdio: ['pipe', 'pipe', 'ignore'],
				windowsHide: true,
			})
		}
		const raw = fsSync.readFileSync(outFile, 'utf8')
		return JSON.parse(raw)
	} catch {
		return null
	} finally {
		try { fsSync.unlinkSync(outFile) } catch {}
	}
}

/**
 * Parse lessons from markdown file — supports both modern and legacy formats
 */
function parseLessons(content) {
  const lessons = []
  
  // Modern format: ### Lesson: Title
  const modernRegex = /### (?:Legacy )?Lesson: (.+?)(?:\n\n|\n(?=Date:))/gs
  // Legacy format: ### Legacy Lesson: Title with Date/Source/Model/Confidence/Related files header
  const legacyRegex = /### Legacy Lesson: (.+?)\n\nDate: (.+?)\nSource: (.+?)\nModel\/API used: (.+?)\nConfidence: (.+?)\nRelated files: (.+?)(?=\n\n####)/gs
  
  let match
  
  // Try modern format first
  while ((match = modernRegex.exec(content)) !== null) {
    const title = match[1].trim()
    const startIdx = match.index
    
    // Find the next lesson boundary
    const nextLessonIdx = content.indexOf('\n### ', startIdx + 1)
    const lessonContent = nextLessonIdx > 0
      ? content.slice(startIdx, nextLessonIdx)
      : content.slice(startIdx)
    
    // Extract metadata from the lesson content
    const dateMatch = lessonContent.match(/Date: (.+?)(?:\n|$)/)
    const sourceMatch = lessonContent.match(/Source: (.+?)(?:\n|$)/)
    const modelMatch = lessonContent.match(/Model\/API used: (.+?)(?:\n|$)/)
    const confidenceMatch = lessonContent.match(/Confidence: (.+?)(?:\n|$)/)
    const filesMatch = lessonContent.match(/Related files: (.+?)(?:\n|$)/)
    
    lessons.push({
      title,
      date: dateMatch ? dateMatch[1].trim() : 'unknown',
      source: sourceMatch ? sourceMatch[1].trim() : 'unknown',
      model: modelMatch ? modelMatch[1].trim() : 'unknown',
      confidence: confidenceMatch ? confidenceMatch[1].trim() : 'unknown',
      files: filesMatch ? filesMatch[1].trim().split(',').map(f => f.trim()) : [],
      content: lessonContent.trim()
    })
  }
  
  // If no modern lessons found, try legacy format
  if (lessons.length === 0) {
    while ((match = legacyRegex.exec(content)) !== null) {
      const [_, title, date, source, model, confidence, files] = match
      
      const startIdx = match.index
      const nextLessonIdx = content.indexOf('### Legacy Lesson:', startIdx + 1)
      const lessonContent = nextLessonIdx > 0
        ? content.slice(startIdx, nextLessonIdx)
        : content.slice(startIdx)
      
      lessons.push({
        title: title.trim(),
        date: date.trim(),
        source: source.trim(),
        model: model.trim(),
        confidence: confidence.trim(),
        files: files.trim().split(',').map(f => f.trim()),
        content: lessonContent
      })
    }
  }
  
  return lessons
}

/**
 * Get the active Ollama URL (from process.env if set by isOllamaReachable, otherwise default)
 */
function getOllamaUrl() {
  return process.env.OLLAMA_URL || OLLAMA_URL
}

/**
 * Generate summary using Hermes 3 (local Ollama, via curl helper)
 */
function generateSummary(lesson, ollamaUrl) {
  try {
    const url = ollamaUrl || getOllamaUrl()
    const data = curlOllama(`${url}/api/chat`, {
      model: HERMES_MODEL,
      stream: false,
      options: { temperature: 0.3 },
      messages: [
        {
          role: 'system',
          content: 'You are a precise lesson summarizer. Summarize engineering lessons concisely while preserving all key facts. Output only the summary, no preamble.',
        },
        {
          role: 'user',
          content: `Summarize this engineering lesson in 2-3 sentences, focusing on the key takeaway:\n\nTitle: ${lesson.title}\nContent: ${lesson.content.slice(0, 3000)}\n\nProvide a concise summary:`,
        },
      ],
    }, 60000)
    return data?.message?.content?.trim() || null
  } catch (error) {
    console.warn(`  ⚠️  Hermes 3 summary failed for "${lesson.title}": ${error.message}`)
    return null
  }
}

/**
 * Generate embeddings using Ollama (uses curl helper to avoid Node.js fetch() hanging on Tailscale IPs)
 */
function generateEmbeddings(text, ollamaUrl) {
  try {
    const url = ollamaUrl || getOllamaUrl()
    const data = curlOllama(`${url}/api/embed`, {
      model: 'nomic-embed-text',
      input: text.slice(0, 8000)
    }, 30000)

    return data?.embeddings?.[0] || null
  } catch (error) {
    console.error('Failed to generate embeddings:', error.message)
    return null
  }
}

/**
 * Quick-check if Ollama is reachable (timeout-safe)
 * Tries localhost first, then falls back to VPS Ollama via Tailscale.
 * Sets global OLLAMA_URL to the first reachable instance.
 * Uses curl helper to avoid Node.js fetch() hanging on Tailscale IPs on Windows.
 */
function isOllamaReachable() {
  const urlsToTry = [
    { url: LOCAL_OLLAMA_URL, name: 'local' },
    { url: VPS_OLLAMA_URL, name: 'VPS (100.64.175.88)' },
  ]

  // If OLLAMA_URL is explicitly set via env var, try it first
  if (process.env.OLLAMA_URL) {
    urlsToTry.unshift({ url: process.env.OLLAMA_URL, name: 'env' })
  }

  for (const { url, name } of urlsToTry) {
    try {
      const data = curlOllama(`${url}/api/tags`, null, 3000)
      if (data && data.models) {
        if (url !== (process.env.OLLAMA_URL || OLLAMA_URL)) {
          if (!quiet) console.log(`🔄 Using ${name} Ollama at ${url}`)
          process.env.OLLAMA_URL = url
        }
        return url
      }
    } catch {
      if (!quiet) console.log(`  ${name} Ollama not reachable at ${url}`)
    }
  }
  return null
}

/**
 * Main function
 *
 * CLI flags:
 *   --quiet     Suppress all console output (for hook usage)
 *   --last-only Only process the most recent lesson (for hook usage after commit)
 *   [file]      Path to lessons file (default: memory/lessons-learned.md)
 *
 * Summarization: Hermes 3 via local Ollama (curl helper).
 * Embeddings:    nomic-embed-text via local Ollama (curl helper).
 */
async function main() {
  const args = process.argv.slice(2)
  quiet = args.includes('--quiet')  // module-level, read by isOllamaReachable()
  const lastOnly = args.includes('--last-only')
  const targetFile = args.find(a => !a.startsWith('--')) || 'memory/lessons-learned.md'
  const filePath = path.resolve(ROOT, targetFile)

  if (!quiet) {
    console.log(`📚 Lesson Summarizer (Hermes 3 + nomic-embed-text)`)
    console.log(`Target: ${targetFile}`)
    console.log(`Hermes model: ${HERMES_MODEL}`)
    console.log(`Ollama URL: ${OLLAMA_URL}`)
    console.log('')
  }

  // Check Ollama availability (tries local → VPS fallback)
  const activeUrl = isOllamaReachable()
  if (!activeUrl) {
    if (!quiet) console.log('⚠️  Ollama not reachable (local or VPS) — nothing to do')
    process.exit(0)
  }

  if (!quiet && activeUrl !== OLLAMA_URL) {
    console.log(`✅ Using ${activeUrl.includes('100.64') ? 'VPS' : 'local'} Ollama at ${activeUrl}`)
  }
  process.env.OLLAMA_URL = activeUrl

  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, 'utf-8')
    let lessons = parseLessons(content)

    if (!quiet) console.log(`Found ${lessons.length} lessons\n`)

    if (lessons.length === 0) {
      if (!quiet) console.log('No lessons to process.')
      return
    }

    if (lastOnly) {
      lessons = [lessons[lessons.length - 1]]
    }

    const summaries = []
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i]
      if (!quiet) console.log(`[${i + 1}/${lessons.length}] ${lesson.title}`)

      // Summarize via Hermes 3 (sync curl helper)
      const summary = generateSummary(lesson, activeUrl)

      // Embed via nomic-embed-text (sync curl helper)
      const embeddings = generateEmbeddings(lesson.content, activeUrl)

      summaries.push({
        ...lesson,
        summary,
        embeddings: embeddings ? `[${embeddings.length} dimensions]` : null,
      })
    }

    if (!quiet) {
      console.log('')
      console.log('═'.repeat(60))
      console.log('SUMMARY REPORT')
      console.log('═'.repeat(60))
      for (const s of summaries) {
        console.log(`\n📖 ${s.title}`)
        console.log(`   Model: ${s.model} | Confidence: ${s.confidence}`)
        if (s.summary) console.log(`   Summary: ${s.summary}`)
        if (s.embeddings) console.log(`   Embeddings: ${s.embeddings}`)
      }
    }

    const outputPath = path.resolve(ROOT, 'memory/lesson-summaries.json')
    await fs.writeFile(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      hermesModel: HERMES_MODEL,
      ollamaUrl: activeUrl,
      sourceFile: targetFile,
      count: summaries.length,
      summaries: summaries.map(s => ({
        title: s.title,
        date: s.date,
        model: s.model,
        confidence: s.confidence,
        summary: s.summary,
        hasEmbeddings: !!s.embeddings,
      })),
    }, null, 2))

    if (!quiet) console.log(`\n✅ Summaries saved to: memory/lesson-summaries.json`)

  } catch (error) {
    if (!quiet) console.error('❌ Error:', error.message)
    process.exit(0)
  }
}

main()
