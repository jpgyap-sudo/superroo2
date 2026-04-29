/**
 * Super Roo — TestRunner interface (headless).
 *
 * The seam between the headless Tester Agent and the host process that
 * actually runs `npm test` / `pytest` / `playwright`. The agent calls into
 * this interface; the host implementation lives in
 * `src/super-roo-host/services/tester/TestRunnerHost.ts`.
 *
 * Design rule (consistent with RooTaskRunner): the agent is headless and
 * pluggable. Tests can inject a fake TestRunner.
 */

export type TestKind = "unit" | "lint" | "typecheck" | "e2e" | "custom"

export interface TestRequest {
	/** Kind of test (used to pick a default command if `command` is unset). */
	kind: TestKind
	/** Working directory the test runs in. Defaults to host's chosen workspace. */
	cwd?: string
	/** Override command. If unset, the host picks based on `kind`. */
	command?: string
	/** Override args. */
	args?: string[]
	/** Hard timeout in ms. Default 600_000 (10 min). */
	timeoutMs?: number
	/** Cooperative cancellation. */
	signal?: AbortSignal
}

export interface TestResult {
	kind: TestKind
	command: string
	args: string[]
	cwd: string
	exitCode: number | null
	durationMs: number
	stdout: string
	stderr: string
	/** Convenience: derived from exitCode === 0. */
	passed: boolean
	/** True if killed by timeout. */
	timedOut: boolean
	/** True if killed by AbortSignal. */
	aborted: boolean
}

export interface TestRunner {
	run(req: TestRequest): Promise<TestResult>
	/** Probe for whether the runner can dispatch commands at all. */
	isReady(): boolean
}
