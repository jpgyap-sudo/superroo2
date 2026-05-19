"use strict"

/**
 * Deployment VPS allowlist guard.
 *
 * Purpose: keep project registration/routing separate from deployment authority.
 * A project can be known to SuperRoo without being allowed to deploy to the
 * SuperRoo production VPS.
 */

const PROJECT_TARGETS = {
	superroo2: {
		projectNames: ["superroo2", "superroo", "super-roo", "super_roo"],
		tailscaleIp: "100.64.175.88",
		publicIp: "104.248.225.250",
		hostname: "ubuntu-s-2vcpu-4gb-amd-nyc1",
		rootPath: "/opt/superroo2",
		domains: ["dev.abcx124.xyz"],
		forbiddenPaths: ["/opt/quotation-automation"],
		forbiddenHostIps: ["100.86.182.7", "165.22.110.111"],
	},
	"quotation-automation-system": {
		projectNames: [
			"quotation-automation-system",
			"quotation_automation_system",
			"workflowautomation",
			"workflow-automation",
			"qas",
			"quotation-automation",
		],
		tailscaleIp: "100.86.182.7",
		publicIp: "165.22.110.111",
		hostname: "ubuntu-s-1vcpu-2gb-sgp1",
		rootPath: "/opt/quotation-automation",
		domains: ["track.abcx124.xyz"],
		forbiddenPaths: ["/opt/superroo2"],
		forbiddenHostIps: ["100.64.175.88", "104.248.225.250"],
	},
}

const PROJECT_ALIASES = Object.fromEntries(
	Object.entries(PROJECT_TARGETS).flatMap(([canonical, target]) =>
		target.projectNames.map((name) => [normalizeToken(name), canonical]),
	),
)

function normalizeToken(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
}

function normalizeProjectName(projectName) {
	const token = normalizeToken(projectName)
	return PROJECT_ALIASES[token] || token
}

function getDeploymentTarget(projectName) {
	return PROJECT_TARGETS[normalizeProjectName(projectName)] || null
}

function parseHost(target) {
	const raw = String(target || "").trim()
	if (!raw) return ""
	const withoutUser = raw.includes("@") ? raw.split("@").pop() : raw
	const bracketMatch = withoutUser.match(/^\[([^\]]+)\](?::\d+)?$/)
	if (bracketMatch) return bracketMatch[1]
	return withoutUser.replace(/:\d+$/, "")
}

function pathMatches(candidate, expected) {
	const left = String(candidate || "").replace(/\/+$/, "")
	const right = String(expected || "").replace(/\/+$/, "")
	return left === right
}

function assertAllowedTarget(projectName, options = {}) {
	const canonical = normalizeProjectName(projectName)
	const target = PROJECT_TARGETS[canonical]
	if (!target) {
		throw new Error(`No deployment allowlist entry for project "${projectName}"`)
	}

	const host = parseHost(options.sshTarget || options.host || options.target)
	if (host) {
		const allowedHosts = [target.tailscaleIp, target.publicIp, target.hostname].filter(Boolean)
		if (!allowedHosts.includes(host)) {
			throw new Error(
				`Deployment target "${host}" is not allowed for ${canonical}. Allowed: ${allowedHosts.join(", ")}`,
			)
		}
		if ((target.forbiddenHostIps || []).includes(host)) {
			throw new Error(`Deployment target "${host}" is explicitly forbidden for ${canonical}`)
		}
	}

	const rootPath = options.rootPath || options.path || options.projectRoot
	if (rootPath && !pathMatches(rootPath, target.rootPath)) {
		throw new Error(`Deployment path "${rootPath}" is not allowed for ${canonical}. Expected: ${target.rootPath}`)
	}

	for (const forbiddenPath of target.forbiddenPaths || []) {
		if (rootPath && pathMatches(rootPath, forbiddenPath)) {
			throw new Error(`Deployment path "${rootPath}" is forbidden for ${canonical}`)
		}
	}

	return target
}

function shellSingleQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function remoteVerificationCommand(projectName, options = {}) {
	const target = assertAllowedTarget(projectName, options)
	const expectedHost = shellSingleQuote(target.hostname)
	const expectedIp = shellSingleQuote(target.tailscaleIp)
	const expectedPath = shellSingleQuote(target.rootPath)
	const forbiddenPaths = target.forbiddenPaths || []

	return [
		"set -e",
		`test "$(hostname)" = ${expectedHost}`,
		`tailscale ip -4 2>/dev/null | grep -Fx ${expectedIp} >/dev/null`,
		`test -d ${expectedPath}`,
		...forbiddenPaths.map((forbidden) => `test ! -e ${shellSingleQuote(forbidden)}`),
	].join(" && ")
}

module.exports = {
	PROJECT_TARGETS,
	normalizeProjectName,
	getDeploymentTarget,
	assertAllowedTarget,
	remoteVerificationCommand,
	parseHost,
}
