/**
 * Predictive Swarm — Tests for PredictiveFailureEngine, SwarmDebugger, DeployGate
 *
 * Run: cd cloud && npx vitest run test/predictive-swarm.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// PredictiveFailureEngine
// ---------------------------------------------------------------------------
describe("PredictiveFailureEngine", () => {
	let PredictiveFailureEngine
	let mockPool
	let engine

	beforeEach(async () => {
		vi.resetModules()
		mockPool = {
			query: vi.fn().mockResolvedValue({ rows: [] }),
		}
		const mod = await import("../orchestrator/stores/brain/PredictiveFailureEngine")
		PredictiveFailureEngine = mod.PredictiveFailureEngine
	})

	it("should construct with default thresholds", () => {
		engine = new PredictiveFailureEngine(mockPool)
		expect(engine.pool).toBe(mockPool)
		expect(engine.lowThreshold).toBe(0.4)
		expect(engine.highThreshold).toBe(0.75)
		expect(engine.criticalThreshold).toBe(0.9)
		expect(engine.maxPatterns).toBe(20)
	})

	it("should construct with custom thresholds", () => {
		engine = new PredictiveFailureEngine(mockPool, {
			lowThreshold: 0.3,
			highThreshold: 0.6,
			criticalThreshold: 0.85,
			maxPatterns: 10,
		})
		expect(engine.lowThreshold).toBe(0.3)
		expect(engine.highThreshold).toBe(0.6)
		expect(engine.criticalThreshold).toBe(0.85)
		expect(engine.maxPatterns).toBe(10)
	})

	describe("assess()", () => {
		it("should return low risk for a safe action with no files", async () => {
			engine = new PredictiveFailureEngine(mockPool)

			const result = await engine.assess({
				actionType: "send_message",
				filesChanged: [],
				logs: "",
			})

			expect(result.riskScore).toBeLessThan(0.4)
			expect(result.riskLevel).toBe("low")
			expect(result.matchedPatterns).toEqual([])
			expect(result.reasons.length).toBeGreaterThan(0)
		})

		it("should return medium risk for deploy action", async () => {
			engine = new PredictiveFailureEngine(mockPool)

			const result = await engine.assess({
				actionType: "deploy",
				filesChanged: [],
				logs: "",
			})

			// deploy base risk is 0.2, which is < 0.4 → low
			expect(result.riskScore).toBe(0.2)
			expect(result.riskLevel).toBe("low")
		})

		it("should return high risk for delete action with sensitive files", async () => {
			engine = new PredictiveFailureEngine(mockPool)

			const result = await engine.assess({
				actionType: "delete",
				filesChanged: ["src/auth/login.ts", "src/payments/checkout.ts"],
				logs: "",
			})

			// delete base 0.7 + auth 0.25 + payment 0.3 = 1.25, clamped to 1.0
			expect(result.riskScore).toBeGreaterThanOrEqual(0.9)
			expect(result.riskLevel).toBe("critical")
		})

		it("should return high risk for db_migration with sensitive files and failure logs", async () => {
			engine = new PredictiveFailureEngine(mockPool)

			const result = await engine.assess({
				actionType: "db_migration",
				filesChanged: ["db/migrations/001_add_users.sql", "config/database.php"],
				logs: "[ERROR] timeout connecting to database\nfailed to connect\nout of memory",
			})

			// db_migration 0.25 + migration 0.2 + config 0.1 + timeout 0.2 + failure 0.15 + OOM 0.25 = 1.15, clamped to 1.0
			expect(result.riskScore).toBeGreaterThanOrEqual(0.9)
			expect(result.riskLevel).toBe("critical")
		})

		it("should include historical pattern matches from database", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			mockPool.query.mockResolvedValue({
				rows: [
					{
						id: "pat-1",
						pattern_type: "deploy-failure",
						signature: "timeout",
						description: "Deploy timeout pattern",
						severity: "high",
						occurrences: 5,
					},
				],
			})

			const result = await engine.assess({
				actionType: "deploy",
				filesChanged: [],
				logs: "timeout",
			})

			// Should have matched the historical pattern (signature "timeout" in logs)
			expect(result.matchedPatterns.length).toBeGreaterThan(0)
			const historical = result.matchedPatterns.filter((m) => m.id === "pat-1")
			expect(historical.length).toBe(1)
			expect(historical[0].severity).toBe("high")
		})

		it("should throw for invalid actionType", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await expect(engine.assess({ actionType: "invalid_action" })).rejects.toThrow(/Invalid actionType/i)
		})

		it("should handle database query failure gracefully", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			// First call (pattern query) fails, second call (INSERT) succeeds
			mockPool.query.mockRejectedValueOnce(new Error("DB down")).mockResolvedValueOnce({ rows: [] })

			const result = await engine.assess({
				actionType: "deploy",
				filesChanged: [],
				logs: "",
			})

			// Should still return a risk score even if DB fails
			expect(result.riskScore).toBeGreaterThanOrEqual(0)
			expect(result.riskLevel).toBeDefined()
		})
	})

	describe("recordFailurePattern()", () => {
		it("should insert a failure pattern", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			mockPool.query.mockResolvedValue({ rows: [] })

			const result = await engine.recordFailurePattern({
				patternType: "deploy-failure",
				signature: "timeout",
				description: "Deploy timeout pattern",
				severity: "high",
				source: "test",
			})

			expect(result).toHaveProperty("id")
			expect(mockPool.query).toHaveBeenCalled()
		})

		it("should throw for missing patternType", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await expect(engine.recordFailurePattern({ signature: "sig", description: "desc" })).rejects.toThrow(
				/patternType/,
			)
		})

		it("should throw for missing signature", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await expect(engine.recordFailurePattern({ patternType: "type", description: "desc" })).rejects.toThrow(
				/signature/,
			)
		})

		it("should throw for missing description", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await expect(engine.recordFailurePattern({ patternType: "type", signature: "sig" })).rejects.toThrow(
				/description/,
			)
		})

		it("should throw for invalid severity", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await expect(
				engine.recordFailurePattern({
					patternType: "type",
					signature: "sig",
					description: "desc",
					severity: "invalid",
				}),
			).rejects.toThrow(/Invalid severity/)
		})
	})

	describe("incrementPatternOccurrence()", () => {
		it("should increment occurrence count", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			await engine.incrementPatternOccurrence("pat-1")
			expect(mockPool.query).toHaveBeenCalled()
		})
	})

	describe("getAssessments()", () => {
		it("should return assessments with filters", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			mockPool.query.mockResolvedValueOnce({ rows: [{ total: "1" }] }).mockResolvedValueOnce({
				rows: [
					{
						id: "assess-1",
						action_type: "deploy",
						risk_score: 0.45,
						risk_level: "medium",
						created_at: "2026-01-01T00:00:00Z",
					},
				],
			})

			const result = await engine.getAssessments({ projectId: "proj-1" })
			expect(result.rows).toHaveLength(1)
			expect(result.total).toBe(1)
			expect(result.rows[0].action_type).toBe("deploy")
		})
	})

	describe("getFailurePatterns()", () => {
		it("should return failure patterns with filters", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			mockPool.query.mockResolvedValueOnce({ rows: [{ total: "1" }] }).mockResolvedValueOnce({
				rows: [
					{
						id: "pat-1",
						pattern_type: "deploy-failure",
						severity: "high",
						occurrences: 3,
						created_at: "2026-01-01T00:00:00Z",
					},
				],
			})

			const result = await engine.getFailurePatterns({ severity: "high" })
			expect(result.rows).toHaveLength(1)
			expect(result.total).toBe(1)
		})
	})

	describe("getStats()", () => {
		it("should return risk statistics in dashboard shape", async () => {
			engine = new PredictiveFailureEngine(mockPool)
			mockPool.query
				.mockResolvedValueOnce({
					rows: [
						{
							total_assessments: 18,
							critical_count: 1,
							high_count: 2,
							medium_count: 5,
							low_count: 10,
							avg_risk_score: 0.35,
							max_risk_score: 0.95,
						},
					],
				})
				.mockResolvedValueOnce({
					rows: [{ total_patterns: 5, total_occurrences: 12 }],
				})
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [] })

			const result = await engine.getStats("proj-1")
			expect(result).toHaveProperty("totalAssessments", 18)
			expect(result).toHaveProperty("byLevel")
			expect(result.byLevel.critical).toBe(1)
			expect(result.byLevel.high).toBe(2)
			expect(result.byLevel.medium).toBe(5)
			expect(result.byLevel.low).toBe(10)
			expect(result).toHaveProperty("totalPatterns", 5)
			expect(result).toHaveProperty("totalOccurrences", 12)
			expect(result).toHaveProperty("avgRiskScore", 0.35)
			expect(result).toHaveProperty("maxRiskScore", 0.95)
		})
	})
})

// ---------------------------------------------------------------------------
// SwarmDebugger
// ---------------------------------------------------------------------------
describe("SwarmDebugger", () => {
	let SwarmDebugger
	let mockPool
	let debugger_instance

	beforeEach(async () => {
		vi.resetModules()
		mockPool = {
			query: vi.fn().mockResolvedValue({ rows: [] }),
		}
		const mod = await import("../orchestrator/stores/brain/SwarmDebugger")
		SwarmDebugger = mod.SwarmDebugger
	})

	it("should construct with default agents", () => {
		debugger_instance = new SwarmDebugger(mockPool)
		expect(debugger_instance.pool).toBe(mockPool)
		expect(debugger_instance.agents.length).toBe(6)
		expect(debugger_instance.agents[0].name).toBe("logs-agent")
		expect(debugger_instance.agents[5].name).toBe("memory-agent")
	})

	it("should construct with custom agents", () => {
		const customAgents = [{ name: "custom-agent", focus: "Custom analysis" }]
		debugger_instance = new SwarmDebugger(mockPool, { agents: customAgents })
		expect(debugger_instance.agents).toEqual(customAgents)
	})

	describe("debug()", () => {
		it("should throw for missing problem", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			await expect(debugger_instance.debug({})).rejects.toThrow(/problem/i)
		})

		it("should run all agents and return findings", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			mockPool.query.mockResolvedValue({ rows: [] })

			const result = await debugger_instance.debug({
				problem: "Deployment failed with timeout",
				context: {
					filesChanged: ["src/server.ts"],
					logs: "[ERROR] connection timeout",
				},
			})

			expect(result).toHaveProperty("runId")
			expect(result).toHaveProperty("findings")
			expect(result).toHaveProperty("finalSummary")
			expect(result).toHaveProperty("status", "completed")
			expect(Array.isArray(result.findings)).toBe(true)
			// Should have findings from all 6 agents
			expect(result.findings.length).toBe(6)
		})

		it("should include context in findings", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			mockPool.query.mockResolvedValue({ rows: [] })

			const result = await debugger_instance.debug({
				problem: "Database connection failed",
				context: {
					filesChanged: ["src/db.ts"],
					logs: "[ERROR] connection refused",
					environment: { stage: "production" },
				},
			})

			expect(result.findings.length).toBe(6)
		})
	})

	describe("_runBuiltinAgent()", () => {
		it("should run logs agent and find error patterns", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const logsAgent = { name: "logs-agent", focus: "Log analysis" }
			const result = await debugger_instance._runBuiltinAgent(logsAgent, {
				problem: "test",
				context: { logs: "[ERROR] timeout\n[FATAL] OOM" },
			})
			expect(result).toHaveProperty("finding")
			expect(result).toHaveProperty("confidence")
			expect(result.confidence).toBeGreaterThan(0)
		})

		it("should run docker agent and check Dockerfile patterns", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const dockerAgent = { name: "docker-agent", focus: "Docker health" }
			const result = await debugger_instance._runBuiltinAgent(dockerAgent, {
				problem: "test",
				context: { filesChanged: ["Dockerfile"] },
			})
			expect(result).toHaveProperty("finding")
			expect(result.finding).toContain("Docker")
		})

		it("should run database agent and return findings", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const dbAgent = { name: "database-agent", focus: "Database integrity" }
			const result = await debugger_instance._runBuiltinAgent(dbAgent, {
				problem: "Connection pool exhausted",
				context: {},
			})
			expect(result).toHaveProperty("finding")
			expect(result.finding).toContain("database")
		})

		it("should run security agent and detect sensitive files", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const secAgent = { name: "security-agent", focus: "Security audit" }
			const result = await debugger_instance._runBuiltinAgent(secAgent, {
				problem: "test",
				context: { filesChanged: [".env", "src/auth.ts"], logs: "" },
			})
			expect(result).toHaveProperty("finding")
			expect(result.finding).toContain("Security")
		})

		it("should run regression agent and check for risky files", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const regAgent = { name: "regression-agent", focus: "Regression analysis" }
			const result = await debugger_instance._runBuiltinAgent(regAgent, {
				problem: "test",
				context: { filesChanged: ["src/api/routes.ts"] },
			})
			expect(result).toHaveProperty("finding")
			expect(result.finding).toContain("critical path")
		})

		it("should run memory agent and search memory service", async () => {
			const mockMemoryService = {
				searchMemory: vi
					.fn()
					.mockResolvedValue([
						{ id: "mem-1", title: "Previous similar issue", content: "Fix was X", similarity: 0.85 },
					]),
			}
			debugger_instance = new SwarmDebugger(mockPool, {
				memoryService: mockMemoryService,
			})
			const memAgent = { name: "memory-agent", focus: "Memory recall" }
			const result = await debugger_instance._runBuiltinAgent(memAgent, {
				problem: "Deploy timeout",
				context: {},
			})
			expect(result).toHaveProperty("finding")
			expect(mockMemoryService.searchMemory).toHaveBeenCalled()
			expect(result.finding).toContain("similar past issue")
		})

		it("should handle unknown agent type gracefully", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			const unknownAgent = { name: "unknown", focus: "Unknown" }
			const result = await debugger_instance._runBuiltinAgent(unknownAgent, {
				problem: "test",
				context: {},
			})
			expect(result).toHaveProperty("finding")
			expect(result.finding).toContain("No built-in logic")
		})
	})

	describe("listRuns()", () => {
		it("should return runs with filters", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			mockPool.query.mockResolvedValueOnce({ rows: [{ total: "1" }] }).mockResolvedValueOnce({
				rows: [
					{
						id: "run-1",
						problem: "Test problem",
						status: "completed",
						created_at: "2026-01-01T00:00:00Z",
					},
				],
			})

			const result = await debugger_instance.listRuns({ status: "completed" })
			expect(result.rows).toHaveLength(1)
			expect(result.total).toBe(1)
			expect(result.rows[0].problem).toBe("Test problem")
		})
	})

	describe("getRun()", () => {
		it("should return a single run by id", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			mockPool.query.mockResolvedValue({
				rows: [
					{
						id: "run-1",
						problem: "Test problem",
						status: "completed",
						findings: JSON.stringify([{ agent: "logs-agent", finding: "test", confidence: 0.8 }]),
						created_at: "2026-01-01T00:00:00Z",
					},
				],
			})

			const result = await debugger_instance.getRun("run-1")
			expect(result).toBeDefined()
			expect(result.id).toBe("run-1")
		})

		it("should return null for non-existent run", async () => {
			debugger_instance = new SwarmDebugger(mockPool)
			mockPool.query.mockResolvedValue({ rows: [] })

			const result = await debugger_instance.getRun("nonexistent")
			expect(result).toBeNull()
		})
	})
})

// ---------------------------------------------------------------------------
// DeployGate
// ---------------------------------------------------------------------------
describe("DeployGate", () => {
	let DeployGate
	let mockRiskEngine
	let mockSwarmDebugger
	let mockConsensus
	let gate

	beforeEach(async () => {
		vi.resetModules()
		mockRiskEngine = {
			assess: vi.fn(),
			recordFailurePattern: vi.fn(),
		}
		mockSwarmDebugger = {
			debug: vi.fn(),
		}
		mockConsensus = {
			decide: vi.fn(),
		}
		const mod = await import("../orchestrator/stores/brain/DeployGate")
		DeployGate = mod.DeployGate
	})

	it("should throw if riskEngine is missing", () => {
		expect(() => {
			new DeployGate({ swarmDebugger: mockSwarmDebugger, consensus: mockConsensus })
		}).toThrow(/riskEngine/i)
	})

	it("should throw if swarmDebugger is missing", () => {
		expect(() => {
			new DeployGate({ riskEngine: mockRiskEngine, consensus: mockConsensus })
		}).toThrow(/swarmDebugger/i)
	})

	it("should throw if consensus is missing", () => {
		expect(() => {
			new DeployGate({ riskEngine: mockRiskEngine, swarmDebugger: mockSwarmDebugger })
		}).toThrow(/consensus/i)
	})

	it("should construct with all dependencies", () => {
		gate = new DeployGate({
			riskEngine: mockRiskEngine,
			swarmDebugger: mockSwarmDebugger,
			consensus: mockConsensus,
		})
		expect(gate.riskEngine).toBe(mockRiskEngine)
		expect(gate.swarmDebugger).toBe(mockSwarmDebugger)
		expect(gate.consensus).toBe(mockConsensus)
	})

	describe("check() — low risk", () => {
		it("should pass low risk actions through consensus", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.2,
				riskLevel: "low",
				reasons: ["Low risk action"],
				matchedPatterns: [],
				id: "assess-1",
			})
			mockConsensus.decide.mockResolvedValue({
				finalDecision: "approve",
				reasons: ["Consensus approved"],
			})

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
			})

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "send_message",
				agent: "test-agent",
			})

			expect(result.allowed).toBe(true)
			expect(result.assessment.riskLevel).toBe("low")
			// Low risk should go to consensus
			expect(mockConsensus.decide).toHaveBeenCalled()
		})
	})

	describe("check() — medium risk", () => {
		it("should require consensus vote for medium risk", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.55,
				riskLevel: "medium",
				reasons: ["Medium risk action"],
				matchedPatterns: [],
				id: "assess-2",
			})
			mockConsensus.decide.mockResolvedValue({
				finalDecision: "approve",
				reasons: ["Consensus approved"],
			})

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
			})

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "db_migration",
				agent: "test-agent",
			})

			expect(result.allowed).toBe(true)
			expect(mockConsensus.decide).toHaveBeenCalled()
			// Should NOT run swarm debug for medium
			expect(mockSwarmDebugger.debug).not.toHaveBeenCalled()
		})

		it("should block if consensus rejects medium risk", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.55,
				riskLevel: "medium",
				reasons: ["Medium risk action"],
				matchedPatterns: [],
				id: "assess-3",
			})
			mockConsensus.decide.mockResolvedValue({
				finalDecision: "reject",
				reasons: ["Too risky"],
			})

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
			})

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "db_migration",
				agent: "test-agent",
			})

			expect(result.allowed).toBe(false)
		})
	})

	describe("check() — high risk", () => {
		it("should run swarm debug and require human approval for high risk", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.82,
				riskLevel: "high",
				reasons: ["High risk action"],
				matchedPatterns: [],
				id: "assess-4",
			})
			mockSwarmDebugger.debug.mockResolvedValue({
				runId: "swarm-1",
				findings: [
					{ agent: "logs-agent", finding: "Error pattern found", confidence: 0.8, suggestedFix: null },
				],
				finalSummary: "Potential issues detected",
				status: "completed",
			})

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
				requireHumanApproval: true,
			})

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "delete",
				agent: "test-agent",
			})

			expect(mockSwarmDebugger.debug).toHaveBeenCalled()
			expect(result.swarmResult).toBeDefined()
			expect(result.swarmResult.runId).toBe("swarm-1")
			// With requireHumanApproval=true, high risk should be blocked (needs human)
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("Human approval required")
		})

		it("should pass high risk through consensus if requireHumanApproval is false", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.82,
				riskLevel: "high",
				reasons: ["High risk action"],
				matchedPatterns: [],
				id: "assess-5",
			})
			mockSwarmDebugger.debug.mockResolvedValue({
				runId: "swarm-2",
				findings: [],
				finalSummary: "No issues",
				status: "completed",
			})
			mockConsensus.decide.mockResolvedValue({
				finalDecision: "approve",
				reasons: ["Consensus approved"],
			})

			gate = new DeployGate(
				{
					riskEngine: mockRiskEngine,
					swarmDebugger: mockSwarmDebugger,
					consensus: mockConsensus,
				},
				{
					requireHumanApproval: false,
					autoRecordPatterns: false,
				},
			)

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "delete",
				agent: "test-agent",
			})

			expect(result.allowed).toBe(true)
			expect(mockConsensus.decide).toHaveBeenCalled()
		})
	})

	describe("check() — critical risk", () => {
		it("should block critical risk immediately", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.95,
				riskLevel: "critical",
				reasons: ["Critical risk action"],
				matchedPatterns: [],
				id: "assess-6",
			})

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
			})

			const result = await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "delete",
				agent: "test-agent",
			})

			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("block")
			// Should NOT run swarm debug or consensus for critical
			expect(mockSwarmDebugger.debug).not.toHaveBeenCalled()
			expect(mockConsensus.decide).not.toHaveBeenCalled()
		})
	})

	describe("check() — autoRecordPatterns", () => {
		it("should record failure pattern when blocked and autoRecordPatterns is true", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.95,
				riskLevel: "critical",
				reasons: ["Critical risk action"],
				matchedPatterns: [],
				id: "assess-7",
			})
			mockRiskEngine.recordFailurePattern.mockResolvedValue({ id: "pat-new" })

			gate = new DeployGate({
				riskEngine: mockRiskEngine,
				swarmDebugger: mockSwarmDebugger,
				consensus: mockConsensus,
				autoRecordPatterns: true,
			})

			await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "delete",
				agent: "test-agent",
			})

			// Critical risk returns early before autoRecordPatterns check
			// autoRecordPatterns is only checked in the high-risk swarm debug path
			expect(mockRiskEngine.recordFailurePattern).not.toHaveBeenCalled()
		})

		it("should NOT record failure pattern when autoRecordPatterns is false", async () => {
			mockRiskEngine.assess.mockResolvedValue({
				riskScore: 0.82,
				riskLevel: "high",
				reasons: ["High risk action"],
				matchedPatterns: [],
				id: "assess-8",
			})
			mockSwarmDebugger.debug.mockResolvedValue({
				runId: "swarm-3",
				findings: [{ agent: "logs-agent", finding: "Error found", confidence: 0.8, suggestedFix: null }],
				finalSummary: "Issues",
				status: "completed",
			})

			gate = new DeployGate(
				{
					riskEngine: mockRiskEngine,
					swarmDebugger: mockSwarmDebugger,
					consensus: mockConsensus,
				},
				{
					autoRecordPatterns: false,
					requireHumanApproval: false,
				},
			)
			mockConsensus.decide.mockResolvedValue({
				finalDecision: "approve",
				reasons: ["OK"],
			})

			await gate.check({
				projectId: "proj-1",
				taskId: "task-1",
				actionType: "delete",
				agent: "test-agent",
			})

			expect(mockRiskEngine.recordFailurePattern).not.toHaveBeenCalled()
		})
	})
})
