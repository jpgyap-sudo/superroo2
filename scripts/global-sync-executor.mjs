#!/usr/bin/env node
/**
 * global-sync-executor.mjs — Autonomous Fix Execution Engine
 *
 * Reads the sync matrix from global-sync-engine.mjs, then applies fixes for
 * all safe gaps. Logs every action to sync-actions.jsonl.
 *
 * USAGE:
 *   node scripts/global-sync-executor.mjs              # dry-run (safe default)
 *   node scripts/global-sync-executor.mjs --status     # show scan only
 *   node scripts/global-sync-executor.mjs --force      # execute ALL safe fixes
 *   node scripts/global-sync-executor.mjs --approve    # include approval-required fixes
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME =
  process.env.SUPERROO_HOME || path.join(HOME, ".superroo")
const ENGINE_SCRIPT = path.join(ROOT, "scripts", "global-sync-engine.mjs")
const SYNC_ACTIONS_LOG = path.join(
  SUPERROO_HOME,
  "memory",
  "sync-actions.jsonl",
)

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run") || !args.includes("--force")
const statusOnly = args.includes("--status")
const auditOnly = args.includes("--audit")
const approveAll = args.includes("--approve")
const extFilterArg = args.find((arg) => arg.startsWith("--ext="))
const extFilter = extFilterArg
  ? new Set(
      extFilterArg
        .slice("--ext=".length)
        .split(",")
        .map((ext) => ext.trim())
        .filter(Boolean),
    )
  : null

// ── Logging ───────────────────────────────────────────────────────────────────

const log = (...a) => console.log(...a)
const warn = (...a) => console.warn("  ⚠️  ", ...a)
const ok = (...a) => console.log("  ✅", ...a)

function logAction(action) {
  const entry = {
    timestamp: new Date().toISOString(),
    agent: "global-sync-executor",
    action: action.type,
    target: action.target,
    extId: action.extId,
    status: action.status,
    result: action.result,
    dryRun: dryRun && !approveAll,
    details: action.details || {},
  }

  const line = JSON.stringify(entry)
  ensureParentDir(SYNC_ACTIONS_LOG)
  fs.appendFileSync(SYNC_ACTIONS_LOG, line + "\n", "utf8")
}

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

function dirCount(dirPath) {
  if (!exists(dirPath)) return 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const CANONICAL = {
  lessonsMd: path.join(SUPERROO_HOME, "memory", "lessons-learned.md"),
  lessonsJsonl: path.join(SUPERROO_HOME, "memory", "lesson-index.jsonl"),
  tasks: path.join(SUPERROO_HOME, "tasks", "global-tasks.json"),
  skills: path.join(SUPERROO_HOME, "skills"),
  resources: path.join(SUPERROO_HOME, "resources"),
  risk: path.join(SUPERROO_HOME, "memory", "predictive-risk", "assessments.jsonl"),
  context: path.join(SUPERROO_HOME, "memory", "context", "latest-agent-context.md"),
  mcp: path.join(SUPERROO_HOME, "mcp"),
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

// ── Load scan results ───────────────────────────────────────────────────────────

function loadEngineState() {
  try {
    const output = spawnSync(
      process.execPath,
      [ENGINE_SCRIPT, "--json"],
      { encoding: "utf8", cwd: ROOT, timeout: 30000, windowsHide: true },
    )
    if (output.status !== 0) {
      warn("Engine returned non-zero:", output.stderr?.slice(0, 200))
      return null
    }
    return JSON.parse(output.stdout)
  } catch (e) {
    warn("Could not load engine state:", e.message)
    return null
  }
}

// ── Fix implementations ───────────────────────────────────────────────────────

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  fs.writeFileSync(tmpPath, content, "utf8")
  try {
    fs.renameSync(tmpPath, filePath)
    return true
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch {}
    throw e
  }
}

// ── Lesson distribution ───────────────────────────────────────────────────────

function importCanonicalTasks(extId, targets) {
  const tasksPath = targets.tasks
  if (!tasksPath) return false

  const canonicalTasks = allTasksFromRegistry(loadJson(CANONICAL.tasks, { tasks: [] }))
  if (canonicalTasks.length === 0) {
    warn("No canonical tasks to import")
    return false
  }

  const existingTasks = allTasksFromRegistry(loadJson(tasksPath, { tasks: [] }))
  if (existingTasks.length > 0) {
    logAction({
      type: "import_tasks",
      extId,
      target: tasksPath,
      status: "skipped",
      result: `target already has ${existingTasks.length} tasks`,
    })
    return true
  }

  if (dryRun) {
    logAction({
      type: "import_tasks",
      extId,
      target: tasksPath,
      status: "dry-run",
      result: `would import ${canonicalTasks.length} canonical tasks`,
    })
    return true
  }

  ensureParentDir(tasksPath)
  atomicWrite(tasksPath, JSON.stringify({
    tasks: canonicalTasks,
    syncedFrom: CANONICAL.tasks,
    syncedAt: new Date().toISOString(),
  }, null, 2) + "\n")
  logAction({
    type: "import_tasks",
    extId,
    target: tasksPath,
    status: "success",
    result: `imported ${canonicalTasks.length} canonical tasks`,
  })
  ok(`Imported ${canonicalTasks.length} canonical tasks to ${tasksPath}`)
  return true
}

function distributeCanonicalLessons(extId, targets) {
  const extLessonsPath = targets.lessons
  if (!extLessonsPath) return false

  // Copy from canonical lesson-index.jsonl
  const canonicalLessons = loadJsonl(CANONICAL.lessonsJsonl)
  if (canonicalLessons.length === 0) {
    warn("No canonical lessons to distribute")
    return false
  }

  if (!exists(extLessonsPath) && !dryRun) {
    // Create new file with canonical lessons
    const content = canonicalLessons.map(l => JSON.stringify(l)).join("\n") + "\n"
    ensureParentDir(extLessonsPath)
    atomicWrite(extLessonsPath, content)
    logAction({
      type: "distribute_lessons",
      extId,
      target: extLessonsPath,
      status: "success",
      result: `created ${canonicalLessons.length} lessons`,
    })
    ok(`Distributed ${canonicalLessons.length} lessons to ${extLessonsPath}`)
  } else if (!dryRun) {
    // Append missing lessons (append-only never overwrites)
    const extLessons = loadJsonl(extLessonsPath)
    const extIds = new Set(extLessons.map(l => l.id || l.canonical_id))
    const missing = canonicalLessons.filter(l => !extIds.has(l.id))

    if (missing.length > 0) {
      const content = "\n" + missing.map(l => JSON.stringify(l)).join("\n") + "\n"
      fs.appendFileSync(extLessonsPath, content, "utf8")
      logAction({
        type: "distribute_lessons",
        extId,
        target: extLessonsPath,
        status: "success",
        result: `appended ${missing.length} lessons`,
      })
      ok(`Appended ${missing.length} lessons to ${extLessonsPath}`)
    }
  }

  if (dryRun) {
    logAction({
      type: "distribute_lessons",
      extId,
      target: extLessonsPath,
      status: "dry-run",
      result: "would distribute lessons",
    })
  }

  return true
}

// ── Skill shims ───────────────────────────────────────────────────────────────

function createSkillShim(extId, canonicalSkillPath, skillName, extSkillDir) {
  const shimPath = path.join(extSkillDir, skillName, "SKILL.md")
  ensureParentDir(shimPath)

  const canonicalExists = exists(canonicalSkillPath)
  const shimContent = `---
name: ${skillName}
description: Pointer shim to canonical SuperRoo skill. Do not edit — source of truth lives in C:/Users/user/.superroo/skills/${skillName}/
---

# ${skillName}

This is a discovery shim for the canonical SuperRoo skill.

**Canonical source:** \`C:/Users/user/.superroo/skills/${skillName}/\`

${canonicalExists ? `Canonical file: \`${canonicalSkillPath}\`` : "Canonical directory does not exist"}

---

Managed by Global Sync Executor. Do not edit this file locally.
`

  if (dryRun) {
    logAction({
      type: "create_shim",
      extId,
      target: shimPath,
      status: "dry-run",
      result: "would create shim",
    })
    return true
  }

  // Only create if doesn't exist (never overwrite)
  if (!exists(shimPath)) {
    atomicWrite(shimPath, shimContent)
    logAction({
      type: "create_shim",
      extId,
      target: shimPath,
      status: "success",
      result: "shim created",
    })
    ok(`Created skill shim: ${shimPath}`)
  } else {
    logAction({
      type: "create_shim",
      extId,
      target: shimPath,
      status: "skipped",
      result: "shim already exists",
    })
  }
  return true
}

function createSkillFilePointer(extId, canonicalSkillPath, skillName, extSkillDir) {
  const shimPath = path.join(extSkillDir, skillName)
  ensureParentDir(shimPath)

  const shimContent = `# ${skillName}

This Blackbox-local file is a pointer only. The canonical SuperRoo skill lives at:

\`\`\`text
${canonicalSkillPath}
\`\`\`

Global skills and resources are created, updated, and queried from:

\`\`\`text
C:/Users/user/.superroo/skills
C:/Users/user/.superroo/resources
\`\`\`

If this pointer conflicts with a SuperRoo skill, the SuperRoo skill wins.
`

  if (dryRun) {
    logAction({
      type: "create_skill_file_pointer",
      extId,
      target: shimPath,
      status: "dry-run",
      result: "would create skill file pointer",
    })
    return true
  }

  if (!exists(shimPath)) {
    atomicWrite(shimPath, shimContent)
    logAction({
      type: "create_skill_file_pointer",
      extId,
      target: shimPath,
      status: "success",
      result: "skill file pointer created",
    })
    ok(`Created skill file pointer: ${shimPath}`)
  } else {
    logAction({
      type: "create_skill_file_pointer",
      extId,
      target: shimPath,
      status: "skipped",
      result: "skill file pointer already exists",
    })
  }
  return true
}

// ── Resource mirrors ──────────────────────────────────────────────────────────

function createResourceMirror(extId, canonicalResPath, resName, extResDir) {
  const mirrorPath = path.join(extResDir, resName)
  ensureParentDir(mirrorPath)

  if (!exists(canonicalResPath)) {
    warn(`Cannot mirror ${canonicalResPath} — canonical file missing`)
    logAction({
      type: "create_mirror",
      extId,
      target: mirrorPath,
      status: "skipped",
      result: "canonical file missing",
    })
    return false
  }

  const content = readFile(canonicalResPath)
  const mirrorContent = `# Mirror of ${resName}

**Canonical source:** \`${canonicalResPath}\`

---

${content}

---

Managed by Global Sync Executor. Canonical always wins.
`

  if (dryRun) {
    logAction({
      type: "create_mirror",
      extId,
      target: mirrorPath,
      status: "dry-run",
      result: "would create mirror",
    })
    return true
  }

  if (!exists(mirrorPath)) {
    atomicWrite(mirrorPath, mirrorContent)
    logAction({
      type: "create_mirror",
      extId,
      target: mirrorPath,
      status: "success",
      result: "mirror created",
    })
    ok(`Created resource mirror: ${mirrorPath}`)
  } else {
    logAction({
      type: "create_mirror",
      extId,
      target: mirrorPath,
      status: "skipped",
      result: "mirror already exists",
    })
  }
  return true
}

// ── Context pointers ───────────────────────────────────────────────────────────

function createContextPointer(extId, extContextPath) {
  ensureParentDir(extContextPath)

  const hasCanonical = exists(CANONICAL.context)
  const pointerContent = `# Agent Context Pointer

**Canonical source:** \`${CANONICAL.context}\`

This file is a pointer to the canonical agent context managed by the Global Sync Executor.
Read the canonical source for latest context.
${hasCanonical ? `Canonical exists at: ${CANONICAL.context}` : "Warning: Canonical context file does not exist yet"}

---

Managed by Global Sync Executor. Do not edit this file locally.
`

  if (dryRun) {
    logAction({
      type: "create_context_pointer",
      extId,
      target: extContextPath,
      status: "dry-run",
      result: "would create pointer",
    })
    return true
  }

  if (!exists(extContextPath)) {
    atomicWrite(extContextPath, pointerContent)
    logAction({
      type: "create_context_pointer",
      extId,
      target: extContextPath,
      status: "success",
      result: "pointer created",
    })
    ok(`Created context pointer: ${extContextPath}`)
  } else {
    logAction({
      type: "create_context_pointer",
      extId,
      target: extContextPath,
      status: "skipped",
      result: "pointer already exists",
    })
  }
  return true
}

// ── Config links ───────────────────────────────────────────────────────────────

function createConfigLink(extId, targetPath) {
  ensureParentDir(targetPath)

  const linkContent = `{
  "_superroo_sync_note": "This config is managed by Global Sync Executor.",
  "canonical_source": "${CANONICAL.mcp}",
  "managed_by": "global-sync-executor v1",
  "sync_timestamp": "${new Date().toISOString()}"
}`

  if (dryRun) {
    logAction({
      type: "create_config_link",
      extId,
      target: targetPath,
      status: "dry-run",
      result: "would create config stub",
    })
    return true
  }

  if (!exists(targetPath)) {
    atomicWrite(targetPath, linkContent)
    logAction({
      type: "create_config_link",
      extId,
      target: targetPath,
      status: "success",
      result: "config stub created",
    })
    ok(`Created config stub: ${targetPath}`)
  } else {
    logAction({
      type: "create_config_link",
      extId,
      target: targetPath,
      status: "skipped",
      result: "config already exists",
    })
  }
  return true
}

// ── Apply fix ─────────────────────────────────────────────────────────────────

function applyFix(gap) {
  const extId = gap.extId
  const targets = EXTENSION_TARGETS[extId]
  if (!targets) {
    warn(`Unknown extension: ${extId}`)
    return false
  }

  const domain = gap.domain
  const actionType = gap.action

  // Special handling for task-agent — it's read-only and only needs its own skill
  if (extId === "task-agent") {
    if (domain === "skills" && actionType === "create_shims") {
      const canonicalSkillPath = path.join(CANONICAL.skills, "task-agent")
      const shimPath = path.join(targets.skills, "SKILL.md")
      // Check if skill already exists (task-agent is canonical, so check for its own file)
      if (exists(shimPath)) {
        logAction({
          type: "create_shim",
          extId,
          target: shimPath,
          status: "skipped",
          result: "skill already exists",
        })
        return true
      }
      createSkillShim(extId, canonicalSkillPath, "task-agent", targets.skills)
      return true
    }
    return false
  }

  switch (domain) {
    case "skills":
      if (actionType === "create_shims" && targets.skills) {
        const skillEntries = exists(CANONICAL.skills)
          ? fs.readdirSync(CANONICAL.skills, { withFileTypes: true })
          : []
        for (const dirent of skillEntries) {
          const canonicalSkillPath = path.join(CANONICAL.skills, dirent.name)
          if (dirent.isDirectory()) {
            createSkillShim(extId, canonicalSkillPath, dirent.name, targets.skills)
          } else if (dirent.isFile()) {
            createSkillFilePointer(extId, canonicalSkillPath, dirent.name, targets.skills)
          }
        }
        return true
      }
      break

    case "resources":
      if (actionType === "create_mirrors" && targets.resources) {
        const resourceFiles = exists(CANONICAL.resources) ? fs.readdirSync(CANONICAL.resources) : []
        for (const file of resourceFiles) {
          const src = path.join(CANONICAL.resources, file)
          if (fs.statSync(src).isFile()) {
            createResourceMirror(extId, src, file, targets.resources)
          }
        }
        return true
      }
      break

    case "context":
      if (actionType === "create_context_pointer" && targets.context) {
        return createContextPointer(extId, targets.context)
      }
      break

    case "config":
      if (actionType === "create_or_link_config" && targets.mcpConfig) {
        return createConfigLink(extId, targets.mcpConfig)
      }
      break

    case "lessons":
      if (actionType === "distribute_from_canonical" || actionType === "full_distribute") {
        distributeCanonicalLessons(extId, targets)
        return true
      }
      break

    case "risk":
      if (actionType === "share_risk_dir") {
        logAction({
          type: "delegate_risk_sync",
          extId,
          target: targets.risk,
          status: dryRun ? "dry-run" : "delegated",
          result: "risk uses shared store via SUPERROO_RISK_DIR",
        })
        return true
      }
      break

    case "tasks":
      if (actionType === "import_canonical") {
        return importCanonicalTasks(extId, targets)
      }
      if (actionType === "mark_stale_warning") {
        logAction({
          type: "task_review",
          extId,
          target: targets.tasks,
          status: "manual_review",
          result: "tasks require manual inspection — not auto-fixed",
        })
        return true
      }
      break

    default:
      warn(`Unsupported fix type: ${domain}/${actionType}`)
      logAction({
        type: "unsupported_fix",
        extId,
        target: "unknown",
        status: "skipped",
        result: `unsupported combination ${domain}/${actionType}`,
      })
      return false
  }

  return false
}

// ── Main execution ────────────────────────────────────────────────────────────

async function main() {
  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  🔧 Global Sync Executor — Autonomous Fix Engine")
  log("══════════════════════════════════════════════════════════════")
  log("")
  if (dryRun && !approveAll) log("  🔍 DRY RUN — no files will be modified")

  if (statusOnly) {
    log("  Use --status with global-sync-engine.mjs for scan-only output")
    return
  }

  const scanResult = loadEngineState()
  if (!scanResult) {
    warn("Could not load scan state from engine. Run engine first.")
    process.exit(1)
  }

  const { matrix } = scanResult
  let totalSafe = 0
  let totalApproval = 0
  let totalFixed = 0
  let totalSkipped = 0

  for (const [extId, ext] of Object.entries(matrix)) {
    if (extFilter && !extFilter.has(extId)) continue
    if (ext.gapCount === 0) continue

    for (const gap of ext.gaps) {
      if (gap.safe) {
        totalSafe++
      } else {
        totalApproval++
        if (!approveAll) {
          logAction({
            type: "approval_required",
            extId,
            target: gap.target || gap.domain,
            status: "awaiting_approval",
            result: "requires human approval",
          })
          log(`  🔶 [${extId}] ${gap.domain}/${gap.type} — approval required`)
          continue
        }
      }

      if (approveAll || gap.safe) {
        const fixed = applyFix(gap)
        if (fixed) totalFixed++
        else totalSkipped++
      }
    }
  }

  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  📋 Execution Summary")
  log("══════════════════════════════════════════════════════════════")
  log("")
  log(`  Safe fixes attempted : ${totalSafe}`)
  log(`  Approval-required    : ${totalApproval}`)
  log(`  Fixed                : ${totalFixed}`)
  log(`  Skipped/unsupported  : ${totalSkipped}`)
  log("")
  log("  Full action log:")
  log(`    ${SYNC_ACTIONS_LOG}`)
  log("")

  if (!dryRun || approveAll) {
    log("  Re-run engine to verify:")
    log(`    node ${ENGINE_SCRIPT} --status`)
  }
}

main().catch((e) => {
  console.error("❌ Executor failed:", e.message)
  process.exit(1)
})
