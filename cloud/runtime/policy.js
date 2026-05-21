/**
 * SuperRoo Runtime — Command Policy
 *
 * Guards the sandboxed execution server against destructive shell commands.
 * Every command passes through validateCommand() before exec().
 *
 * DenyList: exact substring matches (lowercased).
 * AllowList: explicit safe prefixes that bypass the more aggressive heuristics.
 */

// Commands blocked unconditionally
const DENY_LIST = [
	"rm -rf /",
	"rm -rf /*",
	"mkfs",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"dd if=",
	":(){ :|:& };:",
	"chmod -R 777 /",
	"chown -R",
	"> /dev/sda",
	"fdisk",
	"parted",
]

// Commands that require an explicit allowance flag from the caller
const ELEVATED_LIST = ["curl ", "wget ", "ssh ", "scp ", "nc ", "ncat ", "netcat "]

/**
 * Validate a shell command against the deny and elevated lists.
 *
 * @param {string} command - Shell command to validate
 * @param {{ allowNetwork?: boolean }} [opts]
 * @throws {Error} if the command matches a blocked pattern
 */
function validateCommand(command, opts = {}) {
	const normalized = command.toLowerCase().trim()

	for (const blocked of DENY_LIST) {
		if (normalized.includes(blocked)) {
			throw new Error(`[runtime/policy] Blocked unsafe command pattern: "${blocked}"`)
		}
	}

	if (!opts.allowNetwork) {
		for (const elevated of ELEVATED_LIST) {
			if (normalized.includes(elevated)) {
				throw new Error(`[runtime/policy] Network command "${elevated.trim()}" requires opts.allowNetwork=true`)
			}
		}
	}
}

module.exports = { validateCommand, DENY_LIST, ELEVATED_LIST }
