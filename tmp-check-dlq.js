const IORedis = require("ioredis")
const r = new IORedis("redis://127.0.0.1:6379")
async function main() {
	const ids = await r.lrange("superroo-jobs-dlq", 0, -1)
	console.log("DLQ has", ids.length, "jobs")
	for (const id of ids) {
		const raw = await r.get(id)
		if (raw) {
			try {
				const j = JSON.parse(raw)
				if (j.data && j.data.agentId) {
					console.log("Job:", id, "agentId:", j.data.agentId, "task:", (j.data.task || "").substring(0, 120))
				}
			} catch (e) {
				console.log("Parse error for", id, e.message)
			}
		}
	}
	r.quit()
}
main().catch((e) => {
	console.error(e)
	r.quit()
})
