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
    url: "https://github.com/VoltAgent/voltagent.git",
    description: "AI Agent Engineering Platform — TypeScript agent framework",
    focus: "agent-delegation",
  },
  "aws-remote-swe": {
    url: "https://github.com/aws-samples/remote-swe-agents.git",
    description: "Autonomous SWE agent working in the cloud (AWS)",
    focus: "cloud-deployment",
  },
  "mastra": {
    url: "https://github.com/mastra-ai/mastra.git",
    description: "TypeScript agent framework from the Gatsby team",
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

  // Pattern 4: Deep analysis — key source files
  const deepPatterns = extractDeepPatterns(repoKey, repoDir)
  patterns.push(...deepPatterns)

  return patterns
}

function extractDeepPatterns(repoKey, repoDir) {
  const patterns = []

  // Look for key config files
  const configFiles = [
    "tsconfig.json", "next.config.js", "next.config.ts", "vite.config.ts",
    "turbo.json", "docker-compose.yml", "Dockerfile", ".env.example",
    "eslint.config.mjs", ".prettierrc.json", "vitest.config.ts",
  ]

  const foundConfigs = []
  for (const cf of configFiles) {
    const cfPath = join(repoDir, cf)
    if (existsSync(cfPath)) {
      foundConfigs.push(cf)
    }
  }
  if (foundConfigs.length > 0) {
    patterns.push({
      name: `${repoKey}-config-stack`,
      source: repoKey,
      description: `Config files found: ${foundConfigs.join(", ")}`,
      details: `Indicates tech stack: ${foundConfigs.map(c => c.replace(/\.\w+$/, "")).join(", ")}`,
    })
  }

  // Look for key source directories
  const srcDirs = ["src", "lib", "app", "components", "pages", "api", "routes", "handlers", "services", "agents", "tools"]
  const foundSrcDirs = []
  for (const sd of srcDirs) {
    const sdPath = join(repoDir, sd)
    if (existsSync(sdPath)) {
      foundSrcDirs.push(sd)
    }
  }
  if (foundSrcDirs.length > 0) {
    patterns.push({
      name: `${repoKey}-source-organization`,
      source: repoKey,
      description: `Source directories: ${foundSrcDirs.join(", ")}`,
      details: `Indicates code organization pattern`,
    })
  }

  // Look for test files
  const testDirs = ["test", "tests", "__tests__", "spec", "__mocks__"]
  const foundTestDirs = []
  for (const td of testDirs) {
    const tdPath = join(repoDir, td)
    if (existsSync(tdPath)) {
      foundTestDirs.push(td)
    }
  }
  if (foundTestDirs.length > 0) {
    patterns.push({
      name: `${repoKey}-test-pattern`,
      source: repoKey,
      description: `Test directories: ${foundTestDirs.join(", ")}`,
      details: `Testing approach: ${foundTestDirs.includes("__tests__") ? "colocated" : "dedicated"} test dirs`,
    })
  }

  // Look for CI/CD config
  const cicdPaths = [
    join(repoDir, ".github", "workflows"),
    join(repoDir, ".gitlab-ci.yml"),
    join(repoDir, "Jenkinsfile"),
    join(repoDir, ".circleci", "config.yml"),
  ]
  for (const cp of cicdPaths) {
    if (existsSync(cp)) {
      patterns.push({
        name: `${repoKey}-cicd`,
        source: repoKey,
        description: `CI/CD: ${cp.split(repoDir).pop()}`,
        details: `CI/CD system detected`,
      })
      break
    }
  }

  // Look for docs
  const docDirs = ["docs", "documentation", "wiki"]
  for (const dd of docDirs) {
    const ddPath = join(repoDir, dd)
    if (existsSync(ddPath)) {
      patterns.push({
        name: `${repoKey}-documentation`,
        source: repoKey,
        description: `Documentation directory: ${dd}`,
        details: `Has dedicated docs folder`,
      })
      break
    }
  }

  // Count source files by type
  const extCounts = {}
  function countExts(dir, depth = 0) {
    if (depth > 3) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue
        const fullPath = join(dir, e.name)
        if (e.isDirectory()) {
          countExts(fullPath, depth + 1)
        } else {
          const ext = e.name.split(".").pop()
          extCounts[ext] = (extCounts[ext] || 0) + 1
        }
      }
    } catch {}
  }
  countExts(repoDir)
  if (Object.keys(extCounts).length > 0) {
    const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    patterns.push({
      name: `${repoKey}-language-profile`,
      source: repoKey,
      description: `File type distribution: ${sorted.map(([ext, count]) => `.${ext}: ${count}`).join(", ")}`,
      details: `Primary language: ${sorted[0]?.[0] || "unknown"}`,
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
      const result = allResults[key]
      const score = detectCapability(cap, key, result)
      comparison.matrix[cap][key] = score
    }
  }

  return comparison
}

function detectCapability(capability, repoKey, result) {
  if (!result || !result.structure) return "?"

  const readme = result.structure.readme
  const readmeText = readme ? `${readme.headline} ${readme.hasArchitecture} ${readme.hasApiDocs}`.toLowerCase() : ""
  const dirs = result.structure.dirs || {}
  const dirNames = Object.keys(dirs).join(" ").toLowerCase()
  const pkg = result.structure.package
  const deps = pkg ? Object.keys(pkg.dependencies || {}).join(" ").toLowerCase() : ""
  const allText = `${readmeText} ${dirNames} ${deps}`

  const signals = {
    "event-bus": ["event", "bus", "pubsub", "publish", "subscribe", "websocket", "realtime"],
    "sandboxed-execution": ["sandbox", "docker", "container", "isolated", "safe-exec", "security"],
    "codebase-navigation": ["codebase", "navigation", "search", "file", "repository", "code"],
    "multi-agent": ["multi-agent", "multiagent", "orchestrat", "delegat", "team", "swarm"],
    "tool-routing": ["tool", "routing", "function-call", "mcp", "plugin", "extension"],
    "cloud-deployment": ["cloud", "deploy", "aws", "kubernetes", "k8s", "serverless"],
    "artifact-storage": ["artifact", "storage", "file", "upload", "save", "persist"],
    "plan-execute-verify": ["plan", "execute", "verify", "confirm", "approve", "review"],
    "self-healing": ["heal", "recover", "retry", "fallback", "resilien", "fault"],
    "cross-session-memory": ["memory", "session", "context", "history", "persist", "state"],
  }

  const keywords = signals[capability] || []
  let matchCount = 0
  for (const kw of keywords) {
    if (allText.includes(kw)) matchCount++
  }

  if (matchCount >= 3) return "✅"
  if (matchCount >= 1) return "◐"
  return "?"
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
