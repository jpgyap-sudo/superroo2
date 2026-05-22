/**
 * Record the Telegram coding improvement commits and deploy in commit-deploy-log.json
 *
 * Usage: node scripts/record-telegram-coding-commits.mjs
 */
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import fs from "fs/promises"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOG_PATH = resolve(__dirname, "..", "server", "src", "memory", "commit-deploy-log.json")

async function main() {
  // Read current log
  const raw = await fs.readFile(LOG_PATH, "utf-8")
  const log = JSON.parse(raw)

  const now = new Date().toISOString()
  const deployId = "deploy_" + Date.now()

  // Commit 1: Sprint 1+2 — critical debt fixes + P0 innovative features
  log.commits.push({
    id: "commit_58e5fcaf7",
    commitSha: "58e5fcaf7",
    agent: "Roo Code (DeepSeek)",
    type: "feature",
    title: "Sprint 1+2 — critical debt fixes + P0 innovative features",
    description: "NeuralNetwork.js (1,428 lines), SuperDebugLoop.js (1,410 lines), A2AProtocol.js (462 lines), CollaborationBridge.js (513 lines), PairProgrammingMode.js (365 lines), Observability stack (6 files), 7 test files, gap analysis doc",
    filesChanged: [
      "cloud/AUDIT_FINDINGS.md",
      "cloud/api/api.js",
      "cloud/collaboration/A2AProtocol.js",
      "cloud/collaboration/CollaborationBridge.js",
      "cloud/collaboration/PairProgrammingMode.js",
      "cloud/collaboration/index.js",
      "cloud/dashboard/src/components/ide-terminal/api.ts",
      "cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts",
      "cloud/dashboard/src/components/views/approvals.tsx",
      "cloud/dashboard/src/components/views/ide-terminal.tsx",
      "cloud/dashboard/src/components/views/skill-generator.tsx",
      "cloud/mini-ide/server.js",
      "cloud/orchestrator/modules/AutonomousLoop.js",
      "cloud/orchestrator/modules/CommissioningLoop.js",
      "cloud/orchestrator/modules/NeuralNetwork.js",
      "cloud/orchestrator/modules/SuperDebugLoop.js",
      "cloud/orchestrator/observability/ObservabilityManager.js",
      "cloud/orchestrator/observability/ObservabilityProvider.js",
      "cloud/orchestrator/observability/index.js",
      "cloud/orchestrator/observability/providers/ConsoleProvider.js",
      "cloud/orchestrator/observability/providers/DatadogProvider.js",
      "cloud/orchestrator/observability/providers/SentryProvider.js",
      "cloud/test/autonomous-loop.test.js",
      "cloud/test/collaboration.test.js",
      "cloud/test/commissioning-loop.test.js",
      "cloud/test/neural-network.test.js",
      "cloud/test/observability.test.js",
      "cloud/test/self-healing-loop.test.js",
      "cloud/test/super-debug-loop.test.js",
      "docs/super-roo/GAP_ANALYSIS_AND_INNOVATION_2026-05-22.md",
      "memory/context/latest-agent-context.md",
      "memory/lesson-index.jsonl",
      "memory/lesson-summaries.json",
      "memory/lessons-learned.md"
    ],
    featuresAffected: [
      "neural-network",
      "super-debug-loop",
      "a2a-protocol",
      "collaboration",
      "pair-programming",
      "observability",
      "testing",
      "gap-analysis"
    ],
    bugsFixed: [
      "A2A Protocol sendMessage checked agent registry instead of localAgentId",
      "delegateTask emitted duplicate task:completed events",
      "Missing semicolon after destructuring require causing ASI bug"
    ],
    timestamp: "2026-05-22T11:20:00.000Z",
    modelsUsed: [
      { phase: "coding", provider: "deepseek", model: "deepseek-chat" },
      { phase: "review", provider: "openai", model: "codex" }
    ],
    workflowCompliance: {
      isCompliant: true,
      deepseekUsed: true,
      lessonsRetrieved: true,
      testsRun: true
    }
  })

  // Commit 2: Auto-extracted lesson for Sprint 1+2
  log.commits.push({
    id: "commit_7f3e6f4bb",
    commitSha: "7f3e6f4bb",
    agent: "Roo Code (DeepSeek)",
    type: "docs",
    title: "Auto-extracted lesson for Sprint 1+2 commit",
    description: "Auto-extracted lesson documenting A2A Protocol sendMessage fix and ASI semicolon fix",
    filesChanged: [
      "memory/lesson-index.jsonl",
      "memory/lesson-summaries.json",
      "memory/lessons-learned.md"
    ],
    featuresAffected: ["learning-layer"],
    bugsFixed: [],
    timestamp: "2026-05-22T11:31:00.000Z",
    modelsUsed: [
      { phase: "coding", provider: "deepseek", model: "deepseek-chat" }
    ],
    workflowCompliance: {
      isCompliant: true,
      deepseekUsed: true,
      lessonsRetrieved: true,
      testsRun: false
    }
  })

  // Deploy record
  log.deploys.push({
    id: deployId,
    version: "sprint-1+2-telegram-coding",
    commitSha: "7f3e6f4bb",
    agent: "Roo Code (DeepSeek)",
    target: "100.64.175.88",
    services: [
      "superroo-api",
      "superroo-worker",
      "superroo-dashboard"
    ],
    status: "deploying",
    timestamp: now
  })

  // Atomic write
  const tmpPath = LOG_PATH + ".tmp"
  await fs.writeFile(tmpPath, JSON.stringify(log, null, 2), "utf-8")
  await fs.rename(tmpPath, LOG_PATH)

  console.log("✅ Commits and deploy recorded in commit-deploy-log.json")
  console.log("   Commits: 58e5fcaf7 (Sprint 1+2), 7f3e6f4bb (lesson)")
  console.log("   Deploy: " + deployId + " (status: deploying)")
}

main().catch((err) => {
  console.error("❌ Failed to record commits/deploy:", err)
  process.exit(1)
})
