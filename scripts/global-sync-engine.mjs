#!/usr/bin/env node
/**
 * global-sync-engine.mjs — Core Cross-Extension Sync Engine
 *
 * Reads the ecosystem registry and performs gap detection across 7 feature
 * domains for every participating extension. Outputs a structured sync matrix
 * that the executor can act on.
 *
 * USAGE:
 *   node scripts/global-sync-engine.mjs              # full scan
 *   node scripts/global-sync-engine.mjs --status     # summary only
 *   node scripts/global-sync-engine.mjs --dry-run    # no side effects
 *   node scripts/global-sync-engine.mjs --json       # emit machine-readable matrix
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME =
  process.env.SUPERROO_HOME || path.join(HOME, ".superroo")

const ECOSYSTEM_REGISTRY =
  process.env.SUPERROO_EXTENSION_ECOSYSTEM ||
  path.join(SUPERROO_HOME, "resources", "coding-extension-ecosystem.md")

const CANONICAL = {
  lessonsMd: path.join(SUPERROO_HOME, "memory", "lessons-learned.md"),
  lessonsJsonl: path.join(SUPERROO_HOME, "memory", "lesson-index.jsonl"),
  tasks: path.join(SUPERROO_HOME, "tasks", "global-tasks.json"),
  skills: path.join(SUPERROO_HOME, "skills"),
  resources: path.join(SUPERROO_HOME, "resources"),
  risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
  context: path.join(SUPERROO_HOME, "memory", "context", "latest-agent-context.md"),
  mcp: path.join(SUPERROO_HOME, "mcp"),
  syncActions: path.join(SUPERROO_HOME, "memory", "sync-actions.jsonl"),
}

const EXTENSION_TARGETS = {
  "codex": {
    lessons: path.join(SUPERROO_HOME, "memory", "codex-brain", "memory.json"),
    tasks:
      process.env.CODEX_TASKS_PATH ||
      path.join(ROOT, "server", "src", "memory", "codextask.json"),
    skills: path.join(HOME, ".codex", "skills"),
    resources: path.join(HOME, ".codex", "skills"),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(HOME, ".codex", "context", "latest-context.md"),
    mcpConfig: path.join(HOME, ".codex", "config.toml"),
  },
  "claude": {
    lessons: path.join(SUPERROO_HOME, "memory", "claude-brain", "knowledge.jsonl"),
    tasks:
      process.env.CLAUDE_TASKS_PATH ||
      path.join(ROOT, "server", "src", "memory", "claudetask.json"),
    skills: path.join(HOME, ".claude", "skills"),
    resources: path.join(HOME, ".claude", "skills"),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(HOME, ".claude", "context", "latest-context.md"),
    mcpConfig: path.join(HOME, ".claude", "settings.json"),
  },
  "kilo-code": {
    lessons: path.join(HOME, ".kilo", "memory", "lessons.jsonl"),
    tasks: path.join(HOME, ".kilo", "memory", "tasks.json"),
    skills: path.join(HOME, ".kilo", "skill"),
    resources: path.join(HOME, ".kilo", "skill"),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(HOME, ".kilo", "memory", "latest-agent-context.md"),
    mcpConfig: path.join(HOME, ".kilo", "mcp.json"),
  },
  "kilo-legacy": {
    lessons: path.join(HOME, ".config", "kilo", "memory", "lessons.jsonl"),
    tasks: path.join(HOME, ".config", "kilo", "memory", "tasks.json"),
    skills: path.join(HOME, ".config", "kilo", "skill"),
    resources: path.join(HOME, ".config", "kilo", "skill"),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(HOME, ".config", "kilo", "memory", "latest-agent-context.md"),
    mcpConfig: path.join(HOME, ".config", "kilo", ".mcp.json"),
  },
  "blackbox": {
    lessons: path.join("C:", "Users", "user", "Documents", ".blackbox", "memory", "lessons.jsonl"),
    tasks: path.join("C:", "Users", "user", "Documents", ".blackbox", "tasks.json"),
    skills: path.join("C:", "Users", "user", "Documents", ".blackbox", "skills"),
    resources: path.join("C:", "Users", "user", "Documents", ".blackbox", "resources"),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join("C:", "Users", "user", "Documents", ".blackbox", "context", "latest-context.md"),
    mcpConfig: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "blackboxapp.blackboxagent",
      "settings",
      "blackbox_mcp_settings.json",
    ),
  },
  "superroo-vscode": {
    lessons: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "superroo.superroo",
      "memory",
      "lessons.jsonl",
    ),
    tasks: path.join(SUPERROO_HOME, "tasks", "global-tasks.json"),
    skills: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "superroo.superroo",
      "skills",
    ),
    resources: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "superroo.superroo",
      "resources",
    ),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "superroo.superroo",
      "context",
      "latest-agent-context.md",
    ),
    mcpConfig: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "superroo.superroo",
      "settings",
      "mcp_settings.json",
    ),
  },
  "roo-cline": {
    lessons: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "memory",
      "lessons.jsonl",
    ),
    tasks: path.join(SUPERROO_HOME, "tasks", "global-tasks.json"),
    skills: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "skills",
    ),
    resources: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "resources",
    ),
    risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
    context: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "context",
      "latest-agent-context.md",
    ),
    mcpConfig: path.join(
      "C:",
      "Users",
      "user",
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "settings",
      "mcp_settings.json",
    ),
  },
  "task-agent": {
    tasks: path.join(SUPERROO_HOME, "tasks", "global-tasks.json"),
    skills: path.join(SUPERROO_HOME, "skills", "task-agent"),
    resources: path.join(SUPERROO_HOME, "resources", "task-agent.md"),
    mcpConfig: path.join(SUPERROO_HOME, "mcp", "codex-brain.json"),
  },
}

const EXTENSION_AGENT_ALIASES = {
  codex: new Set(["codex"]),
  claude: new Set(["claude", "claude-code"]),
  "kilo-code": new Set(["kilo-code", "kilo"]),
  "kilo-legacy": new Set(["kilo-legacy"]),
  blackbox: new Set(["blackbox"]),
  "superroo-vscode": new Set(["superroo-vscode", "superroo"]),
  "roo-cline": new Set(["roo-cline", "roo"]),
  "task-agent": new Set(["task-agent"]),
}

function taskBelongsToExtension(task, extId) {
  const aliases = EXTENSION_AGENT_ALIASES[extId]
  if (!aliases) return true
  const agent = String(task.agent || task.owner || "").toLowerCase()
  return aliases.has(agent)
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const statusOnly = args.includes("--status")
const dryRun = args.includes("--dry-run")
const jsonOutput = args.includes("--json")

const log = (...a) => console.log(...a)
const warn = (...a) => console.warn("  ⚠️  ", ...a)
const ok = (...a) => console.log("  ✅", ...a)

// ── I/O helpers ───────────────────────────────────────────────────────────────

function exists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8")
}

function loadJson(filePath, fallback = null) {
  if (!exists(filePath)) return fallback
  try {
    return JSON.parse(readFile(filePath))
  } catch {
    return fallback
  }
}

function loadJsonl(filePath) {
  if (!exists(filePath)) return []
  return readFile(filePath)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function countItems(filePath) {
  if (!exists(filePath)) return 0
  if (filePath.endsWith(".jsonl")) return loadJsonl(filePath).length
  if (filePath.endsWith(".json")) {
    const data = loadJson(filePath)
    if (Array.isArray(data)) return data.length
    if (data && data.entries && Array.isArray(data.entries))
      return data.entries.length
    if (data && data.tasks && Array.isArray(data.tasks)) return data.tasks.length
    return 0
  }
  if (filePath.endsWith(".md")) return readFile(filePath).split(/^### /m).length - 1
  return 0
}

function dirCount(dirPath) {
  if (!exists(dirPath)) return 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

function entryNames(dirPath) {
  if (!exists(dirPath)) return new Set()
  try {
    return new Set(fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => entry.name))
  } catch {
    return new Set()
  }
}

function allTasksFromRegistry(registry) {
  if (Array.isArray(registry?.tasks)) return registry.tasks
  const tasks = []
  for (const [project, projectData] of Object.entries(registry?.projects || {})) {
    for (const [agent, agentTasks] of Object.entries(projectData || {})) {
      if (agent === "updatedAt" || !Array.isArray(agentTasks)) continue
      for (const task of agentTasks) tasks.push({ ...task, project, agent })
    }
  }
  return tasks
}

// ── Canonical state discovery ─────────────────────────────────────────────────

function getCanonicalState() {
  const canonicalLessons = loadJsonl(CANONICAL.lessonsJsonl)
  const canonicalTasks = allTasksFromRegistry(loadJson(CANONICAL.tasks, { tasks: [] }))
  const canonicalSkills = entryNames(CANONICAL.skills)
  const canonicalResources = entryNames(CANONICAL.resources)
  const canonicalRisk = loadJsonl(CANONICAL.risk)
  const hasContext = exists(CANONICAL.context)

  return {
    lessons: {
      total: canonicalLessons.length,
      titles: new Set(canonicalLessons.map((e) => e.title).filter(Boolean)),
      ids: new Set(canonicalLessons.map((e) => e.id).filter(Boolean)),
    },
    tasks: {
      total: canonicalTasks.length,
      active: canonicalTasks.filter((t) => t.status === "active").length,
      completed: canonicalTasks.filter((t) => t.status === "completed").length,
    },
    skills: { total: canonicalSkills.size, names: canonicalSkills },
    resources: { total: canonicalResources.size, names: canonicalResources },
    risk: { total: canonicalRisk.length },
    context: { exists: hasContext },
  }
}

// ── Per-extension gap detection ───────────────────────────────────────────────

function detectLessonsGap(extId, targets, canonical) {
  const gaps = []
  const extFile = targets.lessons
  if (!extFile) return gaps

  const extLessons = loadJsonl(extFile)
  const extTitles = new Set()
  const extIds = new Set()

  for (const entry of extLessons) {
    if (entry.title) extTitles.add(entry.title)
    if (entry.id) extIds.add(entry.id)
    if (entry.canonical_id) extIds.add(entry.canonical_id)
    if (entry.brain_entry_id) extIds.add(entry.brain_entry_id)
    if (entry.metadata?.canonicalId) extIds.add(entry.metadata.canonicalId)
    if (entry.metadata?.lessonId) extIds.add(entry.metadata.lessonId)
  }

  for (const canonicalId of canonical.lessons.ids) {
    if (!extIds.has(canonicalId)) {
      gaps.push({
        domain: "lessons",
        extId,
        type: "missing_lesson",
        canonicalId,
        action: "distribute_from_canonical",
        safe: true,
      })
    }
  }

  const extCount = extLessons.length
  const canonicalCount = canonical.lessons.total
  if (extCount < canonicalCount * 0.5 && canonicalCount > 0) {
    gaps.push({
      domain: "lessons",
      extId,
      type: "under_synced",
      extCount,
      canonicalCount,
      ratio: (extCount / canonicalCount).toFixed(2),
      action: "full_distribute",
      safe: true,
    })
  }

  return gaps
}

function detectTasksGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.tasks) return gaps

  const extTasks = allTasksFromRegistry(loadJson(targets.tasks, { tasks: [] }))
  if (extTasks.length === 0 && canonical.tasks.total > 0) {
    gaps.push({
      domain: "tasks",
      extId,
      type: "no_tasks",
      canonicalCount: canonical.tasks.total,
      action: "import_canonical",
      safe: true,
    })
  }

  const activeTasks = extTasks
    .filter((task) => taskBelongsToExtension(task, extId))
    .filter((task) =>
      ["active", "in_progress", "running", "pending"].includes(
        String(task.status || "").toLowerCase(),
      ),
    )
  const recentUpdate = activeTasks.reduce(
    (latest, t) => {
      const ts = t.updatedAt || t.startedAt || ""
      return ts > latest ? ts : latest
    },
    "",
  )
  if (recentUpdate) {
    const hoursAgo = (Date.now() - new Date(recentUpdate).getTime()) / 3600000
    if (hoursAgo > 4) {
      gaps.push({
        domain: "tasks",
        extId,
        type: "stale_tasks",
        lastUpdateHours: Math.round(hoursAgo),
        action: "mark_stale_warning",
        safe: true,
      })
    }
  }

  return gaps
}

function detectSkillsGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.skills) return gaps

  const extSkills = entryNames(targets.skills)
  const missing = [...canonical.skills.names].filter((name) => !extSkills.has(name))
  const extSkillCount = extSkills.size
  const canonicalCount = canonical.skills.total

  if (missing.length > 0 && canonicalCount > 0) {
    gaps.push({
      domain: "skills",
      extId,
      type: "missing_shims",
      extCount: extSkillCount,
      canonicalCount,
      missingCount: missing.length,
      missing,
      action: "create_shims",
      safe: true,
    })
  }

  return gaps
}

function detectResourcesGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.resources) return gaps

  const extResources = entryNames(targets.resources)
  const missing = [...canonical.resources.names].filter((name) => !extResources.has(name))
  const extResCount = extResources.size
  const canonicalCount = canonical.resources.total

  if (missing.length > 0 && canonicalCount > 0) {
    gaps.push({
      domain: "resources",
      extId,
      type: "missing_mirrors",
      extCount: extResCount,
      canonicalCount,
      missingCount: missing.length,
      missing,
      action: "create_mirrors",
      safe: true,
    })
  }

  return gaps
}

function detectRiskGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.risk) return gaps

  const extRisk = loadJsonl(targets.risk)
  const canonicalRisk = canonical.risk.total

  if (extRisk.length === 0 && canonicalRisk > 0) {
    gaps.push({
      domain: "risk",
      extId,
      type: "no_risk_data",
      canonicalCount: canonicalRisk,
      action: "share_risk_dir",
      safe: true,
    })
  }

  return gaps
}

function detectContextGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.context) return gaps

  const hasExtContext = exists(targets.context)
  const hasCanonical = canonical.context.exists

  if (hasCanonical && !hasExtContext) {
    gaps.push({
      domain: "context",
      extId,
      type: "missing_context",
      action: "create_context_pointer",
      safe: true,
    })
  }

  return gaps
}

function detectConfigGap(extId, targets, canonical) {
  const gaps = []
  if (!targets.mcpConfig) return gaps

  if (!exists(targets.mcpConfig)) {
    gaps.push({
      domain: "config",
      extId,
      type: "missing_config",
      target: targets.mcpConfig,
      action: "create_or_link_config",
      safe: true,
    })
  }

  return gaps
}

// ── Aggregate all gaps ────────────────────────────────────────────────────────

function detectAllGaps(extId) {
  const targets = EXTENSION_TARGETS[extId]
  if (!targets) return []

  const canonical = getCanonicalState()
  const allGaps = []

  // Task Agent is read-only — only check skills/resources for its own skill
  if (extId === "task-agent") {
    // Check if task-agent skill exists (either as directory with SKILL.md or as file)
    const hasSkillDir = exists(path.join(targets.skills, "SKILL.md"))
    const hasSkillFile = exists(path.join(SUPERROO_HOME, "skills", "task-agent.md"))
    if (!hasSkillDir && !hasSkillFile && canonical.skills.total > 0) {
      allGaps.push({
        domain: "skills",
        extId,
        type: "missing_own_skill",
        action: "create_shims",
        safe: true,
      })
    }
    return allGaps
  }

  allGaps.push(
    ...detectLessonsGap(extId, targets, canonical),
    ...detectTasksGap(extId, targets, canonical),
    ...detectSkillsGap(extId, targets, canonical),
    ...detectResourcesGap(extId, targets, canonical),
    ...detectRiskGap(extId, targets, canonical),
    ...detectContextGap(extId, targets, canonical),
    ...detectConfigGap(extId, targets, canonical),
  )

  return allGaps
}

// ── Scan all extensions ───────────────────────────────────────────────────────

function scanEcosystem() {
  const extensions = Object.keys(EXTENSION_TARGETS)
  const matrix = {}
  const summary = {
    totalExtensions: extensions.length,
    totalGaps: 0,
    byDomain: {
      lessons: 0,
      tasks: 0,
      skills: 0,
      resources: 0,
      risk: 0,
      context: 0,
      config: 0,
    },
    safeFixes: 0,
    approvalRequired: 0,
  }

  for (const extId of extensions) {
    const gaps = detectAllGaps(extId)
    matrix[extId] = {
      gaps,
      gapCount: gaps.length,
      safeCount: gaps.filter((g) => g.safe).length,
      approvalCount: gaps.filter((g) => !g.safe).length,
    }

    summary.totalGaps += gaps.length
    for (const gap of gaps) {
      summary.byDomain[gap.domain] = (summary.byDomain[gap.domain] || 0) + 1
      if (gap.safe) summary.safeFixes++
      else summary.approvalRequired++
    }
  }

  return { matrix, summary, extensions }
}

// ── Status text ───────────────────────────────────────────────────────────────

function renderStatus(scanResult) {
  const { matrix, summary, extensions } = scanResult

  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  🌐 Global Sync Status — Cross-Extension Ecosystem")
  log("══════════════════════════════════════════════════════════════")
  log("")
  log(`  Extensions scanned : ${extensions.length}`)
  log(`  Total gaps found   : ${summary.totalGaps}`)
  log(`  Safe to fix        : ${summary.safeFixes}`)
  log(`  Approval required  : ${summary.approvalRequired}`)
  log("")
  log("  Gap breakdown by domain:")
  for (const [domain, count] of Object.entries(summary.byDomain)) {
    log(`    ${domain.padEnd(14)} : ${count}`)
  }
  log("")

  for (const extId of extensions) {
    const ext = matrix[extId]
    if (ext.gapCount === 0) {
      ok(`${extId}: fully synced`)
      continue
    }

    warn(`${extId}: ${ext.gapCount} gaps (${ext.safeCount} safe, ${ext.approvalCount} needs approval)`)

    const byDomain = {}
    for (const gap of ext.gaps) {
      if (!byDomain[gap.domain]) byDomain[gap.domain] = []
      byDomain[gap.domain].push(gap)
    }

    for (const [domain, gaps] of Object.entries(byDomain)) {
      for (const gap of gaps) {
        const marker = gap.safe ? "✅" : "🔶"
        log(`      ${marker} [${domain}] ${gap.type} → ${gap.action}`)
      }
    }
  }

  log("")
}

// ── JSON output ───────────────────────────────────────────────────────────────

function renderJson(scanResult) {
  console.log(JSON.stringify(scanResult, null, 2))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (statusOnly || dryRun || jsonOutput) {
    const scanResult = scanEcosystem()
    if (jsonOutput) renderJson(scanResult)
    else renderStatus(scanResult)
    return
  }

  const scanResult = scanEcosystem()
  if (scanResult.summary.totalGaps === 0) {
    log("✅ All extensions fully synced — no gaps detected.")
    return
  }

  renderStatus(scanResult)
  log("  To fix these gaps:")
  log("    node scripts/global-sync-executor.mjs --force")
  log("  To audit only:")
  log("    node scripts/global-sync-executor.mjs --audit")
}

main().catch((e) => {
  console.error("❌ Global sync engine failed:", e.message)
  process.exit(1)
})
