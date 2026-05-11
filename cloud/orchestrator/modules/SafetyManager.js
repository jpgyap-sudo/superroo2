/**
 * Cloud Orchestrator — Safety Manager.
 *
 * Ported from src/super-roo/safety/SafetyManager.ts for the cloud runtime.
 *
 * Responsibilities:
 *   1. Hold the current SafetyMode (OFF / SAFE / AUTO / FULL_AUTONOMOUS) and
 *      decide whether a given capability is permitted at this mode.
 *   2. Check arbitrary command strings, file paths, and SQL fragments against
 *      a data-driven blocklist sourced from config/blocklist.json.
 */

const fs = require("node:fs")
const path = require("node:path")

// ─── SafetyMode enum ────────────────────────────────────────────────────────
const SafetyMode = Object.freeze({
	OFF: "off",
	SAFE: "safe",
	AUTO: "auto",
	FULL_AUTONOMOUS: "full_autonomous",
})

// ─── Default blocklist path ─────────────────────────────────────────────────
const DEFAULT_BLOCKLIST_PATH = path.join(__dirname, "..", "config", "blocklist.json")

/**
 * Compile an array of regex pattern strings into RegExp objects.
 * Invalid patterns are logged and skipped — a single bad pattern never
 * brings down the safety system.
 */
function compilePatterns(patterns, label) {
	const compiled = []
	for (const p of patterns) {
		try {
			compiled.push(new RegExp(p, "i"))
		} catch (err) {
			console.warn(`[orchestrator/safety] dropping invalid ${label} pattern: ${p}`, err)
		}
	}
	return compiled
}

class SafetyManager {
	/**
	 * @param {Object} opts
	 * @param {string} [opts.initialMode="safe"]
	 * @param {string} [opts.blocklistPath]
	 * @param {Object} [opts.blocklist]  Direct injection; takes precedence over blocklistPath.
	 * @param {boolean} [opts.selfImprove=false]
	 */
	constructor(opts = {}) {
		this.mode = opts.initialMode || SafetyMode.SAFE
		this.selfImprove = opts.selfImprove || false

		const cfg = opts.blocklist || this._loadBlocklist(opts.blocklistPath || DEFAULT_BLOCKLIST_PATH)

		this.commandRegexes = compilePatterns(cfg.commandPatterns || [], "command")
		this.sqlRegexes = compilePatterns(cfg.sqlPatterns || [], "sql")
		this.pathRegexes = compilePatterns(cfg.pathPatterns || [], "path")

		this.capabilityRules = {}
		for (const [modeName, caps] of Object.entries(cfg.capabilityRules || {})) {
			this.capabilityRules[modeName] = new Set(caps)
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────

	_loadBlocklist(p) {
		try {
			const raw = fs.readFileSync(p, "utf8")
			const parsed = JSON.parse(raw)
			return {
				commandPatterns: parsed.commandPatterns || [],
				sqlPatterns: parsed.sqlPatterns || [],
				pathPatterns: parsed.pathPatterns || [],
				capabilityRules: parsed.capabilityRules || {},
			}
		} catch (err) {
			console.warn(`[orchestrator/safety] failed to load blocklist at ${p}; using empty config`, err)
			return { commandPatterns: [], sqlPatterns: [], pathPatterns: [], capabilityRules: {} }
		}
	}

	// ── Mode ──────────────────────────────────────────────────────────────

	getMode() {
		return this.mode
	}

	setMode(next) {
		this.mode = next
	}

	getSelfImprove() {
		return this.selfImprove
	}

	setSelfImprove(value) {
		this.selfImprove = value
	}

	// ── Capability check ──────────────────────────────────────────────────

	/**
	 * @param {string} cap - A capability name (e.g. "write_file", "deploy_production").
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkCapability(cap) {
		if (this.mode === SafetyMode.OFF) {
			return { allowed: false, reason: "Autonomy is OFF.", rule: "mode" }
		}
		const allowed = this.capabilityRules[this.mode]
		if (!allowed) {
			return {
				allowed: false,
				reason: `Safety mode "${this.mode}" has no capability rules configured.`,
				rule: "mode",
			}
		}
		if (!allowed.has(cap)) {
			return {
				allowed: false,
				reason: `Capability "${cap}" is not permitted at safety mode ${this.mode}.`,
				rule: "mode",
			}
		}
		return { allowed: true, reason: "ok", rule: "mode" }
	}

	/**
	 * Check multiple capabilities in sequence. Returns the first denial.
	 * @param {string[]} caps
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkCapabilities(caps) {
		for (const cap of caps) {
			const d = this.checkCapability(cap)
			if (!d.allowed) return d
		}
		return { allowed: true, reason: "ok", rule: "mode" }
	}

	// ── Pattern checks (defense in depth) ─────────────────────────────────

	/**
	 * @param {string} command
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkCommand(command) {
		const trimmed = command.trim()
		if (trimmed.length === 0) {
			return { allowed: true, reason: "empty command", rule: "blocklist" }
		}
		for (const re of this.commandRegexes) {
			if (re.test(trimmed)) {
				return {
					allowed: false,
					reason: `Command matches blocklist pattern: ${re.source}`,
					rule: "blocklist",
				}
			}
		}
		// SQL patterns may also appear inside a shell command
		for (const re of this.sqlRegexes) {
			if (re.test(trimmed)) {
				return {
					allowed: false,
					reason: `Command appears to contain blocked SQL: ${re.source}`,
					rule: "blocklist",
				}
			}
		}
		return { allowed: true, reason: "ok", rule: "blocklist" }
	}

	/**
	 * @param {string} sql
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkSql(sql) {
		for (const re of this.sqlRegexes) {
			if (re.test(sql)) {
				return { allowed: false, reason: `SQL matches blocklist: ${re.source}`, rule: "blocklist" }
			}
		}
		return { allowed: true, reason: "ok", rule: "blocklist" }
	}

	/**
	 * @param {string} p - File path to check.
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkPath(p) {
		let resolved = p
		try {
			resolved = path.resolve(p)
		} catch {
			// keep as-is; pattern check will still apply
		}
		for (const re of this.pathRegexes) {
			if (re.test(resolved) || re.test(p)) {
				return { allowed: false, reason: `Path matches blocklist: ${re.source}`, rule: "blocklist" }
			}
		}
		return { allowed: true, reason: "ok", rule: "blocklist" }
	}

	// ── Self-improve guard ────────────────────────────────────────────────

	/**
	 * Targets inside the orchestrator's own codebase are blocked unless
	 * selfImprove is explicitly on.
	 *
	 * @param {string} targetPath - Absolute path the action wants to touch.
	 * @param {string} orchestratorRoot - Absolute path of the orchestrator source directory.
	 * @returns {{ allowed: boolean, reason: string, rule: string }}
	 */
	checkSelfImproveBoundary(targetPath, orchestratorRoot) {
		if (this.selfImprove) {
			return { allowed: true, reason: "self-improve enabled", rule: "self_improve_guard" }
		}
		const t = path.resolve(targetPath)
		const r = path.resolve(orchestratorRoot)
		if (t === r || t.startsWith(r + path.sep)) {
			return {
				allowed: false,
				reason: "Target is inside the orchestrator's own codebase. Enable self-improve to override.",
				rule: "self_improve_guard",
			}
		}
		return { allowed: true, reason: "ok", rule: "self_improve_guard" }
	}
}

module.exports = { SafetyManager, SafetyMode }
