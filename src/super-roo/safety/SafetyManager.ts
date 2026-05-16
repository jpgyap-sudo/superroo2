/**
 * Super Roo — Safety module.
 *
 * Two responsibilities:
 *
 *   1. Hold the current SafetyMode (OFF / SAFE / AUTO / FULL_AUTONOMOUS) and
 *      decide whether a given Capability is permitted at this mode.
 *
 *   2. Check arbitrary command strings, file paths, and SQL fragments against
 *      a data-driven blocklist sourced from config/blocklist.json. The
 *      blocklist is loaded once at construction; callers can supply their
 *      own config object for tests.
 *
 * Phase 1 design notes
 * --------------------
 * - This module is intentionally *not* wired into Roo's auto-approval system
 *   yet. Phase 2 will plug an adapter into `src/core/auto-approval/`. Keeping
 *   that wiring out of Phase 1 preserves the rule "no agents yet, no UI yet".
 * - All decisions return a {@link SafetyDecision} (not a thrown error). Callers
 *   choose whether to escalate. This matches Roo's existing tool-validation
 *   style in `src/core/tools/validateToolUse.ts`.
 */

import * as fs from "node:fs"
import * as path from "node:path"

import type { Capability, SafetyDecision } from "../types"
import { SafetyMode } from "../types"

interface BlocklistConfig {
	commandPatterns: string[]
	sqlPatterns: string[]
	pathPatterns: string[]
	capabilityRules: Record<string, string[]>
}

const DEFAULT_BLOCKLIST_PATH = path.join(__dirname, "..", "config", "blocklist.json")

// Compile patterns once. Bad patterns log a warning and are skipped — we do
// NOT throw, because a single corrupt config line shouldn't bring down the
// whole safety system.
function compilePatterns(patterns: string[], label: string): RegExp[] {
	const compiled: RegExp[] = []
	for (const p of patterns) {
		try {
			compiled.push(new RegExp(p, "i"))
		} catch (err) {
			console.warn(`[super-roo/safety] dropping invalid ${label} pattern: ${p}`, err)
		}
	}
	return compiled
}

export interface SafetyManagerOptions {
	initialMode?: SafetyMode
	blocklistPath?: string
	/** Direct injection for tests; takes precedence over blocklistPath. */
	blocklist?: BlocklistConfig
	selfImprove?: boolean
}

export class SafetyManager {
	private mode: SafetyMode
	private selfImprove: boolean

	private commandRegexes: RegExp[]
	private sqlRegexes: RegExp[]
	private pathRegexes: RegExp[]
	private capabilityRules: Record<string, Set<string>>

	constructor(opts: SafetyManagerOptions = {}) {
		this.mode = opts.initialMode ?? SafetyMode.SAFE
		this.selfImprove = opts.selfImprove ?? false

		const cfg = opts.blocklist ?? this.loadBlocklist(opts.blocklistPath ?? DEFAULT_BLOCKLIST_PATH)

		this.commandRegexes = compilePatterns(cfg.commandPatterns, "command")
		this.sqlRegexes = compilePatterns(cfg.sqlPatterns, "sql")
		this.pathRegexes = compilePatterns(cfg.pathPatterns, "path")

		this.capabilityRules = {}
		for (const [mode, caps] of Object.entries(cfg.capabilityRules)) {
			this.capabilityRules[mode] = new Set(caps)
		}
	}

	private loadBlocklist(p: string): BlocklistConfig {
		try {
			const raw = fs.readFileSync(p, "utf8")
			const parsed = JSON.parse(raw) as BlocklistConfig
			return {
				commandPatterns: parsed.commandPatterns ?? [],
				sqlPatterns: parsed.sqlPatterns ?? [],
				pathPatterns: parsed.pathPatterns ?? [],
				capabilityRules: parsed.capabilityRules ?? {},
			}
		} catch (err) {
			console.warn(`[super-roo/safety] failed to load blocklist at ${p}; using empty config`, err)
			return { commandPatterns: [], sqlPatterns: [], pathPatterns: [], capabilityRules: {} }
		}
	}

	// ──────────────────────────────────────────────────────────────────────
	// Mode
	// ──────────────────────────────────────────────────────────────────────

	getMode(): SafetyMode {
		return this.mode
	}

	setMode(next: SafetyMode): void {
		this.mode = next
	}

	getSelfImprove(): boolean {
		return this.selfImprove
	}

	setSelfImprove(value: boolean): void {
		this.selfImprove = value
	}

	// ──────────────────────────────────────────────────────────────────────
	// Capability check
	// ──────────────────────────────────────────────────────────────────────

	checkCapability(cap: Capability): SafetyDecision {
		if (this.mode === SafetyMode.OFF) {
			return { allowed: false, reason: "Autonomy is OFF.", rule: "mode" }
		}
		const allowed = this.capabilityRules[this.mode]
		if (!allowed) {
			// Default-deny with informative message, but don't crash on new modes
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

	checkCapabilities(caps: Capability[]): SafetyDecision {
		for (const cap of caps) {
			const d = this.checkCapability(cap)
			if (!d.allowed) return d
		}
		return { allowed: true, reason: "ok", rule: "mode" }
	}

	// ──────────────────────────────────────────────────────────────────────
	// Pattern checks (defense in depth — independent of capability check)
	// ──────────────────────────────────────────────────────────────────────

	checkCommand(command: string): SafetyDecision {
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
		// SQL patterns may also appear inside a shell command (e.g. `psql -c "DROP DATABASE x"`).
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

	checkSql(sql: string): SafetyDecision {
		for (const re of this.sqlRegexes) {
			if (re.test(sql)) {
				return { allowed: false, reason: `SQL matches blocklist: ${re.source}`, rule: "blocklist" }
			}
		}
		return { allowed: true, reason: "ok", rule: "blocklist" }
	}

	checkPath(p: string): SafetyDecision {
		// Resolve to absolute for consistent matching, but never let resolution itself throw.
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

	// ──────────────────────────────────────────────────────────────────────
	// Self-improve guard
	// ──────────────────────────────────────────────────────────────────────

	/**
	 * Targets that are Super Roo's own codebase are blocked unless selfImprove
	 * is explicitly on. This protects against accidental self-modification when
	 * a user opens the Roo repo as a workspace.
	 *
	 * @param targetPath  Absolute path the action wants to touch.
	 * @param superRooRoot Absolute path of the super-roo source directory.
	 */
	checkSelfImproveBoundary(targetPath: string, superRooRoot: string): SafetyDecision {
		if (this.selfImprove) {
			return { allowed: true, reason: "self-improve enabled", rule: "self_improve_guard" }
		}
		const t = path.resolve(targetPath)
		const r = path.resolve(superRooRoot)
		if (t === r || t.startsWith(r + path.sep)) {
			return {
				allowed: false,
				reason: "Target is inside Super Roo's own codebase. Enable /super_roo_self_improve to override.",
				rule: "self_improve_guard",
			}
		}
		return { allowed: true, reason: "ok", rule: "self_improve_guard" }
	}
}
