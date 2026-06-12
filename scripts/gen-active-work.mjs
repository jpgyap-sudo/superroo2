#!/usr/bin/env node
/**
 * gen-active-work.mjs — Auto-generate ACTIVE_WORK.md from global task registry
 *
 * Reads ~/.superroo/tasks/global-tasks.json and regenerates ACTIVE_WORK.md.
 * Run manually or via cron. Safe to run any time — always writes a fresh board.
 *
 * Usage:
 *   node scripts/gen-active-work.mjs           # regenerate board
 *   node scripts/gen-active-work.mjs --dry-run # preview without writing
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import os from "os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const REGISTRY = process.env.GLOBAL_TASK_REGISTRY
  || path.join(os.homedir(), ".superroo", "tasks", "global-tasks.json")
const OUTPUT = path.join(ROOT, "ACTIVE_WORK.md")
const DRY_RUN = process.argv.includes("--dry-run")

const agentIcons = { claude: "🧠", "kilo-code": "🦘", codex: "🤖", copilot: "🧭", unknown: "❓" }
const statusIcon = { active: "🔵", completed: "✅", blocked: "🔴", cancelled: "⚫" }

function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, "utf8")) }
  catch { return { version: 1, projects: {} } }
}

function allTasks(registry) {
  const tasks = []
  for (const [project, projData] of Object.entries(registry.projects || {})) {
    for (const [agent, agentTasks] of Object.entries(projData)) {
      if (agent === "updatedAt" || !Array.isArray(agentTasks)) continue
      for (const t of agentTasks) tasks.push({ project, agent, ...t })
    }
  }
  return tasks.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
}

function staleWarning(updatedAt) {
  if (!updatedAt) return ""
  const hoursAgo = (Date.now() - new Date(updatedAt).getTime()) / 3600000
  if (hoursAgo > 4) return ` ⚠️ stale (${Math.round(hoursAgo)}h ago)`
  return ""
}

const registry = loadRegistry()
const tasks = allTasks(registry)
const active = tasks.filter(t => t.status === "active")
const recentDone = tasks.filter(t => t.status === "completed").slice(0, 20)

// Group by agent
const byAgent = {}
for (const t of [...active, ...recentDone]) {
  if (!byAgent[t.agent]) byAgent[t.agent] = { active: [], done: [] }
  if (t.status === "active") byAgent[t.agent].active.push(t)
  else byAgent[t.agent].done.push(t)
}

const now = new Date().toISOString().slice(0, 19).replace("T", " ")

let md = `# SuperRoo — Active Work Board

**All coding extensions MUST read this file before starting work and update their section when done.**
This prevents duplicate work and lets each agent build on what others have already done.

> Auto-generated from \`~/.superroo/tasks/global-tasks.json\` at ${now}
> To update: \`node scripts/gen-active-work.mjs\`

---

## ${statusIcon.active} Active Right Now

`

if (active.length === 0) {
  md += `_(nothing active)_\n`
} else {
  for (const t of active) {
    const icon = agentIcons[t.agent] || "❓"
    const stale = staleWarning(t.updatedAt)
    md += `- ${icon} **[${t.agent}]** ${t.title}${stale}\n`
    if (t.summary) md += `  > ${t.summary.slice(0, 100)}\n`
    if (t.files?.length) md += `  > Files: ${t.files.slice(0, 3).join(", ")}\n`
    md += `  > id: \`${t.id}\`  updated: ${t.updatedAt?.slice(0, 10)}\n\n`
  }
}

md += `\n---\n`

// Section per agent
const agentOrder = ["claude", "kilo-code", "codex", "copilot", ...Object.keys(byAgent).filter(a => !["claude","kilo-code","codex","copilot"].includes(a))]
for (const agent of agentOrder) {
  if (!byAgent[agent]) continue
  const icon = agentIcons[agent] || "❓"
  const { active: agentActive, done: agentDone } = byAgent[agent]

  md += `\n## ${icon} ${agent === "claude" ? "Claude Code" : agent === "kilo-code" ? "Kilo Code" : agent === "copilot" ? "GitHub Copilot" : agent.charAt(0).toUpperCase() + agent.slice(1)}\n\n`

  if (agentActive.length) {
    md += `### In Progress\n\n`
    for (const t of agentActive) {
      md += `- ${statusIcon.active} **${t.title}**${staleWarning(t.updatedAt)}\n`
      if (t.summary) md += `  ${t.summary.slice(0, 120)}\n`
    }
    md += "\n"
  }

  if (agentDone.length) {
    md += `### Recently Completed\n\n| Date | Task | Files |\n|------|------|-------|\n`
    for (const t of agentDone.slice(0, 10)) {
      const date = t.updatedAt?.slice(0, 10) || "?"
      const files = (t.files || []).slice(0, 2).join(", ") || "—"
      md += `| ${date} | ${t.title.slice(0, 60)} | ${files} |\n`
    }
    md += "\n"
  }

  md += "---\n"
}

md += `\n## 📊 Task Stats\n\n`
md += `- Total tasks: ${tasks.length}\n`
md += `- Active: ${active.length}\n`
md += `- Completed: ${tasks.filter(t => t.status === "completed").length}\n`
md += `- Blocked: ${tasks.filter(t => t.status === "blocked").length}\n`
md += `- Registry: \`${REGISTRY}\`\n`

if (DRY_RUN) {
  console.log("=== DRY RUN — would write to:", OUTPUT, "===\n")
  console.log(md)
} else {
  fs.writeFileSync(OUTPUT, md, "utf8")
  console.log(`✅ ACTIVE_WORK.md regenerated — ${active.length} active, ${recentDone.length} recent completions`)
}
