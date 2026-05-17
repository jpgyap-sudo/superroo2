#!/usr/bin/env node
/**
 * Backfill Lessons from Git History
 *
 * Batch-processes git commits and extracts lessons for the
 * SuperRoo intelligence layer. Deduplicates against existing
 * lessons in memory/lessons-learned.md and memory/lesson-index.jsonl.
 *
 * Usage: node scripts/backfill-lessons.mjs [--since YYYY-MM-DD] [--dry-run]
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const LESSON_FILE = path.join(ROOT, 'memory/lessons-learned.md')
const INDEX_FILE = path.join(ROOT, 'memory/lesson-index.jsonl')

// Lesson indicators in commit messages
const LESSON_INDICATORS = [
  /fix(e[ds])?:?\s+/i,
  /bug:?:?\s+/i,
  /lesson:?:?\s+/i,
  /workaround:?:?\s+/i,
  /solution:?:?\s+/i,
  /issue:?:?\s+/i,
  /error:?:?\s+/i,
  /crash:?:?\s+/i,
  /race[\s-]?condition:?:?\s+/i,
  /memory[\s-]?leak:?:?\s+/i,
  /performance:?:?\s+/i,
  /optimize:?:?\s+/i,
  /refactor:?:?\s+/i,
  /breaking[\s-]?change:?:?\s+/i,
]

function analyzeCommit(sha, message, author, files) {
  const indicators = []
  for (const pattern of LESSON_INDICATORS) {
    if (pattern.test(message)) {
      indicators.push(pattern.source)
    }
  }

  const fileList = files.split(',').filter(f => f.trim())
  const hasTestFiles = fileList.some(f => f.includes('.test.') || f.includes('.spec.'))
  const hasConfigFiles = fileList.some(f => f.includes('config') || f.includes('.json'))
  const hasCoreFiles = fileList.some(f =>
    f.includes('src/core/') ||
    f.includes('src/super-roo/')
  )

  return {
    sha,
    message: message.split('\n')[0],
    fullMessage: message,
    author,
    files: fileList,
    indicators,
    hasTestFiles,
    hasConfigFiles,
    hasCoreFiles,
    lessonWorthy: indicators.length > 0 || hasCoreFiles
  }
}

function generateLessonMarkdown(analysis, date) {
  let title = analysis.message
    .replace(/^(fix|bug|lesson|workaround|solution|issue|error|crash|refactor|performance)[\s:]*-?\s*/i, '')
    .trim()
  title = title.charAt(0).toUpperCase() + title.slice(1)
  if (title.length > 80) title = title.slice(0, 77) + '...'

  const tags = []
  if (analysis.files.some(f => f.includes('test'))) tags.push('testing')
  if (analysis.files.some(f => f.includes('ml/'))) tags.push('ml-engine')
  if (analysis.files.some(f => f.includes('ui/') || f.includes('webview'))) tags.push('ui')
  if (analysis.files.some(f => f.includes('api/'))) tags.push('api')
  if (analysis.files.some(f => f.includes('deploy'))) tags.push('deployment')
  if (analysis.files.some(f => f.includes('telegram'))) tags.push('telegram')
  if (analysis.files.some(f => f.includes('docker'))) tags.push('docker')
  if (analysis.files.some(f => f.includes('terminal'))) tags.push('terminal')
  if (analysis.message.toLowerCase().includes('fix')) tags.push('bugfix')
  if (analysis.message.toLowerCase().includes('refactor')) tags.push('refactor')
  if (analysis.message.toLowerCase().includes('performance')) tags.push('performance')
  if (tags.length === 0) tags.push('general')

  return `
### Auto-Extracted Lesson: ${title}

Date: ${date}
Source: Git commit ${analysis.sha.slice(0, 8)}
Model/API used: ${analysis.author || 'unknown'}
Confidence: medium
Related files: ${analysis.files.slice(0, 5).join(', ')}

#### Task Summary
${analysis.message}

#### Files Changed
${analysis.files.map(f => `- \`${f}\``).join('\n')}

#### Bug Cause
Unknown — extracted from commit ${analysis.sha.slice(0, 8)}.

#### Fix Applied
See commit ${analysis.sha.slice(0, 8)} by ${analysis.author}.

#### Test Result
${analysis.hasTestFiles ? 'Tests were included in this commit.' : 'Unknown — no test files detected.'}

#### Lesson Learned
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
${tags.join(', ')}

---
`
}

function generateLessonIndexEntry(analysis, date, nextId) {
  const tags = []
  if (analysis.files.some(f => f.includes('test'))) tags.push('testing')
  if (analysis.files.some(f => f.includes('ml/'))) tags.push('ml-engine')
  if (analysis.files.some(f => f.includes('ui/') || f.includes('webview'))) tags.push('ui')
  if (analysis.files.some(f => f.includes('api/'))) tags.push('api')
  if (analysis.files.some(f => f.includes('deploy'))) tags.push('deployment')
  if (analysis.files.some(f => f.includes('telegram'))) tags.push('telegram')
  if (analysis.files.some(f => f.includes('docker'))) tags.push('docker')
  if (analysis.files.some(f => f.includes('terminal'))) tags.push('terminal')
  if (analysis.message.toLowerCase().includes('fix')) tags.push('bugfix')
  if (analysis.message.toLowerCase().includes('refactor')) tags.push('refactor')
  if (analysis.message.toLowerCase().includes('performance')) tags.push('performance')

  let title = analysis.message
    .replace(/^(fix|bug|lesson|workaround|solution|issue|error|crash|refactor|performance)[\s:]*-?\s*/i, '')
    .trim()
  title = title.charAt(0).toUpperCase() + title.slice(1)
  if (title.length > 80) title = title.slice(0, 77) + '...'

  return {
    id: `lesson-${String(nextId).padStart(3, '0')}`,
    title,
    type: analysis.message.toLowerCase().includes('fix') ? 'bugfix' : 'lesson',
    date,
    source: `Git commit ${analysis.sha.slice(0, 8)}`,
    model: analysis.author || 'unknown',
    confidence: 'medium',
    files: analysis.files.slice(0, 5),
    tags,
    relevance_score: 0.75,
    relevance_factors: {
      is_bug_fix: analysis.message.toLowerCase().includes('fix'),
      has_tests: analysis.hasTestFiles,
      affects_multiple_files: analysis.files.length > 1,
    },
    rule_summary: 'TODO: Add a specific, actionable rule based on this commit.',
    lesson_summary: 'To be determined — this commit was auto-flagged as potentially containing a lesson.'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const sinceIdx = args.indexOf('--since')
  const sinceDate = sinceIdx >= 0 ? args[sinceIdx + 1] : '2026-05-01'
  const dryRun = args.includes('--dry-run')

  console.log(`🔄 Backfilling lessons from git history since ${sinceDate}...\n`)

  // Load existing lessons to deduplicate
  let existingContent = ''
  try {
    existingContent = await fs.readFile(LESSON_FILE, 'utf-8')
  } catch {
    existingContent = '# lessons-learned.md\n\n'
  }

  let existingIndex = []
  try {
    const indexContent = await fs.readFile(INDEX_FILE, 'utf-8')
    existingIndex = indexContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
  } catch {
    existingIndex = []
  }

  const existingShas = new Set()
  const shaMatches = existingContent.matchAll(/commit ([a-f0-9]{8})/g)
  for (const m of shaMatches) existingShas.add(m[1])

  const nextId = existingIndex.length + 1

  // Get commits from git log
  const logFormat = '%H|%s|%an|%ae|%ad'
  const gitLog = execSync(
    `git log --all --since="${sinceDate}" --pretty=format:"${logFormat}" --date=short`,
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  )

  const commits = gitLog.split('\n').filter(l => l.trim()).map(line => {
    const [sha, message, author] = line.split('|')
    return { sha, message, author }
  })

  console.log(`Found ${commits.length} commits to analyze.\n`)

  let extracted = 0
  let skipped = 0
  const newLessonsMd = []
  const newLessonsIndex = []

  for (let i = 0; i < commits.length; i++) {
    const { sha, message, author } = commits[i]
    if (existingShas.has(sha.slice(0, 8))) {
      skipped++
      continue
    }

    let files = ''
    try {
      files = execSync(`git diff-tree --no-commit-id --name-only -r ${sha}`, {
        cwd: ROOT,
        encoding: 'utf-8'
      }).trim().replace(/\n/g, ',')
    } catch {
      files = ''
    }

    const analysis = analyzeCommit(sha, message, author, files)
    if (!analysis.lessonWorthy) {
      skipped++
      continue
    }

    const date = execSync(`git log -1 --format=%ai ${sha}`, { cwd: ROOT, encoding: 'utf-8' }).trim().split('T')[0]
    const md = generateLessonMarkdown(analysis, date)
    const idx = generateLessonIndexEntry(analysis, date, nextId + newLessonsIndex.length)

    newLessonsMd.push(md)
    newLessonsIndex.push(idx)
    extracted++

    console.log(`[${i + 1}/${commits.length}] ✅ ${sha.slice(0, 8)} — ${analysis.message.slice(0, 60)}`)
  }

  console.log(`\n📊 Results:`)
  console.log(`   Extracted: ${extracted}`)
  console.log(`   Skipped:   ${skipped}`)

  if (dryRun) {
    console.log('\n🛑 Dry run — no files modified.')
    return
  }

  if (newLessonsMd.length > 0) {
    await fs.appendFile(LESSON_FILE, newLessonsMd.join(''))
    const indexLines = newLessonsIndex.map(e => JSON.stringify(e)).join('\n') + '\n'
    await fs.appendFile(INDEX_FILE, indexLines)
    console.log(`\n✅ Appended ${newLessonsMd.length} lessons to memory/lessons-learned.md`)
    console.log(`✅ Appended ${newLessonsIndex.length} entries to memory/lesson-index.jsonl`)
  } else {
    console.log('\n✅ No new lessons to add.')
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
