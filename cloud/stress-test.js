/**
 * SuperRoo Cloud — Sandbox Stress Test
 *
 * Sends multiple concurrent jobs to stress-test the queue and Docker sandbox.
 */

const http = require("http")

const API_URL = process.env.API_URL || "http://localhost:8787/job"
const CONCURRENT_JOBS = parseInt(process.env.CONCURRENT_JOBS || "10", 10)

const testPayloads = [
	{
		name: "git-clone",
		task: "stress: git clone",
		commands: [
			"git clone https://github.com/octocat/Hello-World.git test-repo",
			"cd test-repo && ls -la",
			"git status",
			"node -v",
			"pnpm -v",
			"git --version",
		],
		network: "host",
	},
	{
		name: "npm-install",
		task: "stress: npm install",
		commands: ["npm init -y", "npm install lodash", "ls node_modules/lodash"],
		network: "host",
	},
	{
		name: "cpu-bound",
		task: "stress: CPU bound",
		commands: [
			'node -e "console.log(Array.from({length:1e6},(_,i)=>i*i).reduce((a,b)=>a+b))"',
			"echo 'CPU test done'",
		],
		network: "none",
	},
	{
		name: "file-ops",
		task: "stress: file operations",
		commands: [
			"mkdir -p /workspace/files",
			"for i in {1..100}; do echo $i > /workspace/files/$i.txt; done",
			"ls /workspace/files | wc -l",
			"rm -rf /workspace/files",
		],
		network: "none",
	},
	{
		name: "dangerous-blocked",
		task: "stress: dangerous command",
		commands: ["rm -rf /", "echo 'should not reach here'"],
		network: "none",
	},
]

function sendJob(payload) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(payload)
		const req = http.request(
			API_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(data),
				},
			},
			(res) => {
				let body = ""
				res.on("data", (chunk) => {
					body += chunk
				})
				res.on("end", () => {
					try {
						const json = JSON.parse(body)
						resolve(json)
					} catch (e) {
						resolve({ raw: body })
					}
				})
			},
		)
		req.on("error", reject)
		req.write(data)
		req.end()
	})
}

async function runStressTest() {
	console.log(`\n========================================`)
	console.log(`SuperRoo Cloud — Stress Test`)
	console.log(`========================================`)
	console.log(`API URL: ${API_URL}`)
	console.log(`Concurrent jobs: ${CONCURRENT_JOBS}`)
	console.log(`Total payloads: ${testPayloads.length}`)
	console.log(`========================================\n`)

	const results = []

	for (const payload of testPayloads) {
		console.log(`\n--- Testing: ${payload.name} ---`)
		const jobs = []
		const start = Date.now()

		for (let i = 0; i < CONCURRENT_JOBS; i++) {
			jobs.push(
				sendJob(payload)
					.then((r) => ({ success: true, result: r }))
					.catch((e) => ({ success: false, error: e.message })),
			)
		}

		const responses = await Promise.all(jobs)
		const elapsed = Date.now() - start

		const succeeded = responses.filter((r) => r.success && r.result.success).length
		const failed = responses.filter((r) => !r.success || !r.result.success).length

		console.log(`  Queued: ${CONCURRENT_JOBS} in ${elapsed}ms`)
		console.log(`  Success: ${succeeded} | Failed: ${failed}`)

		results.push({
			name: payload.name,
			queued: CONCURRENT_JOBS,
			succeeded,
			failed,
			elapsed,
		})
	}

	console.log(`\n========================================`)
	console.log(`Stress Test Summary`)
	console.log(`========================================`)
	for (const r of results) {
		console.log(
			`${r.name.padEnd(20)} | queued=${String(r.queued).padStart(3)} | success=${String(r.succeeded).padStart(3)} | fail=${String(r.failed).padStart(3)} | ${String(r.elapsed).padStart(5)}ms`,
		)
	}
	console.log(`========================================\n`)
}

runStressTest().catch((err) => {
	console.error("Stress test failed:", err)
	process.exit(1)
})
