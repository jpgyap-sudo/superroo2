/**
 * Task Queue Atomic Claim Tests
 *
 * Verifies that claimNext() atomically claims tasks without race conditions.
 * Tests concurrent claim scenarios using synchronous better-sqlite3 operations.
 *
 * Run: cd cloud && npx vitest run test/task-queue-atomic.test.js
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"

// We require these dynamically to avoid vitest hoisting issues
const Database = require("better-sqlite3")

describe("TaskQueueBullMQ — Atomic Claim", () => {
	let dbPath
	let db
	let TaskQueueBullMQ

	beforeEach(async () => {
		// Create a temporary SQLite database
		dbPath = path.join(os.tmpdir(), `test-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)

		// Create a minimal schema matching the orchestrator's tasks table
		db = new Database(dbPath)
		db.exec(`
			CREATE TABLE IF NOT EXISTS tasks (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				priority INTEGER NOT NULL DEFAULT 5,
				input TEXT NOT NULL,
				output TEXT,
				error TEXT,
				agent TEXT,
				session_id TEXT,
				parent_task_id TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER,
				metadata TEXT DEFAULT '{}',
				worker_id TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
			CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
			CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
		`)

		// Load TaskQueueBullMQ module
		TaskQueueBullMQ = require("../orchestrator/modules/TaskQueueBullMQ")
	})

	afterEach(() => {
		if (db) {
			db.close()
		}
		try {
			fs.unlinkSync(dbPath)
		} catch {
			// ignore
		}
	})

	/**
	 * Create a minimal MemoryStore-like object that wraps our test DB.
	 */
	function createMemoryStore(testDb) {
		return {
			getDb() {
				return testDb
			},
		}
	}

	/**
	 * Helper: insert a pending task directly into the test DB.
	 */
	function insertTask(overrides = {}) {
		const id = overrides.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		const now = Date.now()
		db.prepare(
			`
			INSERT INTO tasks (id, type, status, priority, input, created_at, updated_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`,
		).run(
			id,
			overrides.type || "coding",
			overrides.status || "pending",
			overrides.priority ?? 5,
			JSON.stringify(overrides.input || { instruction: "test" }),
			overrides.created_at || now,
			now,
			"{}",
		)
		return id
	}

	it("should claim a pending task atomically", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "coding", priority: 1 })

		const task = queue.claimNext("worker-1")
		expect(task).not.toBeNull()
		expect(task.status).toBe("running")
		expect(task.workerId).toBe("worker-1")
		expect(task.startedAt).toBeGreaterThan(0)
	})

	it("should return null when no pending tasks exist", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		const task = queue.claimNext("worker-1")
		expect(task).toBeNull()
	})

	it("should not claim already-running tasks", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "coding", status: "running" })

		const task = queue.claimNext("worker-1")
		expect(task).toBeNull()
	})

	it("should not claim a task already claimed by another worker", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "coding", priority: 1 })

		// First claim succeeds
		const task1 = queue.claimNext("worker-1")
		expect(task1).not.toBeNull()
		expect(task1.workerId).toBe("worker-1")

		// Second claim returns null (task already claimed)
		const task2 = queue.claimNext("worker-2")
		expect(task2).toBeNull()
	})

	it("should claim highest priority task first", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "coding", priority: 5, id: "low-pri" })
		insertTask({ type: "coding", priority: 1, id: "high-pri" })

		const task = queue.claimNext("worker-1")
		expect(task).not.toBeNull()
		expect(task.id).toBe("high-pri")
	})

	it("should claim oldest task when priorities are equal", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		const now = Date.now()
		insertTask({ type: "coding", priority: 5, id: "old-task", created_at: now - 10000 })
		insertTask({ type: "coding", priority: 5, id: "new-task", created_at: now })

		const task = queue.claimNext("worker-1")
		expect(task).not.toBeNull()
		expect(task.id).toBe("old-task")
	})

	it("should filter by type when typeFilter is provided", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "deploy", priority: 1, id: "deploy-task" })
		insertTask({ type: "coding", priority: 2, id: "coding-task" })

		// Claim only coding tasks
		const task = queue.claimNext("worker-1", ["coding"])
		expect(task).not.toBeNull()
		expect(task.id).toBe("coding-task")
		expect(task.type).toBe("coding")
	})

	it("should return null when typeFilter excludes all pending tasks", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "deploy", priority: 1 })

		const task = queue.claimNext("worker-1", ["coding"])
		expect(task).toBeNull()
	})

	it("should handle multiple type filters", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "debug", priority: 1, id: "debug-task" })
		insertTask({ type: "coding", priority: 2, id: "coding-task" })

		// Claim coding OR debug tasks
		const task = queue.claimNext("worker-1", ["coding", "debug"])
		expect(task).not.toBeNull()
		// Should get debug (higher priority = lower number)
		expect(task.id).toBe("debug-task")
	})

	it("should simulate concurrent claims without collision", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))

		// Insert 5 tasks
		for (let i = 0; i < 5; i++) {
			insertTask({ type: "coding", priority: i + 1, id: `task-${i}` })
		}

		// Simulate 3 workers claiming concurrently (synchronously, since better-sqlite3 is sync)
		const workers = ["worker-a", "worker-b", "worker-c"]
		const claimed = new Set()

		for (const worker of workers) {
			const task = queue.claimNext(worker)
			if (task) {
				// Verify no duplicate claim
				expect(claimed.has(task.id)).toBe(false)
				claimed.add(task.id)
				expect(task.workerId).toBe(worker)
			}
		}

		// 3 workers should claim 3 unique tasks
		expect(claimed.size).toBe(3)

		// Verify remaining tasks are still pending
		const remaining = db.prepare("SELECT * FROM tasks WHERE status = 'pending'").all()
		expect(remaining.length).toBe(2)
	})

	it("should set started_at and updated_at on claim", () => {
		const queue = new TaskQueueBullMQ(createMemoryStore(db))
		insertTask({ type: "coding" })

		const before = Date.now()
		const task = queue.claimNext("worker-1")
		const after = Date.now()

		expect(task).not.toBeNull()
		expect(task.startedAt).toBeGreaterThanOrEqual(before)
		expect(task.startedAt).toBeLessThanOrEqual(after)
		expect(task.updatedAt).toBeGreaterThanOrEqual(before)
	})
})
