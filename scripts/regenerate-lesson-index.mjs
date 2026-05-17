#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const LESSONS_FILE = path.join(ROOT, "memory", "lessons-learned.md")
const INDEX_FILE = path.join(ROOT, "memory", "lesson-index.jsonl")

function readSection(body, title) {
	const match = body.match(new RegExp(`#### ${title}\\n([\\s\\S]*?)(?=\\n#### |\\n---\\n|$)`))
	return match ? match[1].trim() : ""
}

function splitCsv(value) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
}

function inferType(title, tags) {
	const haystack = `${title} ${tags.join(" ")}`.toLowerCase()
	if (haystack.includes("decision")) return "decision"
	if (haystack.includes("fix") || tags.includes("bugfix")) return "bugfix"
	return "lesson"
}

function relevanceFor({ reusableRule, lesson, files, tags, confidence }) {
	let score = 0.65
	if (reusableRule && !reusableRule.includes("TODO")) score += 0.12
	if (lesson && !lesson.includes("To be determined")) score += 0.1
	if (files.length > 0) score += 0.04
	if (tags.length >= 2) score += 0.04
	if (confidence === "high") score += 0.05
	return Math.min(0.98, Number(score.toFixed(2)))
}

function qualityFor({ reusableRule, lesson, files, tags, confidence, testResult }) {
	const durableRule = reusableRule && !/TODO|No reusable rule recorded/i.test(reusableRule)
	const durableLesson = lesson && !/TODO|To be determined|No lesson summary recorded/i.test(lesson)
	let score = 0.2
	if (durableRule) score += 0.28
	if (durableLesson) score += 0.2
	if (files.length > 0) score += 0.08
	if (tags.length > 0) score += 0.08
	if (confidence === "high") score += 0.08
	if (/test/i.test(testResult)) score += 0.08
	score = Math.min(1, Number(score.toFixed(2)))
	return {
		quality_score: score,
		policy_status: score >= 0.78 ? "promotable" : score >= 0.62 ? "eligible" : "draft",
	}
}

function parseLessons(markdown) {
	const normalized = markdown.replace(/\r\n/g, "\n")
	const regex =
		/### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): (.+?)\n\nDate: (.+?)\nSource: (.+?)\nModel\/API used: (.+?)\nConfidence: (.+?)\nRelated files: (.+?)(?=\n\n#### )([\s\S]*?)(?=\n### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): |\s*$)/g
	const lessons = []
	let match

	while ((match = regex.exec(normalized)) !== null) {
		const [, title, date, source, model, confidence, filesRaw, body] = match
		const lesson = readSection(body, "Lesson Learned")
		const reusableRule = readSection(body, "Reusable Rule").replace(/^\*\*|\*\*$/g, "")
		const tags = splitCsv(readSection(body, "Tags"))
		const files = splitCsv(filesRaw)
		const testResult = readSection(body, "Test Result")
		const quality = qualityFor({
			reusableRule,
			lesson,
			files,
			tags,
			confidence: confidence.trim(),
			testResult,
		})

		lessons.push({
			id: `lesson-${String(lessons.length + 1).padStart(3, "0")}`,
			title: title.trim(),
			type: inferType(title, tags),
			date: date.trim(),
			source: source.trim(),
			model: model.trim(),
			confidence: confidence.trim(),
			files,
			tags,
			relevance_score: relevanceFor({
				reusableRule,
				lesson,
				files,
				tags,
				confidence: confidence.trim(),
			}),
			relevance_factors: {
				is_bug_fix: tags.includes("bugfix"),
				has_tests: /test/i.test(readSection(body, "Test Result")),
				affects_multiple_files: files.length > 1,
				has_reusable_rule: Boolean(reusableRule && !reusableRule.includes("TODO")),
			},
			rule_summary: reusableRule || "No reusable rule recorded.",
			lesson_summary: lesson || "No lesson summary recorded.",
			...quality,
		})
	}

	return lessons
}

async function main() {
	const markdown = await fs.readFile(LESSONS_FILE, "utf8")
	const lessons = parseLessons(markdown)
	const lines = lessons.map((lesson) => JSON.stringify(lesson)).join("\n")
	await fs.writeFile(INDEX_FILE, lines ? `${lines}\n` : "", "utf8")
	console.log(`Regenerated ${lessons.length} lesson index entries.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
