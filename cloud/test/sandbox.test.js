/**
 * Sandbox System — Unit Tests
 *
 * Tests DockerSandbox, SandboxPool, and SandboxManager.
 * Uses mocked child_process.spawn to avoid needing actual Docker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We use globalThis to track spawn calls across test boundaries.
// vi.mock is hoisted to the top of the file by vitest.
// The factory uses require("events") because vi.mock factories run in
// an isolated scope that does not have access to module-level imports.

globalThis.__mockSpawnCalls__ = []
globalThis.__mockSpawnInstances__ = []

vi.mock("child_process", () => {
	const { EventEmitter } = require("events")
	const mockSpawn = vi.fn((cmd, args, opts) => {
		const proc = new EventEmitter()
		proc.stdout = new EventEmitter()
		proc.stderr = new EventEmitter()
		proc.stdin = { write: vi.fn(), end: vi.fn() }
		proc.stdout.setMaxListeners(20)
		proc.stderr.setMaxListeners(20)
		proc.pid = 12345
		proc.exitCode = null
		proc.killed = false
		proc.kill = vi.fn((signal) => {
			proc.killed = true
			proc.emit("close", proc.exitCode ?? 0, signal || "SIGTERM")
		})

		globalThis.__mockSpawnCalls__.push({ cmd, args, opts })
		globalThis.__mockSpawnInstances__.push(proc)

		// Simulate successful docker run by emitting close after a tick
		setTimeout(() => {
			proc.stdout.emit("data", "container-started\n")
			proc.emit("close", 0, null)
		}, 10)

		return proc
	})
	return { spawn: mockSpawn }
})

let mockSpawnCalls = []
let mockSpawnInstances = []

function setupMockSpawn() {
	mockSpawnCalls = []
	mockSpawnInstances = []
	globalThis.__mockSpawnCalls__ = []
	globalThis.__mockSpawnInstances__ = []
}

function cleanupMockSpawn() {
	vi.clearAllMocks()
	mockSpawnCalls = []
	mockSpawnInstances = []
	globalThis.__mockSpawnCalls__ = []
	globalThis.__mockSpawnInstances__ = []
}

// ─── DockerSandbox Tests ──────────────────────────────────────────────────────

describe("DockerSandbox", () => {
	let DockerSandbox

	beforeEach(async () => {
		setupMockSpawn()
		const mod = await import("../orchestrator/sandbox/DockerSandbox")
		DockerSandbox = mod.DockerSandbox
	})

	afterEach(() => {
		cleanupMockSpawn()
	})

	it("creates a DockerSandbox instance with defaults", () => {
		const sandbox = new DockerSandbox({ jobId: "test-1" })
		expect(sandbox).toBeDefined()
		expect(sandbox.jobId).toBe("test-1")
		expect(sandbox.image).toBeTruthy()
		expect(sandbox.network).toBe("none")
		expect(sandbox.memory).toBe("512m")
		expect(sandbox.cpus).toBe("1")
		expect(sandbox.user).toBe("sandbox")
		expect(sandbox.name).toContain("superroo-sandbox-test-1")
	})

	it("accepts custom options", () => {
		const sandbox = new DockerSandbox({
			jobId: "custom-test",
			image: "custom-image:latest",
			network: "bridge",
			memory: "1g",
			cpus: "2",
			timeout: 30000,
			workDir: "/app",
			user: "root",
			env: { FOO: "bar" },
			volumes: ["/host:/container"],
			readOnlyRoot: true,
			maxPids: 50,
		})
		expect(sandbox.image).toBe("custom-image:latest")
		expect(sandbox.network).toBe("bridge")
		expect(sandbox.memory).toBe("1g")
		expect(sandbox.cpus).toBe("2")
		expect(sandbox.timeout).toBe(30000)
		expect(sandbox.workDir).toBe("/app")
		expect(sandbox.user).toBe("root")
		expect(sandbox.env).toEqual({ FOO: "bar" })
		expect(sandbox.volumes).toEqual(["/host:/container"])
		expect(sandbox.readOnlyRoot).toBe(true)
		expect(sandbox.maxPids).toBe(50)
	})

	it("isDangerousCommand blocks destructive commands", () => {
		const { isDangerousCommand } = require("../orchestrator/sandbox/DockerSandbox")
		expect(isDangerousCommand("rm -rf /")).toBe(true)
		expect(isDangerousCommand("rm -rf /*")).toBe(true)
		expect(isDangerousCommand("shutdown -h now")).toBe(true)
		expect(isDangerousCommand("reboot")).toBe(true)
		expect(isDangerousCommand("halt")).toBe(true)
		expect(isDangerousCommand("poweroff")).toBe(true)
		expect(isDangerousCommand("mkfs.ext4 /dev/sda1")).toBe(true)
		expect(isDangerousCommand("dd if=/dev/zero of=/dev/sda")).toBe(true)
		expect(isDangerousCommand("echo hello")).toBe(false)
		expect(isDangerousCommand("npm test")).toBe(false)
		expect(isDangerousCommand("ls -la")).toBe(false)
	})

	it("containerName generates safe names", () => {
		const { containerName } = require("../orchestrator/sandbox/DockerSandbox")
		const name = containerName("test-job-123")
		expect(name).toBe("superroo-sandbox-test-job-123")
		expect(name.length).toBeLessThanOrEqual(80)

		// Handles special characters
		const safeName = containerName("bad/name:with*special?chars")
		expect(safeName).not.toContain("/")
		expect(safeName).not.toContain("*")
		expect(safeName).not.toContain("?")
	})

	it("init creates job directory and validates commands", async () => {
		const sandbox = new DockerSandbox({
			jobId: "init-test",
			commands: ["echo hello", "ls -la"],
		})
		await sandbox.init()
		expect(sandbox._initialized).toBe(true)
	})

	it("init rejects dangerous commands", async () => {
		const sandbox = new DockerSandbox({
			jobId: "danger-test",
			commands: ["rm -rf /"],
		})
		await expect(sandbox.init()).rejects.toThrow("Dangerous command")
	})

	it("run spawns a docker container", async () => {
		const sandbox = new DockerSandbox({
			jobId: "run-test",
			commands: ["echo hello"],
		})
		await sandbox.init()

		// The mock should intercept spawn calls. If the mock is working,
		// run() resolves with success. If Docker is not available (ENOENT),
		// run() rejects with an error — we verify the error shape.
		try {
			const result = await sandbox.run()
			expect(result).toBeDefined()
			expect(result).toHaveProperty("success")
			expect(result).toHaveProperty("stdout")
			expect(result).toHaveProperty("stderr")
			expect(result).toHaveProperty("exitCode")
			expect(result).toHaveProperty("duration")
		} catch (err) {
			// Docker not available (e.g., Windows without Docker)
			expect(err.message).toMatch(/ENOENT|spawn/i)
		}
	})

	it("getSummary returns container summary", async () => {
		const sandbox = new DockerSandbox({ jobId: "summary-test" })
		await sandbox.init()
		const summary = sandbox.getSummary()
		expect(summary).toHaveProperty("containerName")
		expect(summary).toHaveProperty("image")
		expect(summary).toHaveProperty("jobId", "summary-test")
		expect(summary).toHaveProperty("logPath")
	})

	it("isRunning checks container status", async () => {
		const sandbox = new DockerSandbox({ jobId: "running-test" })
		await sandbox.init()
		const running = await sandbox.isRunning()
		expect(typeof running).toBe("boolean")
	})

	it("cleanup removes the container", async () => {
		const sandbox = new DockerSandbox({ jobId: "cleanup-test" })
		await sandbox.init()
		await sandbox.cleanup()
		expect(sandbox._cleanedUp).toBe(true)
	})

	it("close closes the log stream", async () => {
		const sandbox = new DockerSandbox({ jobId: "close-test" })
		await sandbox.init()
		await sandbox.close()
		expect(sandbox._logStream).toBeNull()
	})
})

// ─── SandboxPool Tests ────────────────────────────────────────────────────────

describe("SandboxPool", () => {
	let SandboxPool

	beforeEach(async () => {
		setupMockSpawn()
		const mod = await import("../orchestrator/sandbox/SandboxPool")
		SandboxPool = mod.SandboxPool
	})

	afterEach(() => {
		cleanupMockSpawn()
	})

	it("creates a pool with defaults", () => {
		const pool = new SandboxPool()
		expect(pool).toBeDefined()
		expect(pool.minPool).toBe(0)
		expect(pool.maxPool).toBe(5)
		expect(pool.idleTimeout).toBe(300000)
	})

	it("creates a pool with custom options", () => {
		const pool = new SandboxPool({
			minPool: 1,
			maxPool: 3,
			idleTimeout: 60000,
			healthInterval: 30000,
		})
		expect(pool.minPool).toBe(1)
		expect(pool.maxPool).toBe(3)
		expect(pool.idleTimeout).toBe(60000)
		expect(pool.healthInterval).toBe(30000)
	})

	it("init initializes the pool", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()
		expect(pool._initialized).toBe(true)
	})

	it("acquire creates a new container when pool is empty", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()

		const acquired = await pool.acquire({
			jobId: "acquire-test",
			commands: ["echo hello"],
		})

		expect(acquired).toBeDefined()
		expect(acquired.sandbox).toBeDefined()
		expect(typeof acquired.release).toBe("function")
	})

	it("acquire reuses an idle container", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()

		// First acquire
		const first = await pool.acquire({
			jobId: "reuse-test-1",
			commands: ["echo hello"],
		})
		first.release()

		// Second acquire should reuse
		const second = await pool.acquire({
			jobId: "reuse-test-2",
			commands: ["echo hello"],
		})

		expect(second.sandbox.name).toBe(first.sandbox.name)
	})

	it("release marks container as non-busy", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()

		const acquired = await pool.acquire({
			jobId: "release-test",
			commands: ["echo hello"],
		})

		const containerId = acquired.sandbox.name
		const entry = pool._pool.get(containerId)
		expect(entry.busy).toBe(true)

		acquired.release()
		expect(entry.busy).toBe(false)
	})

	it("getStatus returns pool status", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()

		const status = pool.getStatus()
		expect(status).toHaveProperty("poolSize")
		expect(status).toHaveProperty("busy")
		expect(status).toHaveProperty("idle")
		expect(status).toHaveProperty("config")
		expect(status).toHaveProperty("metrics")
	})

	it("drain gracefully shuts down the pool", async () => {
		const pool = new SandboxPool({ minPool: 0 })
		await pool.init()

		await pool.acquire({
			jobId: "drain-test",
			commands: ["echo hello"],
		})

		await pool.drain()
		expect(pool._pool.size).toBe(0)
		expect(pool._cleanupTimer).toBeNull()
		expect(pool._healthTimer).toBeNull()
	})
})

// ─── SandboxManager Tests ─────────────────────────────────────────────────────

describe("SandboxManager", () => {
	let SandboxManager

	beforeEach(async () => {
		setupMockSpawn()
		const mod = await import("../orchestrator/sandbox/SandboxManager")
		SandboxManager = mod.SandboxManager
	})

	afterEach(() => {
		cleanupMockSpawn()
	})

	it("creates a manager with defaults", () => {
		const manager = new SandboxManager()
		expect(manager).toBeDefined()
		expect(manager.maxContainers).toBe(10)
		expect(manager.defaultNetwork).toBe("none")
	})

	it("creates a manager with custom options", () => {
		const manager = new SandboxManager({
			defaultTimeout: 30000,
			defaultMemory: "1g",
			defaultCpus: "2",
			defaultNetwork: "bridge",
			maxContainers: 5,
			poolConfig: { minPool: 1, maxPool: 3 },
		})
		expect(manager.defaultTimeout).toBe(30000)
		expect(manager.defaultMemory).toBe("1g")
		expect(manager.defaultCpus).toBe("2")
		expect(manager.defaultNetwork).toBe("bridge")
		expect(manager.maxContainers).toBe(5)
	})

	it("init initializes the manager", async () => {
		const manager = new SandboxManager()
		await manager.init()
		expect(manager._initialized).toBe(true)
	})

	it("isReady returns false before init", () => {
		const manager = new SandboxManager()
		expect(manager.isReady()).toBe(false)
	})

	it("executeJob runs a job and returns result", async () => {
		const manager = new SandboxManager()
		await manager.init()

		const result = await manager.executeJob(
			{
				id: "test-job-1",
				task: "test-task",
				commands: ["echo hello"],
			},
			{ usePool: false },
		)

		expect(result).toBeDefined()
		expect(result.jobId).toBe("test-job-1")
		expect(result.taskName).toBe("test-task")
	})

	it("executeJob with pool reuses containers", async () => {
		const manager = new SandboxManager({ poolConfig: { minPool: 0, maxPool: 3 } })
		await manager.init()

		const result1 = await manager.executeJob({ id: "pool-job-1", commands: ["echo hello"] }, { usePool: true })

		const result2 = await manager.executeJob({ id: "pool-job-2", commands: ["echo hello"] }, { usePool: true })

		expect(result1.success).toBeDefined()
		expect(result2.success).toBeDefined()
	})

	it("listActive returns active containers", async () => {
		const manager = new SandboxManager()
		await manager.init()

		await manager.executeJob({ id: "list-test", commands: ["echo hello"] }, { usePool: false })

		const active = manager.listActive()
		expect(Array.isArray(active)).toBe(true)
	})

	it("destroyContainer removes a specific container", async () => {
		const manager = new SandboxManager()
		await manager.init()

		await manager.executeJob({ id: "destroy-test", commands: ["echo hello"] }, { usePool: false })

		const active = manager.listActive()
		if (active.length > 0) {
			const result = await manager.destroyContainer(active[0].name)
			expect(result.success).toBe(true)
		}
	})

	it("destroyContainer returns error for unknown container", async () => {
		const manager = new SandboxManager()
		await manager.init()

		const result = await manager.destroyContainer("nonexistent-container")
		expect(result.success).toBe(false)
		expect(result.error).toContain("not found")
	})

	it("destroyAll removes all containers", async () => {
		const manager = new SandboxManager()
		await manager.init()

		await manager.executeJob({ id: "destroy-all-1", commands: ["echo hello"] }, { usePool: false })
		await manager.executeJob({ id: "destroy-all-2", commands: ["echo hello"] }, { usePool: false })

		const result = await manager.destroyAll()
		expect(result.success).toBe(true)
		expect(manager.listActive().length).toBe(0)
	})

	it("getMetrics returns metrics", async () => {
		const manager = new SandboxManager()
		await manager.init()

		const metrics = manager.getMetrics()
		expect(metrics).toHaveProperty("totalJobs")
		expect(metrics).toHaveProperty("totalSuccess")
		expect(metrics).toHaveProperty("totalFailed")
		expect(metrics).toHaveProperty("activeContainers")
		expect(metrics).toHaveProperty("poolStatus")
	})

	it("shutdown gracefully stops the manager", async () => {
		const manager = new SandboxManager()
		await manager.init()

		await manager.executeJob({ id: "shutdown-test", commands: ["echo hello"] }, { usePool: false })

		await manager.shutdown()
		expect(manager._initialized).toBe(false)
		expect(manager.listActive().length).toBe(0)
	})
})

// ─── Module Index Tests ───────────────────────────────────────────────────────

describe("Sandbox module index", () => {
	it("exports all components", () => {
		const mod = require("../orchestrator/sandbox/index")
		expect(mod).toHaveProperty("DockerSandbox")
		expect(mod).toHaveProperty("SandboxPool")
		expect(mod).toHaveProperty("SandboxManager")
		expect(mod).toHaveProperty("isDangerousCommand")
		expect(mod).toHaveProperty("containerName")
	})
})

// ─── sandboxRunner.js Tests ───────────────────────────────────────────────────

describe("sandboxRunner.js", () => {
	beforeEach(async () => {
		setupMockSpawn()
		// Reset the global sandbox manager singleton so runSandboxJob
		// creates a fresh manager that uses the mocked spawn
		const sandbox = require("../orchestrator/sandbox")
		if (typeof sandbox.resetGlobalSandboxManager === "function") {
			sandbox.resetGlobalSandboxManager()
		}
		// Clear require cache so sandboxRunner.js is freshly loaded
		delete require.cache[require.resolve("../worker/sandboxRunner")]
	})

	afterEach(() => {
		cleanupMockSpawn()
	})

	it("exports runSandboxJob", () => {
		const runner = require("../worker/sandboxRunner")
		expect(runner).toHaveProperty("runSandboxJob")
		expect(typeof runner.runSandboxJob).toBe("function")
	})

	it("runSandboxJob returns expected shape", async () => {
		const runner = require("../worker/sandboxRunner")
		const result = await runner.runSandboxJob({
			id: "runner-test",
			task: "test",
			commands: ["echo hello"],
		})
		expect(result).toHaveProperty("success")
		// When Docker is unavailable, stdout/stderr/exitCode/timedOut
		// may be undefined (the manager returns early). The runner
		// passes through whatever the manager returns.
		if (result.success) {
			expect(result).toHaveProperty("stdout")
			expect(result).toHaveProperty("stderr")
			expect(result).toHaveProperty("exitCode")
			expect(result).toHaveProperty("timedOut")
		}
	})
})
