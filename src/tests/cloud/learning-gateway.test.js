import fs from "fs/promises"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { describe, expect, it, beforeEach } from "vitest"

const require = createRequire(import.meta.url)
const { LearningGateway } = require("../../../cloud/orchestrator/modules/LearningGateway")
const { LearningPolicy } = require("../../../cloud/orchestrator/modules/LearningPolicy")

describe("LearningPolicy", () => {
	it("keeps placeholder lessons out of prompt injection", () => {
		const policy = new LearningPolicy()
		expect(
			policy.evaluateLesson({
				rule_summary: "TODO: add a rule",
				lesson_summary: "To be determined",
				files: [],
				tags: [],
			}).status,
		).toBe("draft")
	})
})

describe("LearningGateway", () => {
	let root
	let indexPath
	let eventsPath

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "learning-gateway-"))
		indexPath = path.join(root, "lesson-index.jsonl")
		eventsPath = path.join(root, "learning-events.jsonl")
		await fs.writeFile(
			indexPath,
			[
				{
					id: "lesson-good",
					title: "Use safe parsers",
					rule_summary: "Use safeJsonParse for persisted rows.",
					lesson_summary: "Corrupt rows can crash registries.",
					files: ["src/registry.ts"],
					tags: ["api"],
					confidence: "high",
					relevance_score: 0.8,
					relevance_factors: { has_tests: true },
				},
				{
					id: "lesson-draft",
					title: "Placeholder",
					rule_summary: "TODO: add rule",
					lesson_summary: "To be determined",
					files: [],
					tags: [],
				},
			]
				.map((lesson) => JSON.stringify(lesson))
				.join("\n") + "\n",
		)
	})

	it("returns only eligible lessons and records task provenance", async () => {
		const gateway = new LearningGateway({ projectRoot: root, lessonIndexPath: indexPath, eventsPath })
		const result = await gateway.search({ query: "safe parser", taskId: "task-1" })
		expect(result.lessons.map((lesson) => lesson.id)).toEqual(["lesson-good"])
		const events = await gateway.getRecentEvents()
		expect(events[0].payload.task_id).toBe("task-1")
		expect(events[0].payload.lesson_ids).toEqual(["lesson-good"])
	})

	it("uses outcomes to build operational stats and promotion candidates", async () => {
		const gateway = new LearningGateway({ projectRoot: root, lessonIndexPath: indexPath, eventsPath })
		for (let i = 0; i < 3; i++) {
			await gateway.search({ query: "safe parser", taskId: `task-${i}` })
			await gateway.score({
				task_id: `task-${i}`,
				lessonIds: ["lesson-good"],
				outcome: "success",
				used_lessons: 1,
			})
		}
		const stats = await gateway.getOperationalStats()
		expect(stats.topLessons[0].id).toBe("lesson-good")
		expect(stats.promotionCandidates[0].id).toBe("lesson-good")
	})

	it("applies curation overlays without mutating the generated index", async () => {
		const gateway = new LearningGateway({ projectRoot: root, lessonIndexPath: indexPath, eventsPath })
		await gateway.curate({
			lesson_id: "lesson-draft",
			action: "approve",
			rule_summary: "Always replace placeholders before relying on a lesson.",
			lesson_summary: "Draft lessons need durable rules before use.",
			policy_status: "eligible",
		})
		let result = await gateway.search({ query: "placeholders lesson", topK: 3 })
		expect(result.lessons.map((lesson) => lesson.id)).toContain("lesson-draft")
		await gateway.curate({ lesson_id: "lesson-draft", action: "retire" })
		result = await gateway.search({ query: "placeholders lesson", topK: 3 })
		expect(result.lessons.map((lesson) => lesson.id)).not.toContain("lesson-draft")
	})
})
