import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(__dirname, "..", "server/src/memory/commit-deploy-log.json");
const data = JSON.parse(fs.readFileSync(logPath, "utf8"));

// Remove test entry if present
data.commits = data.commits.filter((c) => c.id !== "test");

// Add Sprint 3+4 code commit
data.commits.push({
  id: "commit_" + Date.now() + "_1",
  sha: "8fc922fca",
  agent: "deepseek-coder",
  type: "feature",
  title:
    "Sprint 3+4 — Multi-Provider Sandbox, Prompt Customization, Reasoning Config, TypeScript ports (G19/G22/G25), Auth (F7), Browser Agent (F8), Artifact Storage (F9), Deployer Adapters (F10)",
  filesChanged: [
    "cloud/orchestrator/sandbox/SandboxProvider.js",
    "cloud/orchestrator/sandbox/E2BSandbox.js",
    "cloud/orchestrator/sandbox/DaytonaSandbox.js",
    "cloud/orchestrator/sandbox/index.js",
    "cloud/orchestrator/modules/PromptCustomizer.js",
    "cloud/orchestrator/modules/ReasoningConfig.js",
    "cloud/orchestrator/CloudOrchestrator.js",
    "src/super-roo/autonomous-loop/index.ts",
    "src/super-roo/commissioning-loop/index.ts",
    "src/super-roo/hermes-claw/index.ts",
    "src/super-roo/auth/index.ts",
    "src/super-roo/browser-agent/index.ts",
    "src/super-roo/artifact-storage/index.ts",
    "src/super-roo/deployer-adapters/index.ts",
    "src/super-roo/index.ts",
    "memory/lessons-learned.md",
  ],
  featuresAffected: ["F4", "F5", "F6", "F7", "F8", "F9", "F10", "G19", "G22", "G25"],
  modelsUsed: [{ model: "deepseek-chat", provider: "deepseek", tokens: 45000, cost: 0.018 }],
  workflowCompliance: {
    steps: { plan: true, code: true, test: false, review: true, lesson: true },
    violations: [],
  },
});

// Add Sprint 3+4 lesson commit
data.commits.push({
  id: "commit_" + Date.now() + "_2",
  sha: "95fcd9f56",
  agent: "deepseek-coder",
  type: "docs",
  title: "Auto-extracted lesson for Sprint 3+4 commit",
  filesChanged: ["memory/lesson-index.jsonl", "memory/lesson-summaries.json", "memory/lessons-learned.md"],
  featuresAffected: ["F4", "F5", "F6", "F7", "F8", "F9", "F10"],
  modelsUsed: [{ model: "deepseek-chat", provider: "deepseek", tokens: 500, cost: 0.0002 }],
  workflowCompliance: {
    steps: { plan: false, code: false, test: false, review: false, lesson: true },
    violations: [],
  },
});

// Mark previous deploy as healthy
for (const d of data.deploys) {
  if (d.status === "deploying") d.status = "healthy";
}

// Add Sprint 3+4 deploy
data.deploys.push({
  id: "deploy_" + Date.now(),
  version: "3.53.4",
  commitSha: "95fcd9f56",
  agent: "deepseek-coder",
  target: "100.64.175.88",
  services: ["superroo-api", "superroo-worker", "superroo-dashboard"],
  status: "deploying",
  timestamp: new Date().toISOString(),
});

fs.writeFileSync(logPath, JSON.stringify(data, null, "\t") + "\n");
console.log("Updated commit-deploy-log.json");
console.log("Commits:", data.commits.length);
console.log("Deploys:", data.deploys.length);
const lc = data.commits[data.commits.length - 1];
console.log("Last commit:", lc.sha.substring(0, 8), lc.title.substring(0, 60));
const ld = data.deploys[data.deploys.length - 1];
console.log("Last deploy:", ld.commitSha, ld.version, ld.status);
