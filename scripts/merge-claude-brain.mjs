#!/usr/bin/env node
/**
 * Merge Claude Brain Lessons to Main Index
 *
 * Merges lessons from memory/claude-brain/knowledge.jsonl into
 * memory/lesson-index.jsonl in the correct format.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const CLAUDE_BRAIN_FILE = path.join(ROOT, "memory", "claude-brain", "knowledge.jsonl")
const LESSON_INDEX_FILE = path.join(ROOT, "memory", "lesson-index.jsonl")

function getNextLessonNum() {
  if (!fs.existsSync(LESSON_INDEX_FILE)) return 400
  const content = fs.readFileSync(LESSON_INDEX_FILE, "utf8")
  const lines = content.trim().split("\n").filter(Boolean)
  const nums = lines.map(l => {
    try {
      const id = JSON.parse(l).id
      const match = id.match(/lesson-(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    } catch { return 0 }
  }).filter(n => !isNaN(n))
  return nums.length ? Math.max(...nums) + 1 : 400
}

function convertToMainFormat(lesson, lessonNum) {
  return {
    id: `lesson-${lessonNum}`,
    title: lesson.title,
    type: lesson.type,
    date: lesson.date,
    source: lesson.source || "Claude Brain",
    model: "claude-sonnet-4-6",
    confidence: lesson.confidence || "high",
    project: "superroo2",
    files: lesson.relatedFiles || [],
    tags: lesson.tags || [],
    relevance_score: 0.9,
    relevance_factors: {
      is_bug_fix: lesson.type === "bugfix" || lesson.type === "fix",
      has_tests: false,
      affects_multiple_files: false,
      has_reusable_rule: true,
    },
    rule_summary: lesson.content.split("\n")[0].slice(0, 200),
    lesson_summary: lesson.content.slice(0, 300),
    merged_from: "claude-brain/knowledge.jsonl",
    brain_id: lesson.id,
  }
}

async function main() {
  if (!fs.existsSync(CLAUDE_BRAIN_FILE)) {
    console.error("❌ Claude brain file not found:", CLAUDE_BRAIN_FILE)
    process.exit(1)
  }

  const claudeContent = fs.readFileSync(CLAUDE_BRAIN_FILE, "utf8")
  const claudeLessons = claudeContent.split("\n").filter(Boolean).map(l => JSON.parse(l))

  const existingIds = fs.readFileSync(LESSON_INDEX_FILE, "utf8")
    .split("\n").filter(Boolean)
    .map(l => {
      try { return JSON.parse(l).brain_id } catch { return null }
    }).filter(Boolean)

  const newLessons = claudeLessons.filter(l => !existingIds.includes(l.id))
  console.log(`Found ${newLessons.length} new lessons to merge`)

  if (newLessons.length === 0) {
    console.log("✅ All Claude brain lessons already merged")
    return
  }

  let lessonNum = getNextLessonNum()
  const lines = []

  for (const lesson of newLessons) {
    const entry = convertToMainFormat(lesson, lessonNum)
    lines.push(JSON.stringify(entry))
    lessonNum++
  }

  fs.appendFileSync(LESSON_INDEX_FILE, lines.join("\n") + "\n")
  console.log(`✅ Merged ${newLessons.length} lessons to lesson-index.jsonl`)
}

main().catch(e => {
  console.error("❌ Error:", e.message)
  process.exit(1)
})