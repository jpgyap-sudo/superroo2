#!/usr/bin/env node
/**
 * Ollama Lesson Summarizer
 * 
 * Summarizes lessons from memory files using Ollama for embedding generation
 * and natural language summarization.
 * 
 * Usage: node scripts/ollama-summarize-lesson.mjs [file]
 * Default: processes memory/lessons-learned.md
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
 * Parse legacy lessons from markdown file
 */
function parseLessons(content) {
  const lessons = []
  const lessonRegex = /### Legacy Lesson: (.+?)\n\nDate: (.+?)\nSource: (.+?)\nModel\/API used: (.+?)\nConfidence: (.+?)\nRelated files: (.+?)(?=\n\n####)/gs
  
  let match
  while ((match = lessonRegex.exec(content)) !== null) {
    const [_, title, date, source, model, confidence, files] = match
    
    // Extract the full lesson section
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
 * Main function
 */
async function main() {
  const targetFile = process.argv[2] || 'memory/lessons-learned.md'
  const filePath = path.resolve(ROOT, targetFile)
  
  console.log(`📚 Ollama Lesson Summarizer`)
  console.log(`Target: ${targetFile}`)
  console.log(`Ollama URL: ${OLLAMA_URL}`)
  console.log('')

  try {
    // Check if file exists
    await fs.access(filePath)
    
    // Read and parse lessons
    const content = await fs.readFile(filePath, 'utf-8')
    const lessons = parseLessons(content)
    
    console.log(`Found ${lessons.length} legacy lessons`)
    console.log('')

    if (lessons.length === 0) {
      console.log('No lessons to process.')
      return
    }

    // Process each lesson
    const summaries = []
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i]
      console.log(`[${i + 1}/${lessons.length}] Processing: ${lesson.title}`)
      
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
    
    console.log('')
    console.log(`✅ Summaries saved to: memory/lesson-summaries.json`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

main()
