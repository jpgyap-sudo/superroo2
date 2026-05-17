#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")
const OUT_DIR = path.join(ROOT, "memory", "context")
const OUT_FILE = path.join(OUT_DIR, "latest-agent-context.md")

async function readText(relativePath) {
	try {
		return await fs.readFile(path.join(ROOT, relativePath), "utf8")
	} catch {
		return ""
	}
}

function parseJsonl(content) {
	return content
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line))
}

function scoreLesson(lesson, task) {
	const haystack = `${lesson.title} ${lesson.rule_summary} ${lesson.lesson_summary} ${(lesson.tags || []).join(" ")} ${(lesson.files || []).join(" ")}`.toLowerCase()
	return task
		.toLowerCase()
		.split(/\W+/)
		.filter(Boolean)
		.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), lesson.relevance_score || 0)
}

function isDurableLesson(lesson) {
	const combined = `${lesson.rule_summary || ""} ${lesson.lesson_summary || ""}`
	return lesson.policy_status !== "draft" && !/TODO|To be determined|Document the durable insight/i.test(combined)
}

function inferTaskTags(task) {
	const lower = task.toLowerCase()
	const tags = []
	if (/test|spec|coverage/.test(lower)) tags.push("testing")
	if (/api|endpoint|route/.test(lower)) tags.push("api")
	if (/dashboard|ui|view|frontend/.test(lower)) tags.push("ui")
	if (/lesson|learning|memory/.test(lower)) tags.push("learning")
	if (/deploy|release/.test(lower)) tags.push("deployment")
	return tags
}

function extractRelevantWorkingTreeLines(workingTree, taskTags) {
	if (!workingTree || taskTags.length === 0) return workingTree.split("\n").slice(0, 28).join("\n")
	const lines = workingTree.split("\n")
	const matched = lines.filter((line) => taskTags.some((tag) => line.toLowerCase().includes(tag)))
	return matched.slice(0, 18).join("\n") || workingTree.split("\n").slice(0, 28).join("\n")
}

async function main() {
	const task = process.argv.slice(2).join(" ").trim() || "general task"
	const [workingTree, lessonIndexRaw, featureKnowledge, bugLog, modelDecisions, codexTasksRaw] = await Promise.all([
		readText("docs/resources/working-tree.md"),
		readText("memory/lesson-index.jsonl"),
		readText("memory/feature-knowledge.md"),
		readText("memory/bugs-fixed.md"),
		readText("memory/model-decisions.md"),
		readText("server/src/memory/codextask.json"),
	])
	const lessons = lessonIndexRaw ? parseJsonl(lessonIndexRaw) : []
	const taskTags = inferTaskTags(task)
	let relevantLessons = lessons
		.filter(isDurableLesson)
		.map((lesson) => ({ ...lesson, score: scoreLesson(lesson, task) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
	if (relevantLessons.length === 0) {
		relevantLessons = lessons
			.filter(isDurableLesson)
			.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
			.slice(0, 5)
	}
	let activeTasks = []
	try {
		const parsed = JSON.parse(codexTasksRaw || '{"tasks":[]}')
		activeTasks = (parsed.tasks || []).filter((entry) => entry.status === "active").slice(0, 5)
	} catch {
		activeTasks = []
	}
	const sections = [
		"# Latest Agent Context",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Task: ${task}`,
		"",
		"## Relevant Lessons",
		relevantLessons.length
			? relevantLessons
					.map(
						(lesson, index) =>
							`${index + 1}. **${lesson.title}**\n   - Rule: ${lesson.rule_summary}\n   - Why: ${lesson.lesson_summary}`,
					)
					.join("\n")
			: "No matching lessons found.",
		"",
		"## Active Codex Tasks",
		activeTasks.length ? activeTasks.map((entry) => `- ${entry.title} (${entry.id})`).join("\n") : "No active Codex tasks.",
		"",
		"## Architecture Reminder",
		workingTree ? extractRelevantWorkingTreeLines(workingTree, taskTags) : "Working Tree unavailable.",
		"",
		"## Task Signals",
		taskTags.length ? `Inferred tags: ${taskTags.join(", ")}` : "No strong task tags inferred.",
		"",
		"## Feature Knowledge",
		featureKnowledge ? featureKnowledge.split("\n").slice(0, 40).join("\n") : "No feature knowledge recorded.",
		"",
		"## Recent Bug Memory",
		bugLog ? bugLog.split("\n").slice(0, 40).join("\n") : "No bug memory recorded.",
		"",
		"## Model Decisions",
		modelDecisions ? modelDecisions.split("\n").slice(0, 40).join("\n") : "No model decisions recorded.",
		"",
	]
	await fs.mkdir(OUT_DIR, { recursive: true })
	await fs.writeFile(OUT_FILE, sections.join("\n"), "utf8")
	console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
