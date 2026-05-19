#!/usr/bin/env node
/**
 * Lesson Summarizer
 *
 * Summarizes lessons from memory files using DeepSeek API for natural language
 * summarization and Ollama for embedding generation.
 *
 * Usage: node scripts/ollama-summarize-lesson.mjs [file]
 * Default: processes memory/lessons-learned.md
 *
 * Supports both modern "### Lesson:" and legacy "### Legacy Lesson:" formats.
 * Gracefully handles DeepSeek API or Ollama being offline — logs warning and exits cleanly.
 *
 * NOTE: Embeddings still use Ollama via curl.exe helper (nomic-embed-text is tiny).
 * Summarization uses DeepSeek API via standard HTTPS fetch().
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

// ── DeepSeek API configuration ──
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ""
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions"
const DEEPSEEK_MODEL = process.env.DEEPSEEK_SUMMARIZE_MODEL || "deepseek-chat"
const DEEPSEEK_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT || "30000", 10)

// ── Ollama configuration (for embeddings only) ──
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
 * Generate summary using DeepSeek API (standard HTTPS fetch — no Tailscale IP involved)
 */
async function generateSummary(lesson) {
  if (!DEEPSEEK_API_KEY) {
    console.warn(`  ⚠️  DEEPSEEK_API_KEY not set — skipping summary for "${lesson.title}"`)
    return null
  }
  try {
    const prompt = `Summarize this engineering lesson in 2-3 sentences, focusing on the key takeaway:

Title: ${lesson.title}
Content: ${lesson.content.slice(0, 3000)}

Provide a concise summary:`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: "You are a precise lesson summarizer. Summarize engineering lessons concisely while preserving all key facts. Output only the summary, no preamble." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) {
      console.warn(`  ⚠️  DeepSeek API error: ${response.status} ${response.statusText}`)
      return null
    }
    const data = await response.json()
    return data?.choices?.[0]?.message?.content?.trim() || 'No summary generated'
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(`  ⚠️  DeepSeek API request timed out for "${lesson.title}"`)
    } else {
      console.warn(`  ⚠️  DeepSeek API request failed for "${lesson.title}": ${error.message?.split("\n")[0] || error}`)
    }
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
 * Summarization uses DeepSeek API (async fetch).
 * Embeddings use Ollama (sync curl helper, for nomic-embed-text only).
 */
async function main() {
  const args = process.argv.slice(2)
  quiet = args.includes('--quiet')  // module-level, read by isOllamaReachable()
  const lastOnly = args.includes('--last-only')
  const targetFile = args.find(a => !a.startsWith('--')) || 'memory/lessons-learned.md'
  const filePath = path.resolve(ROOT, targetFile)

  if (!quiet) {
    console.log(`📚 Lesson Summarizer`)
    console.log(`Target: ${targetFile}`)
    console.log(`DeepSeek API: ${DEEPSEEK_API_KEY ? '✅ configured' : '⚠️  not set'}`)
    console.log(`Ollama URL: ${OLLAMA_URL}`)
    console.log('')
  }

  // Check DeepSeek API key for summarization
  const hasDeepSeek = !!DEEPSEEK_API_KEY
  if (!hasDeepSeek) {
    if (!quiet) console.log('⚠️  DEEPSEEK_API_KEY not set — summaries will be skipped')
  }

  // Check Ollama availability for embeddings (tries local → VPS fallback)
  const activeUrl = isOllamaReachable()
  if (!activeUrl) {
    if (!quiet) console.log('⚠️  Ollama not reachable (local or VPS) — embeddings will be skipped')
  } else {
    if (!quiet && activeUrl !== OLLAMA_URL) {
      console.log(`✅ Using ${activeUrl.includes('100.64') ? 'VPS' : 'local'} Ollama at ${activeUrl}`)
    }
    process.env.OLLAMA_URL = activeUrl
  }

  if (!hasDeepSeek && !activeUrl) {
    if (!quiet) console.log('⚠️  No API key and no Ollama — nothing to do')
    process.exit(0)
  }

  try {
    // Check if file exists
    await fs.access(filePath)
    
    // Read and parse lessons
    const content = await fs.readFile(filePath, 'utf-8')
    let lessons = parseLessons(content)
    
    if (!quiet) console.log(`Found ${lessons.length} lessons`)
    if (!quiet) console.log('')

    if (lessons.length === 0) {
      if (!quiet) console.log('No lessons to process.')
      return
    }

    // If --last-only, only process the most recent lesson
    if (lastOnly) {
      lessons = [lessons[lessons.length - 1]]
    }

    // Process each lesson
    const summaries = []
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i]
      if (!quiet) console.log(`[${i + 1}/${lessons.length}] Processing: ${lesson.title}`)
      
      // Generate summary via DeepSeek API (async)
      const summary = hasDeepSeek ? await generateSummary(lesson) : null
      
      // Generate embeddings via Ollama (sync curl helper)
      const embeddings = activeUrl ? generateEmbeddings(lesson.content, activeUrl) : null
      
      summaries.push({
        ...lesson,
        summary,
        embeddings: embeddings ? `[${embeddings.length} dimensions]` : null
      })
    }

    // Output summary report
    if (!quiet) {
      console.log('')
      console.log('═'.repeat(60))
      console.log('SUMMARY REPORT')
      console.log('═'.repeat(60))
      
      for (const s of summaries) {
        console.log(`\n📖 ${s.title}`)
        console.log(`   Model: ${s.model} | Confidence: ${s.confidence}`)
        if (s.summary) {
          console.log(`   Summary: ${s.summary}`)
        }
        if (s.embeddings) {
          console.log(`   Embeddings: ${s.embeddings}`)
        }
      }
    }

    // Save summaries to JSON
    const outputPath = path.resolve(ROOT, 'memory/lesson-summaries.json')
    await fs.writeFile(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      deepseekModel: DEEPSEEK_MODEL,
      ollamaUrl: activeUrl || OLLAMA_URL,
      sourceFile: targetFile,
      count: summaries.length,
      summaries: summaries.map(s => ({
        title: s.title,
        date: s.date,
        model: s.model,
        confidence: s.confidence,
        summary: s.summary,
        hasEmbeddings: !!s.embeddings
      }))
    }, null, 2))
    
    if (!quiet) console.log(`✅ Summaries saved to: memory/lesson-summaries.json`)

  } catch (error) {
    if (!quiet) console.error('❌ Error:', error.message)
    process.exit(0) // Non-zero exit would alarm hooks — exit cleanly
  }
}

main()
