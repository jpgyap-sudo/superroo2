/**
 * SkillsGenerator — Auto-Creates Skills & Resources from Failures
 *
 * Automatically generates .roo/skills/ skill files and resource documentation
 * from debug team failures and lessons learned. This creates a growing knowledge
 * base that prevents the same mistakes from recurring.
 *
 * Each generated skill captures:
 *   - The failure pattern and root cause
 *   - The solution that worked
 *   - Key assumptions that were wrong
 *   - Verification steps for the future
 *   - Related files and modules
 *
 * Inspired by the project-artifact-generator skill methodology.
 */

import { EventEmitter } from "events"
import * as fs from "fs"
import * as path from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SkillSource = "failure" | "lesson" | "pattern" | "manual"

export type GeneratedArtifactType = "skill" | "resource" | "rule" | "documentation"

export interface SkillDefinition {
	name: string
	description: string
	failurePattern: string
	rootCause: string
	solution: string
	verificationSteps: string[]
	relatedFiles: string[]
	tags: string[]
	source: SkillSource
	confidence: number
	usageCount: number
	createdAt: number
	lastUsedAt?: number
}

export interface ResourceDefinition {
	name: string
	description: string
	content: string
	type: "reference" | "guide" | "checklist" | "template"
	tags: string[]
	relatedSkills: string[]
}

export interface GeneratedArtifact {
	id: string
	type: GeneratedArtifactType
	name: string
	path: string
	content: string
	source: SkillSource
	createdAt: number
}

export interface SkillsGeneratorConfig {
	/** Root directory for generated skills. Default: ".roo/skills/debug-team" */
	skillsOutputDir: string
	/** Root directory for generated resources. Default: "docs/resources/debug-team" */
	resourcesOutputDir: string
	/** Whether to actually write files to disk. Default: true */
	enableFileWrite: boolean
	/** Max skills to keep. Default: 100 */
	maxSkills: number
	/** Confidence threshold for auto-generation. Default: 0.6 */
	minConfidenceForAutoGen: number
	/** Workspace root path */
	workspaceRoot: string
}

export interface FailureInput {
	goal: string
	failureType: string
	attempt: number
	lessons: Array<{
		id: string
		failureType: string
		rootCause: string
		filesInvolved: string[]
		nextHypothesis: string
	}>
	affectedFiles: string[]
}

export interface LessonInput {
	id: string
	jobId: string
	attempt: number
	failureType: string
	rootCause: string
	filesInvolved: string[]
	nextHypothesis: string
	skillGenerated: boolean
	skillPath?: string
	createdAt: number
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface SkillsGeneratorEvents {
	"skill:generated": (artifact: GeneratedArtifact) => void
	"skill:skipped": (reason: string, failureType: string) => void
	"resource:generated": (artifact: GeneratedArtifact) => void
	"artifact:written": (path: string, type: GeneratedArtifactType) => void
	"artifact:failed": (error: Error, type: GeneratedArtifactType) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class SkillsGenerator {
	private config: SkillsGeneratorConfig
	private emitter: EventEmitter
	private skills: SkillDefinition[] = []
	private resources: ResourceDefinition[] = []
	private artifacts: GeneratedArtifact[] = []
	private failurePatterns: Map<string, number> = new Map() // pattern → count

	constructor(config?: Partial<SkillsGeneratorConfig>) {
		this.config = {
			skillsOutputDir: config?.skillsOutputDir ?? ".roo/skills/debug-team",
			resourcesOutputDir: config?.resourcesOutputDir ?? "docs/resources/debug-team",
			enableFileWrite: config?.enableFileWrite ?? true,
			maxSkills: config?.maxSkills ?? 100,
			minConfidenceForAutoGen: config?.minConfidenceForAutoGen ?? 0.6,
			workspaceRoot: config?.workspaceRoot ?? process.cwd(),
		}
		this.emitter = new EventEmitter()
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof SkillsGeneratorEvents>(
		event: K,
		listener: SkillsGeneratorEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof SkillsGeneratorEvents>(
		event: K,
		listener: SkillsGeneratorEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof SkillsGeneratorEvents>(
		event: K,
		...args: Parameters<SkillsGeneratorEvents[K]>
	): void {
		this.emitter.emit(event, ...(args as unknown[]))
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Generate a skill from a failure.
	 * Analyzes the failure pattern, extracts the root cause and solution,
	 * and creates a skill file that can prevent similar failures in the future.
	 */
	async generateFromFailure(input: FailureInput): Promise<GeneratedArtifact> {
		// Track failure pattern frequency
		const patternKey = `${input.failureType}:${input.goal.substring(0, 50)}`
		const count = (this.failurePatterns.get(patternKey) || 0) + 1
		this.failurePatterns.set(patternKey, count)

		// Calculate confidence based on pattern frequency
		const confidence = Math.min(0.9, 0.5 + count * 0.1)

		// Skip if confidence is too low
		if (confidence < this.config.minConfidenceForAutoGen) {
			this.emit("skill:skipped", `Confidence ${confidence} below threshold`, input.failureType)
			throw new Error(
				`Confidence ${confidence.toFixed(2)} below auto-generation threshold ${this.config.minConfidenceForAutoGen}`,
			)
		}

		// Extract root cause from lessons
		const rootCause = input.lessons.length > 0
			? input.lessons[input.lessons.length - 1].rootCause
			: "Unknown root cause"

		// Build the skill definition
		const skillName = this.buildSkillName(input.failureType, input.goal)
		const skill: SkillDefinition = {
			name: skillName,
			description: `Debug team learned how to handle "${input.failureType}" when working on "${input.goal}"`,
			failurePattern: input.failureType,
			rootCause,
			solution: this.buildSolution(input),
			verificationSteps: this.buildVerificationSteps(input),
			relatedFiles: [...input.affectedFiles],
			tags: this.buildTags(input),
			source: "failure",
			confidence,
			usageCount: 1,
			createdAt: Date.now(),
		}

		this.skills.push(skill)

		// Enforce max skills limit
		while (this.skills.length > this.config.maxSkills) {
			this.skills.shift()
		}

		// Generate the artifact
		const artifact = await this.writeSkillFile(skill, input)
		this.artifacts.push(artifact)
		this.emit("skill:generated", artifact)

		return artifact
	}

	/**
	 * Generate a skill from a lesson (post-success).
	 * Called after a job completes to capture what was learned.
	 */
	async generateFromLesson(lesson: LessonInput): Promise<GeneratedArtifact> {
		const patternKey = `lesson:${lesson.failureType}`
		const count = (this.failurePatterns.get(patternKey) || 0) + 1
		this.failurePatterns.set(patternKey, count)

		const confidence = Math.min(0.95, 0.6 + count * 0.05)

		const skillName = `lesson-${lesson.failureType.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`
		const skill: SkillDefinition = {
			name: skillName,
			description: `Lesson learned from debug job ${lesson.jobId}: ${lesson.rootCause}`,
			failurePattern: lesson.failureType,
			rootCause: lesson.rootCause,
			solution: lesson.nextHypothesis || "See debug job logs for solution details",
			verificationSteps: [
				`Verify that ${lesson.rootCause} is properly handled`,
				`Run tests for affected files: ${lesson.filesInvolved.join(", ")}`,
				`Check that the fix doesn't introduce regressions`,
			],
			relatedFiles: [...lesson.filesInvolved],
			tags: ["lesson", lesson.failureType, "debug-team"],
			source: "lesson",
			confidence,
			usageCount: 1,
			createdAt: Date.now(),
		}

		this.skills.push(skill)

		while (this.skills.length > this.config.maxSkills) {
			this.skills.shift()
		}

		const artifact = await this.writeSkillFile(skill, {
			goal: `Lesson from job ${lesson.jobId}`,
			failureType: lesson.failureType,
			attempt: lesson.attempt,
			lessons: [lesson],
			affectedFiles: lesson.filesInvolved,
		})

		this.artifacts.push(artifact)
		this.emit("skill:generated", artifact)

		return artifact
	}

	/**
	 * Generate a resource document from accumulated skills.
	 * Creates a comprehensive reference document covering all known failure patterns.
	 */
	async generateResourceDocument(name: string, description: string): Promise<GeneratedArtifact> {
		const resource: ResourceDefinition = {
			name,
			description,
			content: this.buildResourceContent(),
			type: "reference",
			tags: ["debug-team", "auto-generated"],
			relatedSkills: this.skills.map((s) => s.name),
		}

		this.resources.push(resource)

		const artifact = await this.writeResourceFile(resource)
		this.artifacts.push(artifact)
		this.emit("resource:generated", artifact)

		return artifact
	}

	/**
	 * Get all generated artifacts.
	 */
	listArtifacts(): GeneratedArtifact[] {
		return [...this.artifacts]
	}

	/**
	 * Get all skill definitions.
	 */
	listSkills(): SkillDefinition[] {
		return [...this.skills]
	}

	/**
	 * Get failure pattern statistics.
	 */
	getFailurePatterns(): Map<string, number> {
		return new Map(this.failurePatterns)
	}

	/**
	 * Find a skill by failure pattern.
	 */
	findSkillByPattern(failurePattern: string): SkillDefinition | undefined {
		return this.skills.find((s) => s.failurePattern === failurePattern)
	}

	/**
	 * Reset the engine state.
	 */
	reset(): void {
		this.skills = []
		this.resources = []
		this.artifacts = []
		this.failurePatterns.clear()
	}

	// ── Private: Content Generation ─────────────────────────────────────────

	private buildSkillName(failureType: string, goal: string): string {
		const sanitizedFailure = failureType
			.replace(/[^a-zA-Z0-9]/g, "-")
			.replace(/-+/g, "-")
			.toLowerCase()
			.substring(0, 30)

		const sanitizedGoal = goal
			.replace(/[^a-zA-Z0-9]/g, "-")
			.replace(/-+/g, "-")
			.toLowerCase()
			.substring(0, 30)

		return `${sanitizedFailure}-${sanitizedGoal}`
	}

	private buildSolution(input: FailureInput): string {
		const parts: string[] = [
			`## Solution for: ${input.failureType}`,
			"",
			`**Goal**: ${input.goal}`,
			`**Attempt**: ${input.attempt}`,
			"",
			"### Root Cause Analysis",
		]

		for (const lesson of input.lessons) {
			parts.push(`- **${lesson.failureType}**: ${lesson.rootCause}`)
		}

		parts.push("", "### Applied Fix", "")
		parts.push("The debug team iterated through hypotheses and applied the following changes:")

		for (const file of input.affectedFiles) {
			parts.push(`- Modified: \`${file}\``)
		}

		parts.push(
			"",
			"### Verification",
			"",
			"1. All existing tests pass",
			"2. New tests cover the failure case",
			"3. Integration verified with affected features",
			"4. Code review completed",
		)

		return parts.join("\n")
	}

	private buildVerificationSteps(input: FailureInput): string[] {
		const steps: string[] = [
			`Verify that ${input.failureType} no longer occurs`,
			"Run the full test suite to check for regressions",
		]

		for (const file of input.affectedFiles.slice(0, 5)) {
			steps.push(`Verify changes in ${file} are correct`)
		}

		steps.push("Run integration tests for affected features")
		steps.push("Perform a code review of all changes")

		return steps
	}

	private buildTags(input: FailureInput): string[] {
		const tags = new Set<string>()

		tags.add("debug-team")
		tags.add("auto-generated")
		tags.add(input.failureType)

		for (const lesson of input.lessons) {
			tags.add(lesson.failureType)
		}

		for (const file of input.affectedFiles) {
			const ext = path.extname(file).replace(".", "")
			if (ext) tags.add(`file-type:${ext}`)
		}

		return Array.from(tags)
	}

	private buildResourceContent(): string {
		const parts: string[] = [
			"# Debug Team Knowledge Base",
			"",
			"Auto-generated resource document from debug team failures and lessons.",
			"",
			"## Failure Patterns",
			"",
		]

		// Group skills by failure pattern
		const patternGroups = new Map<string, SkillDefinition[]>()
		for (const skill of this.skills) {
			const group = patternGroups.get(skill.failurePattern) || []
			group.push(skill)
			patternGroups.set(skill.failurePattern, group)
		}

		for (const [pattern, skills] of patternGroups) {
			parts.push(`### ${pattern}`)
			parts.push(`Occurred ${skills.length} time(s)`)
			parts.push("")

			for (const skill of skills) {
				parts.push(`- **${skill.name}**: ${skill.description}`)
				parts.push(`  - Root cause: ${skill.rootCause}`)
				parts.push(`  - Confidence: ${(skill.confidence * 100).toFixed(0)}%`)
				parts.push("")
			}
		}

		parts.push("## Verification Checklist", "")
		parts.push("When encountering these patterns, follow the verification steps:")
		parts.push("")

		const allSteps = new Set<string>()
		for (const skill of this.skills) {
			for (const step of skill.verificationSteps) {
				allSteps.add(step)
			}
		}

		for (const step of allSteps) {
			parts.push(`- [ ] ${step}`)
		}

		return parts.join("\n")
	}

	// ── Private: File Writing ───────────────────────────────────────────────

	private async writeSkillFile(
		skill: SkillDefinition,
		input: FailureInput,
	): Promise<GeneratedArtifact> {
		const fileName = `${skill.name}.md`
		const relativeDir = this.config.skillsOutputDir
		const absoluteDir = path.resolve(this.config.workspaceRoot, relativeDir)
		const absolutePath = path.join(absoluteDir, fileName)

		const content = this.formatSkillMarkdown(skill, input)

		const artifact: GeneratedArtifact = {
			id: `skill-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
			type: "skill",
			name: skill.name,
			path: path.join(relativeDir, fileName),
			content,
			source: "failure",
			createdAt: Date.now(),
		}

		if (this.config.enableFileWrite) {
			try {
				await fs.promises.mkdir(absoluteDir, { recursive: true })
				await fs.promises.writeFile(absolutePath, content, "utf-8")
				this.emit("artifact:written", artifact.path, "skill")
			} catch (error) {
				this.emit(
					"artifact:failed",
					error instanceof Error ? error : new Error(String(error)),
					"skill",
				)
			}
		}

		return artifact
	}

	private async writeResourceFile(
		resource: ResourceDefinition,
	): Promise<GeneratedArtifact> {
		const fileName = `${resource.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.md`
		const relativeDir = this.config.resourcesOutputDir
		const absoluteDir = path.resolve(this.config.workspaceRoot, relativeDir)
		const absolutePath = path.join(absoluteDir, fileName)

		const artifact: GeneratedArtifact = {
			id: `resource-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
			type: "resource",
			name: resource.name,
			path: path.join(relativeDir, fileName),
			content: resource.content,
			source: "pattern",
			createdAt: Date.now(),
		}

		if (this.config.enableFileWrite) {
			try {
				await fs.promises.mkdir(absoluteDir, { recursive: true })
				await fs.promises.writeFile(absolutePath, resource.content, "utf-8")
				this.emit("artifact:written", artifact.path, "resource")
			} catch (error) {
				this.emit(
					"artifact:failed",
					error instanceof Error ? error : new Error(String(error)),
					"resource",
				)
			}
		}

		return artifact
	}

	private formatSkillMarkdown(skill: SkillDefinition, input: FailureInput): string {
		const lines: string[] = [
			"---",
			`description: ${skill.description}`,
			`failurePattern: ${skill.failurePattern}`,
			`confidence: ${(skill.confidence * 100).toFixed(0)}%`,
			`source: ${skill.source}`,
			`createdAt: ${new Date(skill.createdAt).toISOString()}`,
			"---",
			"",
			`# ${skill.name}`,
			"",
			skill.description,
			"",
			"## Failure Pattern",
			"",
			`**Type**: ${skill.failurePattern}`,
			"",
			`**Root Cause**: ${skill.rootCause}`,
			"",
			"## Solution",
			"",
			skill.solution,
			"",
			"## Verification Steps",
			"",
		]

		for (const step of skill.verificationSteps) {
			lines.push(`- [ ] ${step}`)
		}

		lines.push("", "## Related Files", "")

		for (const file of skill.relatedFiles) {
			lines.push(`- \`${file}\``)
		}

		lines.push("", "## Tags", "")
		lines.push(skill.tags.map((t) => `\`${t}\``).join(" "))

		return lines.join("\n")
	}
}
