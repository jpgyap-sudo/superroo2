export interface LearningClientOptions {
	baseUrl: string
	apiKey?: string
	project: string
	agentName: string
}

export interface LearningLessonInput {
	task_type?: string
	problem: string
	root_cause?: string
	solution: string
	files_changed?: string[]
	tags?: string[]
	confidence?: number
	risk?: string
	raw_ref?: string
}

export class LearningClient {
	constructor(private readonly options: LearningClientOptions) {}

	private async post<T>(path: string, body: unknown): Promise<T> {
		const response = await fetch(`${this.options.baseUrl}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.options.apiKey ? { "x-learning-key": this.options.apiKey } : {}),
			},
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			throw new Error(`Learning API failed ${response.status}: ${await response.text()}`)
		}

		return (await response.json()) as T
	}

	search(query: string, topK = 3, tags?: string[]) {
		return this.post<{ success: boolean; compact: string; lessons: unknown[] }>("/api/learning/search", {
			project: this.options.project,
			query,
			topK,
			tags,
			compact: true,
		})
	}

	store(lesson: LearningLessonInput) {
		return this.post("/api/learning/store", {
			...lesson,
			project: this.options.project,
			source_agent: this.options.agentName,
			files_changed: lesson.files_changed || [],
			tags: lesson.tags || [],
			confidence: lesson.confidence ?? 0.7,
		})
	}

	score(task: string, outcome: "success" | "partial" | "failed", usedLessons = 0) {
		return this.post("/api/learning/score", {
			project: this.options.project,
			agent: this.options.agentName,
			task,
			outcome,
			used_lessons: usedLessons,
		})
	}
}
