#!/usr/bin/env node

/**
 * init-project-learning-layer.mjs
 *
 * Generates LEARNING_LAYER.md with learning layer instructions for any project.
 * Run this when starting work on a new project to enable cross-project
 * lesson querying (before coding) and recording (after coding).
 *
 * Usage:
 *   node tools/init-project-learning-layer.mjs [--project-dir <path>] [--project-name <name>]
 *
 *   --project-dir   Path to the project root (default: current working directory)
 *   --project-name  Override auto-detected project name (default: from package.json or directory name)
 *   --force         Overwrite existing LEARNING_LAYER.md without asking
 *   --dry-run       Show what would be written without writing
 */

import { readFileSync, writeFileSync, existsSync, accessSync } from "fs"
import { resolve, basename, join } from "path"

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const projectDir = resolve(
  args.includes("--project-dir")
    ? args[args.indexOf("--project-dir") + 1]
    : process.cwd()
)
const force = args.includes("--force")
const dryRun = args.includes("--dry-run")

// ── Detect project name ─────────────────────────────────────────────────────
let projectName = null
const nameIdx = args.indexOf("--project-name")
if (nameIdx !== -1 && args[nameIdx + 1]) {
  projectName = args[nameIdx + 1]
} else {
  // Try package.json
  const pkgPath = join(projectDir, "package.json")
  try {
    accessSync(pkgPath)
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    projectName = pkg.name || basename(projectDir)
  } catch {
    projectName = basename(projectDir)
  }
}

// ── Detect project type ─────────────────────────────────────────────────────
function detectProjectType(dir) {
  const signals = []
  if (existsSync(join(dir, "package.json"))) signals.push("node")
  if (existsSync(join(dir, "requirements.txt"))) signals.push("python")
  if (existsSync(join(dir, "Cargo.toml"))) signals.push("rust")
  if (existsSync(join(dir, "go.mod"))) signals.push("go")
  if (existsSync(join(dir, "Dockerfile"))) signals.push("docker")
  if (existsSync(join(dir, "docker-compose.yml"))) signals.push("docker-compose")
  if (existsSync(join(dir, ".github/workflows"))) signals.push("github-actions")
  if (existsSync(join(dir, "n8n"))) signals.push("n8n")
  if (existsSync(join(dir, "supabase"))) signals.push("supabase")
  if (existsSync(join(dir, "telegram"))) signals.push("telegram")
  return signals.length > 0 ? signals.join(", ") : "unknown"
}

const projectType = detectProjectType(projectDir)

// ── Detect existing config files ────────────────────────────────────────────
const hasLearningLayerMd = existsSync(join(projectDir, "LEARNING_LAYER.md"))
const hasCodexConfig = existsSync(join(projectDir, ".codex", "config.toml"))
const hasAgentsMd = existsSync(join(projectDir, "AGENTS.md"))
const hasMemoryDir = existsSync(join(projectDir, "memory"))

// ── Build LEARNING_LAYER.md content ─────────────────────────────────────────
const learningLayerMd = `# ${projectName} — Learning Layer Instructions

## Project Overview

<!-- TODO: Describe what this project does -->

**Detected type:** ${projectType}

## Architecture

<!-- TODO: Document key architecture decisions -->

## Learning Layer (Mandatory)

This project uses the SuperRoo cross-project learning layer. Lessons from ALL
SuperRoo projects are searchable and contribute to institutional memory.

### Before Coding — Query Relevant Lessons

Always query the learning layer before starting substantial work:

\`\`\`bash
# Search for lessons related to your task
superroo-learn query "your topic here"

# Check Central Brain connectivity
superroo-learn health

# Search by project (optional)
superroo-learn query "deployment" "superroo2"
\`\`\`

### After Coding — Record Lessons

Always record lessons after completing work:

\`\`\`bash
# Option 1: Manual store (for any change)
superroo-learn store "Short title" "What was learned and why it matters"

# Option 2: Auto-extract from commit (if global hook is installed)
git commit -m "fix: resolved memory leak in WebSocket connection pool"
# The global post-commit hook auto-extracts the lesson
\`\`\`

### Lesson Format

Every lesson should capture:
- **What** was accomplished
- **Why** it was needed (bug cause, feature motivation)
- **How** it was fixed/implemented
- **Reusable rule** for future agents
- **Tags** for searchability

## Key Rules

- ${hasLearningLayerMd ? "Review and update existing LEARNING_LAYER.md" : "Add project-specific rules here"}
- Use \`superroo-learn\` for all learning layer operations
- Keep \`memory/lessons-learned.md\` and \`memory/lesson-index.jsonl\` in sync
- Never commit secrets or API keys

## Quick Start

<!-- TODO: Add setup instructions -->

\`\`\`bash
# Example setup
# npm install
# cp .env.example .env
\`\`\`
`

// ── Write LEARNING_LAYER.md ─────────────────────────────────────────────────
const targetPath = join(projectDir, "LEARNING_LAYER.md")

if (dryRun) {
  console.log(`\n📋 [DRY RUN] Would write to: ${targetPath}`)
  console.log("─".repeat(50))
  console.log(learningLayerMd)
  console.log("─".repeat(50))
  process.exit(0)
}

if (hasLearningLayerMd && !force) {
  console.log(`\n⚠️  LEARNING_LAYER.md already exists at ${targetPath}`)
  console.log("   Use --force to overwrite, or edit manually.")
  console.log("   The existing file already has learning layer instructions.")
  process.exit(0)
}

writeFileSync(targetPath, learningLayerMd, "utf-8")
console.log(`\n✅ Created LEARNING_LAYER.md at ${targetPath}`)

// ── Create memory directory ─────────────────────────────────────────────────
if (!hasMemoryDir) {
  const memoryDir = join(projectDir, "memory")
  try {
    accessSync(memoryDir)
  } catch {
    // Create empty memory files
    writeFileSync(join(memoryDir, "lessons-learned.md"), `# lessons-learned.md\n\n`, "utf-8")
    writeFileSync(join(memoryDir, "lesson-index.jsonl"), "", "utf-8")
    console.log(`   Created memory/ directory with empty lesson files`)
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n📊 Summary:`)
console.log(`   Project:          ${projectName}`)
console.log(`   Directory:        ${projectDir}`)
console.log(`   Type:             ${projectType}`)
console.log(`   LEARNING_LAYER.md: ${hasLearningLayerMd && !force ? "already existed" : "created"}`)
console.log(`   Memory dir:       ${hasMemoryDir ? "already existed" : "created"}`)
console.log(`   Codex config:     ${hasCodexConfig ? "exists (review for learning layer)" : "not found"}`)
console.log(`   AGENTS.md:        ${hasAgentsMd ? "exists (review for learning layer)" : "not found"}`)
console.log(`\n🔍 Next steps:`)
console.log(`   1. Review LEARNING_LAYER.md and fill in TODO sections`)
console.log(`   2. Run: superroo-learn health`)
console.log(`   3. Run: superroo-learn query "initial project scan"`)
console.log(`\n✅ Learning layer initialized for ${projectName}`)
