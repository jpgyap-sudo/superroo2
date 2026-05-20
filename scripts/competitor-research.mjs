#!/usr/bin/env node

/**
 * Competitor Research Script
 *
 * Clones and analyzes competitor repos (OpenHands, SWE-agent, VoltAgent,
 * AWS Remote SWE Agents, Power) and extracts patterns for SuperRoo adoption.
 *
 * Usage:
 *   node scripts/competitor-research.mjs --repo openhands --extract patterns
 *   node scripts/competitor-research.mjs --all --compare
 *   node scripts/competitor-research.mjs --repo swe-agent --extract architecture --focus "codebase-navigation"
 *   node scripts/competitor-research.mjs --all --update-resources
 */

import { execSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const RESEARCH_DIR = join(ROOT, "memory", "competitor-research")
const CLONE_DIR = join(ROOT, "tmp", "competitor-clones")

const REPOS = {
  openhands: {
    url: "https://github.com/all-hands-ai/openhands.git",
    description: "Event-driven agent architecture with sandboxed execution",
    focus: "agent-coordination",
  },
  "swe-agent": {
    url: "https://github.com/SWE-agent/SWE-agent.git",
    description: "Autonomous issue fixing with codebase navigation",
    focus: "codebase-navigation",
  },
  voltagent: {
    url: "https://github.com/VoltAgent-ai/VoltAgent.git",
    description: "Multi-agent orchestration platform",
    focus: "agent-delegation",
  },
  "aws-remote-swe": {
    url: "https://github.com/awslabs/aws-remote-swe-agent.git",
    description: "Cloud-native SWE agent with AWS deployment",
    focus: "cloud-deployment",
  },
  power: {
    url: "https://github.com/run-power/power.git",
    description: "Composable agent framework",
    focus: "plan-execute-verify",
  },
}

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`)
}

function run(cmd, cwd = ROOT) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe", timeout: 120000 })
  } catch (err) {
    log("warn", `Command failed (non-fatal): ${cmd.slice(0, 80)}... — ${err.message}`)
    return ""
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function cloneRepo(repoKey) {
  const repo = REPOS[repoKey]
  if (!repo) throw new Error(`Unknown repo: ${repoKey}`)

  const targetDir = join(CLONE_DIR, repoKey)
  if (existsSync(targetDir)) {
    log("info", `${repoKey} already cloned, pulling latest...`)
    run("git pull", targetDir)
    return targetDir
  }

  ensureDir(CLONE_DIR)
  log("info", `Cloning ${repoKey} from ${repo.url}...`)
  run(`git clone --depth 1 ${repo.url} ${targetDir}`)
  return targetDir
}

function analyzeStructure(repoDir) {
  const structure = {}

  // README
  const readmePath = join(repoDir, "README.md")
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8")
    structure.readme = {
      length: readme.length,
      lines: readme.split("\n").length,
      headline: readme.split("\n")[0] || "",
      hasInstallGuide: readme.includes("install") || readme.includes("Install"),
      hasArchitecture: readme.includes("architecture") || readme.includes("Architecture"),
      hasApiDocs: readme.includes("API") || readme.includes("api"),
    }
  }

  // package.json
  const pkgPath = join(repoDir, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      structure.package = {
        name: pkg.name,
        version: pkg.version,
        dependencies: Object.keys(pkg.dependencies || {}).length,
        devDependencies: Object.keys(pkg.devDependencies || {}).length,
        scripts: Object.keys(pkg.scripts || {}),
      }
    } catch {}
  }

  // Directory structure (top 2 levels)
  structure.dirs = listDirStructure(repoDir, 2)

  return structure
}

function listDirStructure(dir, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return null
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const result = {}
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      if (entry.isDirectory()) {
        const sub = listDirStructure(join(dir, entry.name), maxDepth, currentDepth + 1)
        if (sub && Object.keys(sub).length > 0) {
          result[entry.name] = sub
        } else {
          result[entry.name] = "📁"
        }
      }
    }
    return result
  } catch {
    return null
  }
}

function extractPatterns(repoKey, repoDir, structure) {
  const patterns = []
  const repo = REPOS[repoKey]

  // Pattern 1: Architecture pattern from directory structure
  const dirs = structure.dirs || {}
  const topDirs = Object.keys(dirs)
  if (topDirs.length > 0) {
    patterns.push({
      name: `${repoKey}-directory-architecture`,
      source: repoKey,
      description: `Directory structure suggests ${topDirs.slice(0, 5).join(", ")} architecture`,
      details: `Top-level directories: ${topDirs.join(", ")}`,
    })
  }

  // Pattern 2: Scripts from package.json
  if (structure.package?.scripts) {
    patterns.push({
      name: `${repoKey}-build-patterns`,
      source: repoKey,
      description: `Build scripts: ${structure.package.scripts.join(", ")}`,
      details: `${structure.package.dependencies} deps, ${structure.package.devDependencies} devDeps`,
    })
  }

  // Pattern 3: README positioning
  if (structure.readme) {
    patterns.push({
      name: `${repoKey}-readme-positioning`,
      source: repoKey,
      description: `README headline: "${structure.readme.headline.slice(0, 100)}"`,
      details: `${structure.readme.lines} lines, hasArchitecture=${structure.readme.hasArchitecture}, hasApiDocs=${structure.readme.hasApiDocs}`,
    })
  }

  return patterns
}

function generateComparison(allResults) {
  const comparison = {
    generated: new Date().toISOString(),
    repos: {},
    matrix: {},
  }

  for (const [key, result] of Object.entries(allResults)) {
    comparison.repos[key] = {
      url: REPOS[key]?.url,
      description: REPOS[key]?.description,
      patterns: result.patterns?.length || 0,
      structure: result.structure?.package?.name || "unknown",
    }
  }

  // Build capability matrix
  const capabilities = [
    "event-bus",
    "sandboxed-execution",
    "codebase-navigation",
    "multi-agent",
    "tool-routing",
    "cloud-deployment",
    "artifact-storage",
    "plan-execute-verify",
    "self-healing",
    "cross-session-memory",
  ]

  comparison.matrix = {}
  for (const cap of capabilities) {
    comparison.matrix[cap] = {}
    for (const key of Object.keys(REPOS)) {
      comparison.matrix[cap][key] = "?"
    }
  }

  return comparison
}

function saveResults(repoKey, data) {
  ensureDir(RESEARCH_DIR)
  const filePath = join(RESEARCH_DIR, `${repoKey}.json`)
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
  log("info", `Saved research results to ${filePath}`)
  return filePath
}

function saveComparison(comparison) {
  ensureDir(RESEARCH_DIR)
  const filePath = join(RESEARCH_DIR, "comparison.json")
  writeFileSync(filePath, JSON.stringify(comparison, null, 2), "utf8")
  log("info", `Saved comparison to ${filePath}`)
  return filePath
}

function printResults(repoKey, data) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  📊 Research Results: ${repoKey}`)
  console.log(`${"=".repeat(60)}`)
  console.log(`  URL:        ${REPOS[repoKey]?.url}`)
  console.log(`  Focus:      ${REPOS[repoKey]?.focus}`)
  console.log(`  Patterns:   ${data.patterns?.length || 0} extracted`)
  console.log(`  Structure:  ${data.structure?.package?.name || "unknown"}`)
  console.log(`  README:     ${data.structure?.readme?.lines || 0} lines`)

  if (data.patterns?.length > 0) {
    console.log(`\n  📋 Patterns:`)
    for (const p of data.patterns) {
      console.log(`    • ${p.name}`)
      console.log(`      ${p.description}`)
    }
  }
  console.log("")
}

function printComparison(comparison) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  📊 Competitor Comparison Matrix`)
  console.log(`${"=".repeat(60)}`)

  const headers = Object.keys(comparison.repos)
  console.log(`  ${"Capability".padEnd(25)} | ${headers.map(h => h.padEnd(14)).join(" | ")}`)
  console.log(`  ${"-".repeat(25)}-+-${headers.map(() => "-".repeat(14)).join("-+-")}`)

  for (const [cap, row] of Object.entries(comparison.matrix)) {
    console.log(`  ${cap.padEnd(25)} | ${headers.map(h => (row[h] || "?").padEnd(14)).join(" | ")}`)
  }
  console.log("")
}

async function main() {
  const args = process.argv.slice(2)
  const repoFlag = args.indexOf("--repo")
  const extractFlag = args.indexOf("--extract")
  const focusFlag = args.indexOf("--focus")
  const allFlag = args.includes("--all")
  const compareFlag = args.includes("--compare")
  const updateResourcesFlag = args.includes("--update-resources")

  const repoKey = repoFlag >= 0 ? args[repoFlag + 1] : null
  const extractType = extractFlag >= 0 ? args[extractFlag + 1] : "patterns"
  const focus = focusFlag >= 0 ? args[focusFlag + 1] : null

  if (!repoKey && !allFlag) {
    console.log(`
Usage:
  node scripts/competitor-research.mjs --repo <name> [--extract patterns|architecture] [--focus <area>]
  node scripts/competitor-research.mjs --all [--compare] [--update-resources]

Repos:
${Object.entries(REPOS)
  .map(([k, v]) => `  ${k.padEnd(20)} ${v.url}`)
  .join("\n")}
`)
    process.exit(0)
  }

  const targets = allFlag ? Object.keys(REPOS) : [repoKey]
  const allResults = {}

  for (const key of targets) {
    if (!REPOS[key]) {
      log("error", `Unknown repo: ${key}. Valid: ${Object.keys(REPOS).join(", ")}`)
      continue
    }

    log("info", `Researching ${key}...`)

    // Phase 1: Clone
    const repoDir = cloneRepo(key)

    // Phase 2: Analyze structure
    const structure = analyzeStructure(repoDir)
    log("info", `${key}: ${structure.dirs ? Object.keys(structure.dirs).length + " top-level dirs" : "no dirs"}`)

    // Phase 3: Extract patterns
    const patterns = extractPatterns(key, repoDir, structure)

    const result = {
      repo: key,
      url: REPOS[key].url,
      focus: focus || REPOS[key].focus,
      analyzed: new Date().toISOString(),
      structure,
      patterns,
    }

    allResults[key] = result
    saveResults(key, result)
    printResults(key, result)
  }

  // Phase 4: Comparison
  if (compareFlag || allFlag) {
    const comparison = generateComparison(allResults)
    saveComparison(comparison)
    printComparison(comparison)
  }

  // Phase 5: Update global resources
  if (updateResourcesFlag) {
    log("info", "Updating global resources...")
    const resourcesPath = join(ROOT, "..", "..", ".claude", "guides", "superroo-resources.md")
    if (existsSync(resourcesPath)) {
      log("info", `Global resources found at ${resourcesPath}`)
      // The comparison data is already saved — the agent can reference it
    } else {
      log("warn", "Global resources file not found")
    }
  }

  log("info", "Research complete.")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
