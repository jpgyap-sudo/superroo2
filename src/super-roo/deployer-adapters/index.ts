/**
 * Super Roo — Deployer Adapters (F10)
 *
 * Inspired by Mastra's 4 deployer adapters.
 * Provides deployer adapter interface with implementations for
 * Cloudflare Workers, Netlify Functions, and Vercel.
 * SuperRoo2's primary deployer is VPS via SSH; these adapters
 * enable serverless/edge deployments for frontend apps and API endpoints.
 */

import { execSync } from "child_process"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type DeployerType = "cloudflare" | "netlify" | "vercel" | "vps" | "custom"

export interface DeployerConfig {
	type: DeployerType
	name: string
	apiToken?: string
	projectId?: string
	teamId?: string
	rootDir?: string
	buildCommand?: string
	outputDir?: string
	environmentVariables?: Record<string, string>
}

export interface DeployResult {
	success: boolean
	url?: string
	deployId?: string
	environment?: string
	buildLogs?: string[]
	durationMs: number
	error?: string
}

export interface BuildResult {
	success: boolean
	outputDir?: string
	buildLogs?: string[]
	durationMs: number
	error?: string
}

export interface DeployerAdapter {
	readonly type: DeployerType
	readonly name: string

	initialize(config: DeployerConfig): Promise<void>
	build(config: DeployerConfig): Promise<BuildResult>
	deploy(config: DeployerConfig, buildResult: BuildResult): Promise<DeployResult>
	getDeployUrl(deployId: string): Promise<string | null>
	listDeployments(maxResults?: number): Promise<{ id: string; url: string; createdAt: number; status: string }[]>
}

// ──────────────────────────────────────────────────────────────────────────────
// Vercel Adapter
// ──────────────────────────────────────────────────────────────────────────────

export class VercelAdapter implements DeployerAdapter {
	readonly type: DeployerType = "vercel"
	readonly name = "Vercel"
	private apiToken = ""

	async initialize(config: DeployerConfig): Promise<void> {
		this.apiToken = config.apiToken || process.env.VERCEL_API_TOKEN || ""
		if (!this.apiToken) {
			console.warn("[VercelAdapter] No API token set. Set VERCEL_API_TOKEN env var or pass apiToken in config.")
		}
	}

	async build(config: DeployerConfig): Promise<BuildResult> {
		const start = Date.now()
		const buildLogs: string[] = []
		try {
			const cmd = config.buildCommand || "npm run build"
			buildLogs.push(`Running: ${cmd}`)
			const output = execSync(cmd, {
				cwd: config.rootDir || process.cwd(),
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			})
			buildLogs.push(output)
			return {
				success: true,
				outputDir: config.outputDir || ".next",
				buildLogs,
				durationMs: Date.now() - start,
			}
		} catch (err) {
			buildLogs.push(err instanceof Error ? err.message : String(err))
			return {
				success: false,
				buildLogs,
				durationMs: Date.now() - start,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	async deploy(config: DeployerConfig, buildResult: BuildResult): Promise<DeployResult> {
		const start = Date.now()
		try {
			if (!buildResult.success) {
				return { success: false, error: "Build failed, cannot deploy", durationMs: Date.now() - start }
			}
			// In production: use `npx vercel --token <token> --prod`
			const cmd = `npx vercel --token ${this.apiToken} --prod --yes`
			const output = execSync(cmd, {
				cwd: config.rootDir || process.cwd(),
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			})
			// Parse Vercel output for deploy URL
			const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/)
			return {
				success: true,
				url: urlMatch ? urlMatch[0] : undefined,
				deployId: `vercel-${Date.now()}`,
				environment: "production",
				durationMs: Date.now() - start,
			}
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			}
		}
	}

	async getDeployUrl(deployId: string): Promise<string | null> {
		return `https://${deployId}.vercel.app`
	}

	async listDeployments(maxResults = 10): Promise<{ id: string; url: string; createdAt: number; status: string }[]> {
		return []
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Cloudflare Workers Adapter
// ──────────────────────────────────────────────────────────────────────────────

export class CloudflareAdapter implements DeployerAdapter {
	readonly type: DeployerType = "cloudflare"
	readonly name = "Cloudflare Workers"
	private apiToken = ""
	private accountId = ""

	async initialize(config: DeployerConfig): Promise<void> {
		this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN || ""
		this.accountId = config.teamId || process.env.CLOUDFLARE_ACCOUNT_ID || ""
	}

	async build(config: DeployerConfig): Promise<BuildResult> {
		const start = Date.now()
		try {
			const cmd = config.buildCommand || "npm run build"
			execSync(cmd, { cwd: config.rootDir || process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
			return { success: true, outputDir: config.outputDir || "dist", durationMs: Date.now() - start }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			}
		}
	}

	async deploy(config: DeployerConfig, buildResult: BuildResult): Promise<DeployResult> {
		const start = Date.now()
		try {
			if (!buildResult.success) {
				return { success: false, error: "Build failed, cannot deploy", durationMs: Date.now() - start }
			}
			// Use wrangler CLI for Cloudflare Workers deployment
			const cmd = `npx wrangler deploy --name ${config.projectId || "superroo-worker"}`
			const output = execSync(cmd, {
				cwd: config.rootDir || process.cwd(),
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			})
			// Parse wrangler output for deploy URL
			const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/)
			return {
				success: true,
				url: urlMatch ? urlMatch[0] : undefined,
				deployId: `cf-${Date.now()}`,
				environment: "production",
				durationMs: Date.now() - start,
			}
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			}
		}
	}

	async getDeployUrl(deployId: string): Promise<string | null> {
		if (!this.accountId) return null
		try {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/deployments/by-script/${deployId}`,
				{ headers: { Authorization: `Bearer ${this.apiToken}` } },
			)
			if (!res.ok) return null
			const data = await res.json()
			return data?.result?.url || null
		} catch {
			return null
		}
	}

	async listDeployments(maxResults = 10): Promise<{ id: string; url: string; createdAt: number; status: string }[]> {
		if (!this.accountId) return []
		try {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/deployments?per_page=${maxResults}`,
				{ headers: { Authorization: `Bearer ${this.apiToken}` } },
			)
			if (!res.ok) return []
			const data = await res.json()
			return (data?.result || []).map((d: any) => ({
				id: d.id,
				url: d.url || "",
				createdAt: new Date(d.created_on).getTime(),
				status: d.status || "unknown",
			}))
		} catch {
			return []
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Netlify Adapter
// ──────────────────────────────────────────────────────────────────────────────

export class NetlifyAdapter implements DeployerAdapter {
	readonly type: DeployerType = "netlify"
	readonly name = "Netlify"
	private apiToken = ""
	private siteId = ""

	async initialize(config: DeployerConfig): Promise<void> {
		this.apiToken = config.apiToken || process.env.NETLIFY_API_TOKEN || ""
		this.siteId = config.projectId || process.env.NETLIFY_SITE_ID || ""
	}

	async build(config: DeployerConfig): Promise<BuildResult> {
		const start = Date.now()
		const buildLogs: string[] = []
		try {
			const cmd = config.buildCommand || "npm run build"
			buildLogs.push(`Running: ${cmd}`)
			const output = execSync(cmd, {
				cwd: config.rootDir || process.cwd(),
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			})
			buildLogs.push(output)
			return {
				success: true,
				outputDir: config.outputDir || "dist",
				buildLogs,
				durationMs: Date.now() - start,
			}
		} catch (err) {
			buildLogs.push(err instanceof Error ? err.message : String(err))
			return {
				success: false,
				buildLogs,
				durationMs: Date.now() - start,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	async deploy(config: DeployerConfig, buildResult: BuildResult): Promise<DeployResult> {
		const start = Date.now()
		try {
			if (!buildResult.success) {
				return { success: false, error: "Build failed, cannot deploy", durationMs: Date.now() - start }
			}
			// Use Netlify CLI for deployment
			const deployDir = buildResult.outputDir || config.outputDir || "dist"
			const cmd = `npx netlify deploy --dir ${deployDir} --site ${this.siteId} --prod --message "Deploy from SuperRoo"`
			const output = execSync(cmd, {
				cwd: config.rootDir || process.cwd(),
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			})
			// Parse Netlify output for deploy URL
			const urlMatch = output.match(/https:\/\/[^\s]+\.netlify\.app/)
			return {
				success: true,
				url: urlMatch ? urlMatch[0] : undefined,
				deployId: `netlify-${Date.now()}`,
				environment: "production",
				durationMs: Date.now() - start,
			}
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			}
		}
	}

	async getDeployUrl(deployId: string): Promise<string | null> {
		if (!this.apiToken || !this.siteId) return null
		try {
			const res = await fetch(`https://api.netlify.com/api/v1/sites/${this.siteId}/deploys/${deployId}`, {
				headers: { Authorization: `Bearer ${this.apiToken}` },
			})
			if (!res.ok) return null
			const data = await res.json()
			return data?.ssl_url || data?.url || null
		} catch {
			return null
		}
	}

	async listDeployments(maxResults = 10): Promise<{ id: string; url: string; createdAt: number; status: string }[]> {
		if (!this.apiToken || !this.siteId) return []
		try {
			const res = await fetch(
				`https://api.netlify.com/api/v1/sites/${this.siteId}/deploys?per_page=${maxResults}`,
				{ headers: { Authorization: `Bearer ${this.apiToken}` } },
			)
			if (!res.ok) return []
			const data = await res.json()
			return (data || []).map((d: any) => ({
				id: d.id,
				url: d.ssl_url || d.url || "",
				createdAt: new Date(d.created_at).getTime(),
				status: d.state || "unknown",
			}))
		} catch {
			return []
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────────────────────

export function createDeployerAdapter(type: DeployerType, config: DeployerConfig): DeployerAdapter {
	switch (type) {
		case "vercel":
			return new VercelAdapter()
		case "cloudflare":
			return new CloudflareAdapter()
		case "netlify":
			return new NetlifyAdapter()
		default:
			throw new Error(`Unsupported deployer type: ${type}`)
	}
}
