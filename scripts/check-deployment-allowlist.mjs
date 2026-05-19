#!/usr/bin/env node

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
	PROJECT_TARGETS,
	normalizeProjectName,
	getDeploymentTarget,
	assertAllowedTarget,
	remoteVerificationCommand,
	parseHost,
} = require("../cloud/worker/deploymentAllowlist.js")

const assertions = []

function assert(name, condition) {
	assertions.push({ name, ok: Boolean(condition) })
	if (!condition) throw new Error(name)
}

function assertThrows(name, fn) {
	let threw = false
	try {
		fn()
	} catch {
		threw = true
	}
	assert(name, threw)
}

function selfTest() {
	assert("superroo alias normalizes", normalizeProjectName("SuperRoo") === "superroo2")
	assert("qas alias normalizes", normalizeProjectName("qas") === "quotation-automation-system")
	assert("ssh target host parses", parseHost("root@100.64.175.88") === "100.64.175.88")

	assertAllowedTarget("superroo2", { sshTarget: "root@100.64.175.88", rootPath: "/opt/superroo2" })
	assertAllowedTarget("quotation-automation-system", {
		sshTarget: "root@100.86.182.7",
		rootPath: "/opt/quotation-automation",
	})

	assertThrows("blocks QAS on SuperRoo VPS", () =>
		assertAllowedTarget("quotation-automation-system", {
			sshTarget: "root@100.64.175.88",
			rootPath: "/opt/quotation-automation",
		}),
	)
	assertThrows("blocks SuperRoo on QAS VPS", () =>
		assertAllowedTarget("superroo2", { sshTarget: "root@100.86.182.7", rootPath: "/opt/superroo2" }),
	)
	assertThrows("blocks SuperRoo using QAS path", () =>
		assertAllowedTarget("superroo2", { sshTarget: "root@100.64.175.88", rootPath: "/opt/quotation-automation" }),
	)

	const remoteCheck = remoteVerificationCommand("superroo2", {
		sshTarget: "root@100.64.175.88",
		rootPath: "/opt/superroo2",
	})
	assert("remote check verifies SuperRoo hostname", remoteCheck.includes("ubuntu-s-2vcpu-4gb-amd-nyc1"))
	assert("remote check rejects QAS path on SuperRoo", remoteCheck.includes("/opt/quotation-automation"))
}

function validateConfig() {
	for (const [project, target] of Object.entries(PROJECT_TARGETS)) {
		assert(`${project} has tailscale IP`, Boolean(target.tailscaleIp))
		assert(`${project} has public IP`, Boolean(target.publicIp))
		assert(`${project} has hostname`, Boolean(target.hostname))
		assert(`${project} has root path`, Boolean(target.rootPath))
		assert(`${project} has aliases`, Array.isArray(target.projectNames) && target.projectNames.length > 0)
		assert(`${project} is retrievable`, getDeploymentTarget(project) === target)
	}
}

try {
	if (process.argv.includes("--self-test")) {
		selfTest()
	}
	validateConfig()
	console.log("Deployment allowlist OK")
	if (!process.argv.includes("--quiet")) {
		console.log(JSON.stringify(PROJECT_TARGETS, null, 2))
	}
} catch (error) {
	console.error(`Deployment allowlist check failed: ${error.message}`)
	process.exit(1)
}
