#!/usr/bin/env node
/**
 * Ollama Lesson Summarizer
 *
 * Summarizes lessons from memory files using Ollama for embedding generation
 * and natural language summarization.
 *
 * Usage: node scripts/ollama-summarize-lesson.mjs [file]
 * Default: processes memory/lessons-learned.md
 *
 * Supports both modern "### Lesson:" and legacy "### Legacy Lesson:" formats.
 * Gracefully handles Ollama being offline — logs warning and exits cleanly.
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Ollama configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const SUMMARIZE_MODEL = process.env.OLLAMA_SUMMARIZE_MODEL || 'qwen2.5:3b'

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
 * Generate summary using Ollama
 */
async function generateSummary(lesson) {
  try {
    const prompt = `Summarize this engineering lesson in 2-3 sentences, focusing on the key takeaway:

Title: ${lesson.title}
Content: ${lesson.content.slice(0, 2000)}...

Provide a concise summary:`

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARIZE_MODEL,
        prompt,
        stream: false
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const data = await response.json()
    return data.response?.trim() || 'No summary generated'
  } catch (error) {
    console.error(`Failed to generate summary for "${lesson.title}":`, error.message)
    return null
  }
}

/**
 * Generate embeddings using Ollama
 */
async function generateEmbeddings(text) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text.slice(0, 8000) // Limit text length
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const data = await response.json()
    return data.embedding
  } catch (error) {
    console.error('Failed to generate embeddings:', error.message)
    return null
  }
}

/**
 * Quick-check if Ollama is reachable (timeout-safe)
 */
async function isOllamaReachable() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Main function
 *
 * CLI flags:
 *   --quiet     Suppress all console output (for hook usage)
 *   --last-only Only process the most recent lesson (for hook usage after commit)
 *   [file]      Path to lessons file (default: memory/lessons-learned.md)
 */
async function main() {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')
  const lastOnly = args.includes('--last-only')
  const targetFile = args.find(a => !a.startsWith('--')) || 'memory/lessons-learned.md'
  const filePath = path.resolve(ROOT, targetFile)

  if (!quiet) {
    console.log(`📚 Ollama Lesson Summarizer`)
    console.log(`Target: ${targetFile}`)
    console.log(`Ollama URL: ${OLLAMA_URL}`)
    console.log('')
  }

  // Check Ollama availability first
  const ollamaOk = await isOllamaReachable()
  if (!ollamaOk) {
    if (!quiet) console.log('⚠️  Ollama not reachable — skipping summarization')
    process.exit(0) // Graceful exit, not an error
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
      
      // Generate summary
      const summary = await generateSummary(lesson)
      
      // Generate embeddings for the lesson content
      const embeddings = await generateEmbeddings(lesson.content)
      
      summaries.push({
        ...lesson,
        summary,
        embeddings: embeddings ? `[${embeddings.length} dimensions]` : null
      })
      
      // Small delay to avoid overwhelming Ollama
      await new Promise(r => setTimeout(r, 100))
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
      ollamaUrl: OLLAMA_URL,
      model: SUMMARIZE_MODEL,
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
