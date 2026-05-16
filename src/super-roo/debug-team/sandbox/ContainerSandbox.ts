/**
 * ContainerSandbox — Docker-based Safe Execution Environment
 *
 * Provides a secure, isolated Docker container for 24/7 unlimited
 * iteration. All code changes are tested inside the sandbox before
 * being accepted. The sandbox:
 *   - Runs with --network none by default (no exfiltration)
 *   - Mounts the repo as a read-write volume
 *   - Has a configurable timeout (default 5 min)
 *   - Captures all stdout/stderr
 *   - Returns exit code for pass/fail determination
 *
 * Inspired by the reference swarm architecture's sandbox.ts
 * which uses: docker run --rm --network none -v repo:/workspace
 */

import { spawn } from "child_process"
import { EventEmitter } from "events"
import * as fs from "fs"
import * as path from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SandboxNetworkMode = "none" | "bridge" | "host" | "isolated"

export interface SandboxImage {
	name: string
	tag: string
	pullPolicy: "always" | "if-not-present" | "never"
}

export interface SandboxCommand {
	repoRoot: string
	command: string
	timeout: number // seconds
	environment?: Record<string, string>
	workDir?: string
}

export interface SandboxResult {
	exitCode: number
	output: string
	error: string
	durationMs: number
	timedOut: boolean
}

export interface SandboxConfig {
	image: string
	network: SandboxNetworkMode
	memoryLimit?: string // e.g., "2g"
	cpuLimit?: number // e.g., 2 = 2 CPUs
	defaultTimeout: number // seconds
	maxTimeout: number // seconds
	enableDocker: boolean
	workspaceMountPath: string
	containerUser?: string
	envVars?: Record<string, string>
}

export interface SandboxStats {
	totalRuns: number
	totalFailures: number
	totalTimeouts: number
	averageDurationMs: number
	lastRunAt: number | null
	isDockerAvailable: boolean
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ContainerSandboxEvents {
	"sandbox:started": (command: string, repoRoot: string) => void
	"sandbox:completed": (result: SandboxResult) => void
	"sandbox:failed": (error: Error) => void
	"sandbox:timeout": (command: string, timeout: number) => void
	"sandbox:output": (line: string) => void
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class ContainerSandbox {
	private config: SandboxConfig
	private emitter: EventEmitter
	private stats: SandboxStats
	private runningContainers: Set<string> = new Set()

	constructor(config?: Partial<SandboxConfig>) {
		this.config = {
			image: config?.image ?? "node:20-bookworm",
			network: config?.network ?? "none",
			memoryLimit: config?.memoryLimit ?? "2g",
			cpuLimit: config?.cpuLimit ?? 2,
			defaultTimeout: config?.defaultTimeout ?? 300, // 5 min
			maxTimeout: config?.maxTimeout ?? 3600, // 1 hour
			enableDocker: config?.enableDocker ?? true,
			workspaceMountPath: config?.workspaceMountPath ?? "/workspace",
			containerUser: config?.containerUser,
			envVars: config?.envVars,
		}
		this.emitter = new EventEmitter()

		this.stats = {
			totalRuns: 0,
			totalFailures: 0,
			totalTimeouts: 0,
			averageDurationMs: 0,
			lastRunAt: null,
			isDockerAvailable: false,
		}
	}

	// ── Event handling ──────────────────────────────────────────────────────

	on<K extends keyof ContainerSandboxEvents>(
		event: K,
		listener: ContainerSandboxEvents[K],
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	off<K extends keyof ContainerSandboxEvents>(
		event: K,
		listener: ContainerSandboxEvents[K],
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	private emit<K extends keyof ContainerSandboxEvents>(
		event: K,
		...args: Parameters<ContainerSandboxEvents[K]>
	): void {
		this.emitter.emit(event, ...(args as unknown[]))
	}

	// ── Core API ────────────────────────────────────────────────────────────

	/**
	 * Check if Docker is available on the host.
	 */
	async checkDockerAvailable(): Promise<boolean> {
		try {
			const result = await this.execHostCommand("docker info --format '{{.ServerVersion}}'")
			this.stats.isDockerAvailable = result.exitCode === 0
			return this.stats.isDockerAvailable
		} catch {
			this.stats.isDockerAvailable = false
			return false
		}
	}

	/**
	 * Run a command inside a Docker sandbox container.
	 * The repo is mounted as a volume, network is isolated by default.
	 */
	async runCommand(cmd: SandboxCommand): Promise<SandboxResult> {
		const startTime = Date.now()
		this.stats.totalRuns++
		this.stats.lastRunAt = startTime

		const timeout = Math.min(cmd.timeout, this.config.maxTimeout)
		const containerName = `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

		this.emit("sandbox:started", cmd.command, cmd.repoRoot)

		try {
			if (this.config.enableDocker && this.stats.isDockerAvailable) {
				return await this.runInDocker(cmd, containerName, timeout, startTime)
			}

			// Fallback: run locally (for development/testing without Docker)
			return await this.runLocally(cmd, timeout, startTime)
		} catch (error) {
			this.stats.totalFailures++
			const durationMs = Date.now() - startTime
			const result: SandboxResult = {
				exitCode: -1,
				output: "",
				error: error instanceof Error ? error.message : String(error),
				durationMs,
				timedOut: false,
			}
			this.emit("sandbox:failed", error instanceof Error ? error : new Error(String(error)))
			return result
		}
	}

	/**
	 * Pull a Docker image.
	 */
	async pullImage(image?: string): Promise<boolean> {
		const imageName = image ?? this.config.image
		try {
			const result = await this.execHostCommand(`docker pull ${imageName}`)
			return result.exitCode === 0
		} catch {
			return false
		}
	}

	/**
	 * Clean up stopped sandbox containers.
	 */
	async cleanup(): Promise<void> {
		for (const containerId of this.runningContainers) {
			try {
				await this.execHostCommand(`docker rm -f ${containerId} 2>/dev/null || true`)
			} catch {
				// ignore cleanup errors
			}
		}
		this.runningContainers.clear()
	}

	/**
	 * Get sandbox statistics.
	 */
	getStats(): SandboxStats {
		return { ...this.stats }
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(partial: Partial<SandboxConfig>): void {
		this.config = { ...this.config, ...partial }
	}

	// ── Private: Docker Execution ───────────────────────────────────────────

	private async runInDocker(
		cmd: SandboxCommand,
		containerName: string,
		timeout: number,
		startTime: number,
	): Promise<SandboxResult> {
		// Resolve absolute path for repo root
		const absRepoRoot = path.resolve(cmd.repoRoot)

		// Build docker run arguments
		const args = [
			"run",
			"--rm",
			"--name", containerName,
			"--network", this.config.network,
			"-v", `${absRepoRoot}:${this.config.workspaceMountPath}`,
			"-w", cmd.workDir
				? `${this.config.workspaceMountPath}/${cmd.workDir}`
				: this.config.workspaceMountPath,
		]

		// Memory limit
		if (this.config.memoryLimit) {
			args.push("--memory", this.config.memoryLimit)
		}

		// CPU limit
		if (this.config.cpuLimit) {
			args.push("--cpus", String(this.config.cpuLimit))
		}

		// Container user
		if (this.config.containerUser) {
			args.push("--user", this.config.containerUser)
		}

		// Environment variables
		if (this.config.envVars) {
			for (const [key, value] of Object.entries(this.config.envVars)) {
				args.push("-e", `${key}=${value}`)
			}
		}
		if (cmd.environment) {
			for (const [key, value] of Object.entries(cmd.environment)) {
				args.push("-e", `${key}=${value}`)
			}
		}

		// Read-only root filesystem for safety
		args.push("--read-only")

		// Image and command
		args.push(this.config.image)
		args.push("sh", "-c", cmd.command)

		this.runningContainers.add(containerName)

		return new Promise<SandboxResult>((resolve) => {
			const proc = spawn("docker", args, {
				timeout: timeout * 1000,
				stdio: ["ignore", "pipe", "pipe"],
			})

			let output = ""
			let error = ""
			let timedOut = false

			const timeoutHandle = setTimeout(() => {
				timedOut = true
				this.stats.totalTimeouts++
				this.emit("sandbox:timeout", cmd.command, timeout)
				proc.kill("SIGKILL")
			}, timeout * 1000)

			proc.stdout?.on("data", (data: Buffer) => {
				const text = data.toString()
				output += text
				this.emit("sandbox:output", text)
			})

			proc.stderr?.on("data", (data: Buffer) => {
				const text = data.toString()
				error += text
			})

			proc.on("close", (exitCode) => {
				clearTimeout(timeoutHandle)
				this.runningContainers.delete(containerName)

				const durationMs = Date.now() - startTime
				this.updateAverageDuration(durationMs)

				if (exitCode !== 0) {
					this.stats.totalFailures++
				}

				const result: SandboxResult = {
					exitCode: exitCode ?? -1,
					output: output.trim(),
					error: error.trim(),
					durationMs,
					timedOut,
				}

				this.emit("sandbox:completed", result)
				resolve(result)
			})

			proc.on("error", (err) => {
				clearTimeout(timeoutHandle)
				this.runningContainers.delete(containerName)
				this.stats.totalFailures++

				const result: SandboxResult = {
					exitCode: -1,
					output: output.trim(),
					error: err.message,
					durationMs: Date.now() - startTime,
					timedOut,
				}

				this.emit("sandbox:failed", err)
				resolve(result)
			})
		})
	}

	// ── Private: Local Execution (Fallback) ─────────────────────────────────

	private async runLocally(
		cmd: SandboxCommand,
		timeout: number,
		startTime: number,
	): Promise<SandboxResult> {
		return new Promise<SandboxResult>((resolve) => {
			const proc = spawn("sh", ["-c", cmd.command], {
				cwd: cmd.repoRoot,
				timeout: timeout * 1000,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					...cmd.environment,
				},
			})

			let output = ""
			let error = ""
			let timedOut = false

			const timeoutHandle = setTimeout(() => {
				timedOut = true
				this.stats.totalTimeouts++
				this.emit("sandbox:timeout", cmd.command, timeout)
				proc.kill("SIGKILL")
			}, timeout * 1000)

			proc.stdout?.on("data", (data: Buffer) => {
				const text = data.toString()
				output += text
				this.emit("sandbox:output", text)
			})

			proc.stderr?.on("data", (data: Buffer) => {
				error += data.toString()
			})

			proc.on("close", (exitCode) => {
				clearTimeout(timeoutHandle)
				const durationMs = Date.now() - startTime
				this.updateAverageDuration(durationMs)

				if (exitCode !== 0) {
					this.stats.totalFailures++
				}

				const result: SandboxResult = {
					exitCode: exitCode ?? -1,
					output: output.trim(),
					error: error.trim(),
					durationMs,
					timedOut,
				}

				this.emit("sandbox:completed", result)
				resolve(result)
			})

			proc.on("error", (err) => {
				clearTimeout(timeoutHandle)
				this.stats.totalFailures++

				const result: SandboxResult = {
					exitCode: -1,
					output: output.trim(),
					error: err.message,
					durationMs: Date.now() - startTime,
					timedOut,
				}

				this.emit("sandbox:failed", err)
				resolve(result)
			})
		})
	}

	// ── Private: Host Command ───────────────────────────────────────────────

	private execHostCommand(command: string): Promise<SandboxResult> {
		return new Promise((resolve, reject) => {
			const proc = spawn("sh", ["-c", command], {
				stdio: ["ignore", "pipe", "pipe"],
			})

			let output = ""
			let error = ""

			proc.stdout?.on("data", (data: Buffer) => {
				output += data.toString()
			})

			proc.stderr?.on("data", (data: Buffer) => {
				error += data.toString()
			})

			proc.on("close", (exitCode) => {
				resolve({
					exitCode: exitCode ?? -1,
					output: output.trim(),
					error: error.trim(),
					durationMs: 0,
					timedOut: false,
				})
			})

			proc.on("error", reject)
		})
	}

	// ── Private: Helpers ────────────────────────────────────────────────────

	private updateAverageDuration(durationMs: number): void {
		const prevTotal = this.stats.averageDurationMs * (this.stats.totalRuns - 1)
		this.stats.averageDurationMs = (prevTotal + durationMs) / this.stats.totalRuns
	}
}
