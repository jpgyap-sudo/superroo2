/**
 * Super Roo Host — public surface.
 *
 * Everything in this directory is allowed to import `vscode`, `ClineProvider`,
 * Node's `child_process`/`fs`, and other host-bound modules. The headless
 * `src/super-roo/` is NOT.
 */

export { RooTaskRunner } from "./RooTaskRunner"
export type { RooTaskRunnerOptions } from "./RooTaskRunner"

export { RooApprovalAdapter, APPROVAL_PRESETS } from "./RooApprovalAdapter"
export type { ApprovalModeName } from "./RooApprovalAdapter"

// Phase 2.5 services
export { TestRunnerHost } from "./services/tester"
export type { TestRunnerHostOptions } from "./services/tester"

export { SupabaseRunnerHost } from "./services/supabase"
export type { SupabaseRunnerHostOptions } from "./services/supabase"
