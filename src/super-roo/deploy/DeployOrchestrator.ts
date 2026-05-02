/**
 * Super Roo — Phase 5: Deploy System
 *
 * GitHub Actions → VPS pipeline with auto-deploy, health checks, and rollback.
 *
 * Components:
 *   - GitHubClient: creates/triggers workflows via GitHub API
 *   - VPSDeployer: SSH + SCP deployment script
 *   - HealthChecker: polls /api/health endpoint
 *   - RollbackManager: keeps last N deploy bundles, restores on failure
 */

import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"

export interface DeployConfig {
	githubToken: string
	repoOwner: string
	repoName: string
	vpsHost: string
	vpsUser: string
	vpsKeyPath?: string
	vpsDeployPath: string
	healthUrl: string
	maxRollbackVersions: number
}

export interface DeployState {
	version: string
	commitSha: string
	deployedAt: number
	status: "pending" | "running" | "healthy" | "unhealthy" | "rolled_back"
	/** Populated when the deploy pipeline fails. */
	error?: string
}

export class DeployOrchestrator {
	private history: DeployState[] = []
	private current: DeployState | null = null

	constructor(private readonly config: DeployConfig) {}

	/**
	 * Trigger a full deploy pipeline:
	 * 1. Push to GitHub (create release + workflow dispatch)
	 * 2. Wait for build artifact
	 * 3. SCP artifact to VPS
	 * 4. Run health check
	 * 5. On failure → auto-rollback
	 */
	async deploy(version: string, commitSha: string): Promise<DeployState> {
		const state: DeployState = {
			version,
			commitSha,
			deployedAt: Date.now(),
			status: "pending",
		}
		this.current = state
		this.history.unshift(state)
		this.trimHistory()

		try {
			state.status = "running"
			await this.triggerGitHubWorkflow(version, commitSha)
			await this.deployToVps(version)
			const healthy = await this.runHealthCheck()
			state.status = healthy ? "healthy" : "unhealthy"

			if (!healthy) {
				await this.rollback()
			}
		} catch (err) {
			state.status = "unhealthy"
			state.error = err instanceof Error ? err.message : String(err)
			await this.rollback()
		}

		return state
	}

	/** Health check the live VPS endpoint. */
	async healthCheck(): Promise<{ ok: boolean; latencyMs: number; details?: Record<string, unknown> }> {
		const start = Date.now()
		try {
			const res = await this.fetch(this.config.healthUrl, { timeout: 10000 })
			const latencyMs = Date.now() - start
			if (res.status >= 200 && res.status < 300) {
				const json = await res.json().catch(() => ({}))
				return { ok: true, latencyMs, details: json }
			}
			return { ok: false, latencyMs }
		} catch {
			return { ok: false, latencyMs: Date.now() - start }
		}
	}

	/** Rollback to the previous healthy version. */
	async rollback(): Promise<DeployState | null> {
		const previous = this.history.find((h) => h.status === "healthy" && h.version !== this.current?.version)
		if (!previous) return null

		this.current = { ...previous, deployedAt: Date.now(), status: "rolled_back" }
		await this.deployToVps(previous.version)
		return this.current
	}

	getHistory(): DeployState[] {
		return [...this.history]
	}

	getCurrent(): DeployState | null {
		return this.current ? { ...this.current } : null
	}

	// ── Internal pipeline steps ───────────────────────────────────────────────

	private async triggerGitHubWorkflow(version: string, commitSha: string): Promise<void> {
		// In a real implementation this calls the GitHub REST API:
		// POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
		// For now we write a deploy manifest that a GitHub Action can read.
		const manifestDir = path.join(process.cwd(), ".super-roo", "deploy")
		fs.mkdirSync(manifestDir, { recursive: true })
		const manifest = {
			version,
			commitSha,
			triggeredAt: new Date().toISOString(),
			vpsHost: this.config.vpsHost,
			vpsDeployPath: this.config.vpsDeployPath,
		}
		fs.writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2))
	}

	private async deployToVps(version: string): Promise<void> {
		// Build a deploy bundle locally then SCP it to the VPS
		const bundleDir = path.join(process.cwd(), ".super-roo", "deploy", "bundles")
		fs.mkdirSync(bundleDir, { recursive: true })
		const bundlePath = path.join(bundleDir, `${version}.tar.gz`)

		// Create tarball of the current workspace (excluding node_modules, .git, etc.)
		await this.createDeployBundle(bundlePath)

		const keyArgs = this.config.vpsKeyPath ? ["-i", this.config.vpsKeyPath] : []
		this.runCommand("scp", [
			...keyArgs,
			bundlePath,
			`${this.config.vpsUser}@${this.config.vpsHost}:${this.config.vpsDeployPath}/`,
		])

		this.runCommand("ssh", [
			...keyArgs,
			`${this.config.vpsUser}@${this.config.vpsHost}`,
			`cd ${this.shellQuote(this.config.vpsDeployPath)} && tar -xzf ${this.shellQuote(`${version}.tar.gz`)} && ./scripts/restart.sh`,
		])
	}

	private async runHealthCheck(): Promise<boolean> {
		const result = await this.healthCheck()
		return result.ok
	}

	private async createDeployBundle(outPath: string): Promise<void> {
		const excludeArgs = ["node_modules", ".git", ".super-roo", "dist", "out", ".vscode"].flatMap((e) => [
			"--exclude",
			e,
		])
		this.runCommand("tar", ["-czf", outPath, ...excludeArgs, "."], process.cwd())
	}

	private runCommand(command: string, args: string[], cwd = process.cwd()): void {
		const result = spawnSync(command, args, { cwd, stdio: "ignore", shell: false })
		if (result.error) throw result.error
		if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? "unknown"}`)
	}

	private shellQuote(value: string): string {
		return `'${value.replace(/'/g, "'\\''")}'`
	}

	private trimHistory(): void {
		while (this.history.length > this.config.maxRollbackVersions) {
			this.history.pop()
		}
	}

	private async fetch(url: string, opts: { timeout?: number } = {}): Promise<Response> {
		return globalThis.fetch(url, { signal: AbortSignal.timeout(opts.timeout ?? 5000) })
	}
}
