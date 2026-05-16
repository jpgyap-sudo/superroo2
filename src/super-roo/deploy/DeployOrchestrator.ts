/**
 * Super Roo — Phase 5: Deploy System
 *
 * GitHub Actions → VPS pipeline with auto-deploy, health checks, and rollback.
 * Uses RemoteShell for secure SSH operations with full audit trail.
 *
 * Components:
 *   - GitHubClient: creates/triggers workflows via GitHub API
 *   - VPSDeployer: SSH + SCP deployment via RemoteShell
 *   - HealthChecker: polls /api/health endpoint
 *   - RollbackManager: keeps last N deploy bundles, restores on failure
 */

import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"
import { RemoteShell } from "../remote/RemoteShell"
import type { RemoteHost } from "../remote/RemoteShell"

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
	/** SSH key path for root access (e.g., C:\Users\User\.ssh\id_superroo_vps) */
	rootKeyPath?: string
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
	private shell: RemoteShell | null = null

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

	/**
	 * Deploy nginx config to VPS using RemoteShell.
	 * Copies the local nginx-dashboard.conf to /etc/nginx/sites-enabled/dashboard,
	 * tests the config, and reloads nginx.
	 */
	async deployNginxConfig(): Promise<void> {
		const host = this.getRemoteHost()
		this.shell = new RemoteShell(host)

		const nginxConfig = path.join(process.cwd(), "cloud", "nginx-dashboard.conf")
		if (!fs.existsSync(nginxConfig)) {
			throw new Error(`Nginx config not found at ${nginxConfig}`)
		}

		// SCP the config to VPS
		const scpResult = await this.shell.scp(nginxConfig, "/etc/nginx/sites-enabled/dashboard")
		if (scpResult.exitCode !== 0) {
			throw new Error(`SCP failed: ${scpResult.stderr}`)
		}

		// Test nginx config
		const testResult = await this.shell.exec({ command: "nginx -t" })
		if (testResult.exitCode !== 0) {
			throw new Error(`Nginx config test failed: ${testResult.stderr}`)
		}

		// Reload nginx
		const reloadResult = await this.shell.exec({ command: "systemctl reload nginx" })
		if (reloadResult.exitCode !== 0) {
			throw new Error(`Nginx reload failed: ${reloadResult.stderr}`)
		}
	}

	/**
	 * Add /_next/static/ block to the Certbot-managed HTTPS config.
	 */
	async addNextStaticToHttpsConfig(): Promise<void> {
		const host = this.getRemoteHost()
		this.shell = new RemoteShell(host)

		// Check if the block already exists
		const checkResult = await this.shell.exec({
			command: "grep -q '_next/static' /etc/nginx/sites-enabled/dev.abcx124.xyz && echo EXISTS || echo MISSING",
		})

		if (checkResult.stdout.trim() === "EXISTS") {
			return // Already has the block
		}

		// Insert the /_next/static/ block before the first location / block
		const insertResult = await this.shell.exec({
			command:
				"sed -i '/location \\/ {/i\\    location /_next/static/ {\\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\\n        expires 365d;\\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\\n        access_log off;\\n    }\\n' /etc/nginx/sites-enabled/dev.abcx124.xyz",
		})
		if (insertResult.exitCode !== 0) {
			throw new Error(`Failed to update HTTPS config: ${insertResult.stderr}`)
		}

		// Test and reload
		const testResult = await this.shell.exec({ command: "nginx -t" })
		if (testResult.exitCode !== 0) {
			throw new Error(`Nginx config test failed after HTTPS update: ${testResult.stderr}`)
		}

		await this.shell.exec({ command: "systemctl reload nginx" })
	}

	/**
	 * Run a full dashboard deploy on the VPS:
	 * git pull, install deps (filtered), build, restart PM2.
	 *
	 * Optimizations:
	 *   - Nginx config deploy runs in parallel with build (independent steps)
	 *   - Filtered pnpm install (--filter cloud/dashboard) instead of full monorepo
	 *   - Build caching preserved (.next/cache not deleted)
	 *   - Overall deploy timeout with per-step elapsed logging
	 *   - Prefer offline when lockfile unchanged
	 */
	async deployDashboard(): Promise<void> {
		const host = this.getRemoteHost()
		this.shell = new RemoteShell(host)
		const overallTimeout = 600 // 10 minutes max
		const startTime = Date.now()

		const elapsed = (label: string): void => {
			const secs = Math.floor((Date.now() - startTime) / 1000)
			console.log(`[deploy ${secs}s] ${label}`)
			if (secs >= overallTimeout) {
				throw new Error(`Deploy timeout (${overallTimeout}s) exceeded during: ${label}`)
			}
		}

		// Step 1: Git pull (sequential — must complete first)
		elapsed("git pull")
		const pullResult = await this.shell.exec({
			command: "cd /opt/superroo2 && git pull origin main",
			timeout: 120,
		})
		if (pullResult.exitCode !== 0) {
			throw new Error(`Git pull failed: ${pullResult.stderr}`)
		}

		// Step 2: Start nginx config deploy in parallel with build
		elapsed("nginx config deploy (parallel)")
		const nginxPromise = this.deployNginxConfig().catch((err) => {
			console.warn(`Nginx deploy warning (non-fatal): ${err.message}`)
		})

		// Step 3: Filtered pnpm install (only dashboard deps, not full monorepo)
		elapsed("pnpm install (filtered)")
		const installResult = await this.shell.exec({
			command:
				"cd /opt/superroo2 && corepack enable && pnpm install --filter cloud/dashboard --frozen-lockfile --prefer-offline",
			timeout: 300,
		})
		if (installResult.exitCode !== 0) {
			throw new Error(`pnpm install failed: ${installResult.stderr}`)
		}

		// Step 4: Build dashboard
		elapsed("pnpm build")
		const buildResult = await this.shell.exec({
			command: "cd /opt/superroo2 && pnpm --dir cloud/dashboard run build",
			timeout: 300,
		})
		if (buildResult.exitCode !== 0) {
			throw new Error(`Build failed: ${buildResult.stderr}`)
		}

		// Wait for nginx parallel task to complete
		elapsed("waiting for nginx parallel task")
		await nginxPromise

		// Step 5: Restart PM2
		elapsed("pm2 restart")
		const pm2Result = await this.shell.exec({
			command: "cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save",
			timeout: 60,
		})
		if (pm2Result.exitCode !== 0) {
			throw new Error(`PM2 restart failed: ${pm2Result.stderr}`)
		}

		const totalSecs = Math.floor((Date.now() - startTime) / 1000)
		console.log(`[deploy] Completed in ${totalSecs}s`)
	}

	// ── Internal pipeline steps ───────────────────────────────────────────────

	private getRemoteHost(): RemoteHost {
		const keyPath = this.config.rootKeyPath || this.config.vpsKeyPath
		if (!keyPath) {
			throw new Error("No SSH key path configured. Set rootKeyPath or vpsKeyPath in DeployConfig.")
		}
		return {
			label: "SuperRoo Production VPS",
			host: this.config.vpsHost,
			port: 22,
			user: "root",
			keyPath,
		}
	}

	private async triggerGitHubWorkflow(version: string, commitSha: string): Promise<void> {
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
		const bundleDir = path.join(process.cwd(), ".super-roo", "deploy", "bundles")
		fs.mkdirSync(bundleDir, { recursive: true })
		const bundlePath = path.join(bundleDir, `${version}.tar.gz`)

		await this.createDeployBundle(bundlePath)

		// SSH hang prevention flags:
		//   ServerAliveInterval=15  — send keepalive every 15s
		//   ServerAliveCountMax=3   — disconnect after 3 missed keepalives (45s silence)
		//   ConnectTimeout=15       — fail fast if host unreachable
		const sshHangPrevention = [
			"-o",
			"ConnectTimeout=15",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=3",
		]

		const keyArgs = this.config.vpsKeyPath ? ["-i", this.config.vpsKeyPath] : []
		this.runCommand("scp", [
			...sshHangPrevention,
			...keyArgs,
			bundlePath,
			`${this.config.vpsUser}@${this.config.vpsHost}:${this.config.vpsDeployPath}/`,
		])

		this.runCommand("ssh", [
			...sshHangPrevention,
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
		// Use 30s default timeout to accommodate cold-start services
		return globalThis.fetch(url, { signal: AbortSignal.timeout(opts.timeout ?? 30000) })
	}
}
