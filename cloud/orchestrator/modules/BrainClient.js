/**
 * SuperRoo Brain Client — Thin HTTP client for the Central Brain API.
 *
 * Wraps the two endpoints used by the OpenHands-style task loop:
 *   POST /brain/search  — semantic RAG recall of relevant lessons
 *   POST /brain/lessons — write a new lesson after task completion
 *
 * The client is intentionally fire-and-forget on writes (never throws on
 * Central Brain unavailability) so agent loops aren't blocked by it.
 *
 * ENV:
 *   CENTRAL_BRAIN_URL — base URL of the Central Brain API (e.g. http://localhost:8888)
 *                       Leave unset to disable without errors.
 */

class BrainClient {
	/**
	 * @param {string} [baseUrl] - Defaults to process.env.CENTRAL_BRAIN_URL
	 */
	constructor(baseUrl) {
		this.baseUrl = baseUrl ?? process.env.CENTRAL_BRAIN_URL ?? ""
	}

	/**
	 * Retrieve lessons relevant to a task goal.
	 *
	 * @param {string} query - Natural language task description
	 * @param {number} [limit=8]
	 * @returns {Promise<Array<{id:string, title:string, content:string, tags:string[]}>>}
	 */
	async retrieveLessons(query, limit = 8) {
		if (!this.baseUrl) return []
		try {
			const res = await fetch(`${this.baseUrl}/brain/search`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ query, limit }),
				signal: AbortSignal.timeout(5000),
			})
			if (!res.ok) return []
			const json = await res.json()
			return json.lessons ?? []
		} catch {
			return []
		}
	}

	/**
	 * Write a lesson to the Central Brain after task completion.
	 * Fire-and-forget — never throws.
	 *
	 * @param {string} taskId
	 * @param {string} content - Lesson text
	 * @param {string[]} [tags=[]]
	 */
	async writeLesson(taskId, content, tags = []) {
		if (!this.baseUrl) return
		fetch(`${this.baseUrl}/brain/lessons`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ taskId, content, tags }),
			signal: AbortSignal.timeout(5000),
		}).catch(() => undefined)
	}
}

// Shared singleton — most consumers want the same client instance
const brainClient = new BrainClient()

module.exports = { BrainClient, brainClient }
