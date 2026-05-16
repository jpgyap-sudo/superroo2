/**
 * Super Roo Host — Roo Approval Adapter.
 *
 * Translates Super Roo's `SafetyMode` into SuperRoo auto-approval settings
 * (`SuperRooSettings`) and applies them via `ClineProvider.setValues()` BEFORE
 * each Task is constructed. Roo reads these flags at Task construction time,
 * so applying them mid-Task is too late.
 *
 * This file lives under `src/super-roo-host/` (NOT `src/super-roo/`) because
 * it imports `vscode` and Roo's host types. Keeping it here preserves the
 * headless boundary for the rest of Super Roo.
 *
 * Mode alignment (Phase 1 ↔ Phase 2 spec)
 * ────────────────────────────────────────
 * Phase 1 introduced: OFF / SAFE / AUTO / FULL_AUTONOMOUS.
 * Phase 2 spec asks for: MANUAL / SAFE_AUTO / AUTO / FULL_AUTONOMOUS.
 * They are functionally the same four levels; this adapter accepts both
 * spellings and treats them as aliases:
 *
 *   MANUAL    ≡ OFF             — no autonomous work; this adapter is a no-op
 *                                 because no Task should be dispatched at all.
 *   SAFE_AUTO ≡ SAFE            — read-only. Auto-approve reads only.
 *   AUTO      ≡ AUTO            — edit/test/commit/stage. Auto-approve edits,
 *                                 commands (with allowlist), MCP, mode switches.
 *                                 Production deploy stays gated.
 *   FULL_AUTONOMOUS ≡ same      — everything in AUTO + production deploys.
 *
 * Phase 3 will pick a single canonical naming and migrate.
 *
 * What gets flipped per mode
 * ──────────────────────────
 * The mapping is INTENTIONALLY conservative — we only enable flags we are
 * confident about. Each line is annotated. If you change a default here,
 * change the README too.
 */

import type { ClineProvider } from "../core/webview/ClineProvider"
import type { SuperRooSettings } from "@superroo/types"

import { SafetyMode } from "../super-roo/types"

/**
 * Phase 2's spec uses these names; Phase 1 uses SafetyMode.OFF/SAFE/AUTO/FULL_AUTONOMOUS.
 * This type is the union of both spellings; the adapter normalizes to the
 * Phase 1 enum internally.
 */
export type ApprovalModeName =
	| SafetyMode
	| "MANUAL"
	| "SAFE_AUTO"

function normalize(mode: ApprovalModeName): SafetyMode {
	switch (mode) {
		case "MANUAL":
			return SafetyMode.OFF
		case "SAFE_AUTO":
			return SafetyMode.SAFE
		default:
			return mode
	}
}

/**
 * The exact set of auto-approval flags Super Roo manages.
 *
 * Anything outside this set we deliberately don't touch — the user's existing
 * Roo settings remain in effect. This minimizes surprise and respects user
 * configuration.
 */
type ManagedFlags = Pick<
	SuperRooSettings,
	| "autoApprovalEnabled"
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowExecute"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowFollowupQuestions"
>

/**
 * The mapping table. EXPLICIT, REVIEWABLE. If something seems wrong here,
 * fix it here — do not patch agents to work around bad flag values.
 */
export const APPROVAL_PRESETS: Record<SafetyMode, ManagedFlags> = {
	// MANUAL / OFF
	// ────────────
	// Defensive: even though the orchestrator should never dispatch in OFF,
	// if something slips through, every flag is off so Roo prompts for
	// every action. This is the same as the user pressing "manual mode."
	[SafetyMode.OFF]: {
		autoApprovalEnabled: false,
		alwaysAllowReadOnly: false,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowExecute: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowFollowupQuestions: false,
	},

	// SAFE_AUTO / SAFE
	// ────────────────
	// Reads only. Roo can auto-approve reading files (inside the workspace).
	// Crawls (network reads) are also implicitly allowed via mode capability,
	// but Roo treats those through the MCP / fetch tool which we leave OFF
	// here — those will require explicit prompts. This is the most cautious
	// posture that still does useful work (reading code, summarizing, etc.).
	[SafetyMode.SAFE]: {
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowReadOnlyOutsideWorkspace: false, // do not auto-read outside the workspace
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowExecute: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowFollowupQuestions: false,
	},

	// AUTO
	// ────
	// Roo can edit, run commands (subject to allowedCommands), invoke MCP
	// tools, switch modes, and spawn subtasks. This is the everyday
	// autonomous mode for working on the user's project.
	//
	// alwaysAllowWriteProtected stays FALSE — Roo's "protected" files
	// (.git/, .env, etc.) should still require explicit confirmation even
	// in AUTO. Users who want to override this can edit the preset.
	//
	// alwaysAllowFollowupQuestions stays FALSE — auto-answering the agent's
	// own follow-up questions short-circuits useful clarification loops.
	[SafetyMode.AUTO]: {
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: true,
		alwaysAllowWriteOutsideWorkspace: false, // still gate outside-workspace writes
		alwaysAllowWriteProtected: false, // .git, .env, etc. stay gated
		alwaysAllowExecute: true,
		alwaysAllowMcp: true,
		alwaysAllowModeSwitch: true,
		alwaysAllowSubtasks: true,
		alwaysAllowFollowupQuestions: false,
	},

	// FULL_AUTONOMOUS
	// ───────────────
	// Everything AUTO does, plus protected files and outside-workspace writes
	// (needed for deploy scripts that touch e.g. /etc/nginx, server config).
	// Production-deploy gating is enforced by the SafetyManager capability
	// check, not by Roo flags — Roo doesn't know what "production deploy"
	// means; it just sees an `execute_command`. So this preset's posture is
	// "fully unattended within the workspace and necessary system paths."
	[SafetyMode.FULL_AUTONOMOUS]: {
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowReadOnlyOutsideWorkspace: true,
		alwaysAllowWrite: true,
		alwaysAllowWriteOutsideWorkspace: true,
		alwaysAllowWriteProtected: true,
		alwaysAllowExecute: true,
		alwaysAllowMcp: true,
		alwaysAllowModeSwitch: true,
		alwaysAllowSubtasks: true,
		alwaysAllowFollowupQuestions: true,
	},
}

/**
 * Apply the preset for `mode` to the provider's settings before a Task starts.
 *
 * Important: we ONLY touch flags listed in `ManagedFlags`. Other user settings
 * (model selection, custom instructions, MCP servers, etc.) are left alone.
 *
 * If `mode === OFF/MANUAL` we still apply the preset — defense in depth in case
 * an upstream caller forgot to gate. The preset disables auto-approval entirely.
 */
export class RooApprovalAdapter {
	constructor(private readonly provider: Pick<ClineProvider, "setValues">) {}

	async apply(mode: ApprovalModeName): Promise<void> {
		const normalized = normalize(mode)
		const preset = APPROVAL_PRESETS[normalized]
		if (!preset) {
			throw new Error(`RooApprovalAdapter: unknown safety mode: ${String(mode)}`)
		}
		// `setValues` accepts a partial SuperRooSettings; we pass exactly our
		// managed slice so we don't accidentally clobber unrelated settings.
		await this.provider.setValues(preset)
	}

	/** Read the canonical preset for inspection (used by tests and the dashboard). */
	getPreset(mode: ApprovalModeName): ManagedFlags {
		return APPROVAL_PRESETS[normalize(mode)]
	}
}
