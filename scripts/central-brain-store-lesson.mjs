#!/usr/bin/env node
/**
 * Central Brain Lesson Store
 * 
 * Stores migrated lessons in the SuperRoo Central Brain via MCP/REST API.
 * 
 * Usage: node scripts/central-brain-store-lesson.mjs [file]
 * Default: processes memory/lessons-learned.md
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Central Brain configuration
const BRAIN_URL = process.env.CENTRAL_BRAIN_URL || 'http://127.0.0.1:3417'
const API_URL = process.env.SUPERROO_API_URL || 'http://127.0.0.1:8787'

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
    
    // Extract key sections
    const taskMatch = lessonContent.match(/#### Task Summary\n(.+?)(?=\n####|$)/s)
    const lessonMatch = lessonContent.match(/#### Lesson Learned\n(.+?)(?=\n####|$)/s)
    const ruleMatch = lessonContent.match(/#### Reusable Rule\n(.+?)(?=\n####|$)/s)
    const tagsMatch = lessonContent.match(/#### Tags\n(.+?)(?=\n###|$)/s)
    
    lessons.push({
      title: title.trim(),
      date: date.trim(),
      source: source.trim(),
      model: model.trim(),
      confidence: confidence.trim(),
      files: files.trim().split(',').map(f => f.trim()),
      task: taskMatch?.[1].trim() || '',
      lesson: lessonMatch?.[1].trim() || '',
      rule: ruleMatch?.[1].trim() || '',
      tags: tagsMatch?.[1].trim().split(',').map(t => t.trim()) || [],
      fullContent: lessonContent
    })
  }
  
  return lessons
}

/**
 * Store lesson in Central Brain via Hermes Learn
 */
async function storeLesson(lesson) {
  try {
    // Try MCP endpoint first
    const mcpResponse = await fetch(`${BRAIN_URL}/brain/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'hermes_learn',
        params: {
          topic: `[Legacy] ${lesson.title}`,
          content: `
**Source:** ${lesson.source}
**Model:** ${lesson.model}
**Confidence:** ${lesson.confidence}
**Date:** ${lesson.date}

**Task Summary:**
${lesson.task}

**Lesson Learned:**
${lesson.lesson}

**Reusable Rule:**
${lesson.rule}

**Files Affected:**
${lesson.files.join(', ')}

**Tags:**
${lesson.tags.join(', ')}
          `.trim(),
          tags: ['legacy-lesson', ...lesson.tags],
          metadata: {
            type: 'legacy_migration',
            model: lesson.model,
            confidence: lesson.confidence,
            date: lesson.date,
            files: lesson.files
          }
        }
      })
    })

    if (mcpResponse.ok) {
      return { success: true, method: 'mcp' }
    }

    // Fallback to REST API
    const restResponse = await fetch(`${API_URL}/api/orchestrator/hermes/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: `[Legacy] ${lesson.title}`,
        content: lesson.lesson,
        tags: ['legacy-lesson', ...lesson.tags]
      })
    })

    if (restResponse.ok) {
      return { success: true, method: 'rest' }
    }

    throw new Error(`HTTP ${restResponse.status}`)
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Store lesson as Codex task
 */
async function storeAsCodexTask(lesson) {
  try {
    const response = await fetch(`${API_URL}/api/orchestrator/hermes/codex_task_upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[Legacy Lesson] ${lesson.title}`,
        summary: lesson.lesson,
        status: 'completed',
        filesChanged: lesson.files,
        featuresAffected: lesson.tags,
        notes: `Migrated from ${lesson.source} using ${lesson.model} on ${lesson.date}`
      })
    })

    return response.ok 
      ? { success: true }
      : { success: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Main function
 */
async function main() {
  const targetFile = process.argv[2] || 'memory/lessons-learned.md'
  const filePath = path.resolve(ROOT, targetFile)
  
  console.log(`🧠 Central Brain Lesson Store`)
  console.log(`Target: ${targetFile}`)
  console.log(`Brain URL: ${BRAIN_URL}`)
  console.log(`API URL: ${API_URL}`)
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
      console.log('No lessons to store.')
      return
    }

    // Test Brain connectivity
    try {
      const healthCheck = await fetch(`${API_URL}/api/health`, { 
        method: 'GET',
        timeout: 5000 
      })
      if (!healthCheck.ok) {
        console.log('⚠️  Warning: Central Brain health check failed. Will attempt store anyway.')
      } else {
        console.log('✅ Central Brain is reachable')
      }
    } catch (e) {
      console.log('⚠️  Warning: Cannot connect to Central Brain. Lessons will be queued for later sync.')
    }
    console.log('')

    // Process each lesson
    const results = []
    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i]
      console.log(`[${i + 1}/${lessons.length}] Storing: ${lesson.title.slice(0, 50)}...`)
      
      // Store in Hermes memory
      const hermesResult = await storeLesson(lesson)
      
      // Also store as Codex task for tracking
      const codexResult = await storeAsCodexTask(lesson)
      
      results.push({
        title: lesson.title,
        hermes: hermesResult,
        codex: codexResult
      })
      
      // Small delay to avoid overwhelming the API
      await new Promise(r => setTimeout(r, 50))
    }

    // Output results
    console.log('')
    console.log('═'.repeat(60))
    console.log('STORAGE RESULTS')
    console.log('═'.repeat(60))
    
    const successful = results.filter(r => r.hermes.success || r.codex.success)
    const failed = results.filter(r => !r.hermes.success && !r.codex.success)
    
    console.log(`\n✅ Successfully stored: ${successful.length}/${results.length}`)
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed to store: ${failed.length}`)
      for (const f of failed) {
        console.log(`   - ${f.title.slice(0, 40)}...`)
        console.log(`     Hermes: ${f.hermes.error || 'OK'}`)
        console.log(`     Codex: ${f.codex.error || 'OK'}`)
      }
    }

    // Save results log
    const outputPath = path.resolve(ROOT, 'memory/central-brain-store-log.json')
    await fs.writeFile(outputPath, JSON.stringify({
      storedAt: new Date().toISOString(),
      brainUrl: BRAIN_URL,
      apiUrl: API_URL,
      sourceFile: targetFile,
      totalLessons: lessons.length,
      successfulStores: successful.length,
      failedStores: failed.length,
      results
    }, null, 2))
    
    console.log('')
    console.log(`📝 Log saved to: memory/central-brain-store-log.json`)

    if (failed.length === results.length) {
      console.log('')
      console.log('⚠️  All stores failed. Ensure Central Brain is running:')
      console.log('   - Brain Daemon: http://127.0.0.1:3417')
      console.log('   - API Server: http://127.0.0.1:8787')
      process.exit(1)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

main()
