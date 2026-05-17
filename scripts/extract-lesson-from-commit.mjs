#!/usr/bin/env node
/**
 * Extract Lesson from Commit
 * 
 * Analyzes a git commit and extracts potential lessons for the
 * SuperRoo intelligence layer.
 * 
 * Usage: node scripts/extract-lesson-from-commit.mjs <sha> <message> <author> <files>
 * Or:    node scripts/extract-lesson-from-commit.mjs --interactive
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Configuration
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

/**
 * Analyze a commit for lesson-worthiness
 */
function analyzeCommit(sha, message, author, files) {
  const indicators = []
  
  for (const pattern of LESSON_INDICATORS) {
    if (pattern.test(message)) {
      indicators.push(pattern.source)
    }
  }

  // Check file patterns
  const fileList = files.split(',').filter(f => f.trim())
  const hasTestFiles = fileList.some(f => f.includes('.test.') || f.includes('.spec.'))
  const hasConfigFiles = fileList.some(f => f.includes('config') || f.includes('.json'))
  const hasCoreFiles = fileList.some(f => 
    f.includes('src/core/') || 
    f.includes('src/super-roo/')
  )

  return {
    sha,
    message,
    author,
    files: fileList,
    indicators,
    hasTestFiles,
    hasConfigFiles,
    hasCoreFiles,
    lessonWorthy: indicators.length > 0 || hasCoreFiles
  }
}

/**
 * Generate a lesson template from commit analysis
 */
function generateLessonTemplate(analysis) {
  const date = new Date().toISOString().split('T')[0]
  
  // Extract potential title from commit message
  let title = analysis.message
    .split('\n')[0] // First line only
    .replace(/^(fix|bug|lesson|workaround|solution|issue|error|crash|refactor|performance)[\s:]*-?\s*/i, '')
    .trim()
  
  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1)

  // Limit title length
  if (title.length > 80) {
    title = title.slice(0, 77) + '...'
  }

  // Determine tags based on files and message
  const tags = []
  
  if (analysis.files.some(f => f.includes('test'))) tags.push('testing')
  if (analysis.files.some(f => f.includes('ml/'))) tags.push('ml-engine')
  if (analysis.files.some(f => f.includes('ui/') || f.includes('webview'))) tags.push('ui')
  if (analysis.files.some(f => f.includes('api/'))) tags.push('api')
  if (analysis.files.some(f => f.includes('deploy'))) tags.push('deployment')
  if (analysis.message.toLowerCase().includes('fix')) tags.push('bugfix')
  if (analysis.message.toLowerCase().includes('refactor')) tags.push('refactor')
  if (analysis.message.toLowerCase().includes('performance')) tags.push('performance')
  
  if (tags.length === 0) {
    tags.push('general')
  }

  return `
### Auto-Extracted Lesson: ${title}

Date: ${date}
Source: Git commit ${analysis.sha.slice(0, 8)}
Model/API used: unknown
Confidence: medium
Related files: ${analysis.files.slice(0, 5).join(', ')}

#### Task Summary
${analysis.message.split('\n')[0]}

#### Files Changed
${analysis.files.map(f => `- \`${f}\``).join('\n')}

#### Bug Cause
<!-- TODO: Document what caused the issue -->
Unknown — extracted from commit ${analysis.sha.slice(0, 8)}.

#### Fix Applied
<!-- TODO: Document the solution -->
See commit ${analysis.sha.slice(0, 8)} by ${analysis.author}.

#### Test Result
${analysis.hasTestFiles ? 'Tests were included in this commit.' : 'Unknown — no test files detected.'}

#### Lesson Learned
<!-- TODO: Extract reusable lesson -->
To be determined — this commit was auto-flagged as potentially containing a lesson.

#### Reusable Rule
<!-- TODO: Define a specific rule for future agents -->
**TODO: Add a specific, actionable rule based on this commit.**

#### Tags
${tags.join(', ')}

---
`
}

/**
 * Append lesson to lessons-learned.md
 */
async function appendLesson(lessonContent) {
  try {
    await fs.access(LESSON_FILE)
  } catch {
    console.log('Creating lessons-learned.md...')
    await fs.writeFile(LESSON_FILE, '# lessons-learned.md\n\n')
  }

  const content = await fs.readFile(LESSON_FILE, 'utf-8')
  
  // Check if this commit SHA is already recorded
  const shaMatch = lessonContent.match(/commit ([a-f0-9]{8})/)
  if (shaMatch && content.includes(shaMatch[1])) {
    console.log(`Lesson for commit ${shaMatch[1]} already exists. Skipping.`)
    return false
  }

  await fs.appendFile(LESSON_FILE, lessonContent)
  return true
}

/**
 * Interactive mode - prompts user for details
 */
async function interactiveMode() {
  console.log('📝 Interactive Lesson Extractor\n')
  
  // Get last commit info
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const message = execSync('git log -1 --pretty=%B', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const author = execSync('git log -1 --pretty=%an', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const files = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()

    const analysis = analyzeCommit(sha, message, author, files)
    
    console.log('Commit Analysis:')
    console.log(`  SHA: ${sha.slice(0, 8)}`)
    console.log(`  Message: ${message.split('\n')[0]}`)
    console.log(`  Author: ${author}`)
    console.log(`  Files: ${analysis.files.length} changed`)
    console.log(`  Indicators: ${analysis.indicators.length > 0 ? analysis.indicators.join(', ') : 'None'}`)
    console.log(`  Lesson-worthy: ${analysis.lessonWorthy ? 'YES' : 'NO'}`)
    console.log('')

    if (!analysis.lessonWorthy) {
      console.log('This commit does not appear to contain a lesson-worthy change.')
      console.log('Run with --force to extract anyway.')
      return
    }

    const template = generateLessonTemplate(analysis)
    
    console.log('Generated template:')
    console.log('─'.repeat(60))
    console.log(template)
    console.log('─'.repeat(60))
    console.log('')
    console.log('Review and edit the template in memory/lessons-learned.md')
    
    // Append with TODO markers for manual editing
    await appendLesson(template)
    console.log('✅ Template appended to memory/lessons-learned.md')
    
  } catch (error) {
    console.error('Error:', error.message)
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)

  // Interactive mode
  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveMode()
    return
  }

  // Direct mode (from git hook)
  if (args.length >= 3) {
    const [sha, message, author, files] = args
    const analysis = analyzeCommit(sha, message, author, files || '')

    if (analysis.lessonWorthy) {
      const template = generateLessonTemplate(analysis)
      const appended = await appendLesson(template)
      
      if (appended) {
        console.log(`✅ Auto-extracted lesson from commit ${sha.slice(0, 8)}`)
        console.log('   Please review and complete the TODO sections.')
      }
    }
    
    return
  }

  // Show usage
  console.log('Usage:')
  console.log('  node extract-lesson-from-commit.mjs --interactive')
  console.log('  node extract-lesson-from-commit.mjs <sha> <message> <author> [files]')
  console.log('')
  console.log('This script analyzes git commits and extracts lessons for the')
  console.log('SuperRoo intelligence layer.')
}

main().catch(console.error)
