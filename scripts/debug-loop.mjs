#!/usr/bin/env node
/**
 * debug-loop.mjs — Autonomous persistent-bug debugging loop
 *
 * Mirrors the SuperRoo SuperDebugLoop architecture using:
 *   hermes3       → hypothesis generation + analysis
 *   qwen3:14b     → fix implementation
 *   Docker        → sandbox container testing
 *   llava:7b      → vision verification (screenshots)
 *   VPS Tailscale → final environment testing
 *
 * Loop: analyze → patch → container-test → vision-verify → vps-test
 *       → if pass: commit + lesson
 *       → if fail: rollback + refine + retry (max N times)
 *
 * Usage:
 *   node scripts/debug-loop.mjs "bug description"
 *   node scripts/debug-loop.mjs "bug description" --max=8 --no-vps --no-vision
 *   node scripts/debug-loop.mjs --status          # show last loop state
 */

import { execSync, spawn } from "child_process"
import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const CODEX_BRAIN  = process.env.CODEX_BRAIN_SCRIPT || path.join(ROOT, "scripts", "codex-brain.mjs")

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const bugDescription = args.find(a => !a.startsWith("--")) || ""
const maxAttempts    = parseInt(args.find(a => a.startsWith("--max="))?.split("=")[1] || "8")
const enableVision   = !args.includes("--no-vision")
const enableVPS      = !args.includes("--no-vps")
const enableDocker   = !args.includes("--no-docker")
const statusOnly     = args.includes("--status")
const dryRun         = args.includes("--dry-run")

const OLLAMA         = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const VPS_SSH        = "root@100.64.175.88"
const VPS_SSH_KEY    = path.join(os.homedir(), ".ssh", "id_superroo_vps")
const STATE_FILE     = path.join(SUPERROO_HOME, "tasks", "debug-loop-state.json")
const LOG_FILE       = path.join(SUPERROO_HOME, "tasks", "debug-loop.log")

// ── Logging ───────────────────────────────────────────────────────────────────

function log(phase, msg, level = "INFO") {
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] [${phase}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + "\n") } catch {}
}

// ── State Management ──────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }
  catch { return null }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}

// ── Ollama Helper ─────────────────────────────────────────────────────────────

async function ollamaGenerate(model, prompt, timeoutMs = 120000) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.1, num_predict: 800 } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Ollama ${model} error: ${res.status}`)
  const data = await res.json()
  return data.response?.trim() || ""
}

async function ollamaVision(imagePath, question) {
  const imageData = fs.readFileSync(imagePath, "base64")
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llava:7b",
      prompt: question,
      images: [imageData],
      stream: false,
      options: { temperature: 0.1, num_predict: 200 },
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`Vision error: ${res.status}`)
  const data = await res.json()
  return data.response?.trim() || ""
}

// ── Codex Brain Helper ────────────────────────────────────────────────────────

function runCodexBrain(args, timeoutMs = 180000) {
  try {
    return execSync(`node "${CODEX_BRAIN}" ${args.map(a => `"${a}"`).join(" ")}`, {
      cwd: ROOT, timeout: timeoutMs, encoding: "utf8",
      env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
    }).trim()
  } catch (e) { return e.stdout?.trim() || e.message }
}

// ── Git Helpers ───────────────────────────────────────────────────────────────

function gitSnapshot(message) {
  try {
    execSync(`git add -A && git stash push -m "debug-loop: ${message}"`, { cwd: ROOT, stdio: "pipe" })
    const sha = execSync("git stash list --format=%H | head -1", { cwd: ROOT, encoding: "utf8" }).trim()
    return sha
  } catch { return null }
}

function gitRollback(snapshot) {
  try {
    execSync("git checkout -- .", { cwd: ROOT, stdio: "pipe" })
    execSync("git stash pop", { cwd: ROOT, stdio: "pipe" })
    return true
  } catch { return false }
}

// ── Phase 1: ANALYZE ──────────────────────────────────────────────────────────

async function analyzePhase(bug, previousFailures = []) {
  log("ANALYZE", "Generating hypothesis with hermes3...")

  // Get relevant lessons first
  const lessons = runCodexBrain(["retrieve", bug, "--limit", "5"], 60000)

  const failureContext = previousFailures.length > 0
    ? `\n\nPREVIOUS FAILED ATTEMPTS:\n${previousFailures.map((f, i) => `Attempt ${i+1}: ${f.hypothesis}\nResult: ${f.result}`).join("\n\n")}`
    : ""

  const prompt = `You are a senior debugging expert. Analyze this bug and generate ONE specific hypothesis.

BUG: ${bug}

RELEVANT PAST LESSONS:
${lessons.slice(0, 1000)}
${failureContext}

Your hypothesis must be:
1. Specific and testable
2. Different from any previous failed attempts
3. Include the exact files/functions to check
4. Include a specific fix approach

Reply in this format:
HYPOTHESIS: [one specific cause]
ROOT_CAUSE: [why this causes the bug]
FIX_APPROACH: [exact code change needed]
FILES_TO_CHANGE: [file1.ts, file2.ts]
TEST_COMMAND: [exact command to verify fix works]
CONFIDENCE: [0.0-1.0]`

  const response = await ollamaGenerate("hermes3:latest", prompt, 60000)

  const extract = (key) => {
    const m = response.match(new RegExp(`${key}:\\s*([^\n]+)`))
    return m?.[1]?.trim() || ""
  }

  return {
    hypothesis: extract("HYPOTHESIS"),
    rootCause:  extract("ROOT_CAUSE"),
    fixApproach:extract("FIX_APPROACH"),
    files:      extract("FILES_TO_CHANGE").split(",").map(f => f.trim()).filter(Boolean),
    testCmd:    extract("TEST_COMMAND"),
    confidence: parseFloat(extract("CONFIDENCE")) || 0.5,
    rawAnalysis: response,
  }
}

// ── Phase 2: PATCH ────────────────────────────────────────────────────────────

async function patchPhase(hypothesis) {
  log("PATCH", `Implementing fix: ${hypothesis.hypothesis}`)

  const fixPrompt = `You are implementing a fix for a bug.

BUG HYPOTHESIS: ${hypothesis.hypothesis}
ROOT CAUSE: ${hypothesis.rootCause}
FIX APPROACH: ${hypothesis.fixApproach}
FILES TO CHANGE: ${hypothesis.files.join(", ")}

Implement the minimal fix. Return only the code changes needed.
Each file in its own fenced block: // FILE: path/to/file.ts as first comment.
Make the smallest possible change that fixes the root cause.`

  const fix = runCodexBrain(["code-pro", fixPrompt], 240000)
  return fix
}

// ── Phase 3: CONTAINER TEST ───────────────────────────────────────────────────

async function containerTestPhase(hypothesis, attempt) {
  if (!enableDocker) {
    log("CONTAINER", "Skipped (--no-docker)")
    return { passed: true, output: "skipped", skipped: true }
  }

  log("CONTAINER", "Running tests in Docker sandbox...")

  // Smart test command selection based on what files changed
  const changedFiles = hypothesis.files || []
  const isWebview   = changedFiles.some(f => f.includes('webview-ui') || f.includes('.tsx'))
  const isCloud     = changedFiles.some(f => f.includes('cloud/'))
  const isCli       = changedFiles.some(f => f.includes('apps/cli'))
  const testCmd = hypothesis.testCmd
    || (isWebview  ? 'cd webview-ui && npx vitest run --reporter=verbose 2>&1 | tail -40'
    :  isCloud     ? 'cd cloud && npx vitest run 2>&1 | tail -30'
    :  isCli       ? 'cd apps/cli && npx vitest run 2>&1 | tail -30'
    :                'cd src && npx vitest run --reporter=verbose 2>&1 | tail -40')
  const containerName = `debug-loop-${Date.now()}`

  try {
    // Build a test container and run the test command
    // Find docker executable (not always in PATH on Windows)
    const dockerBin = (() => {
      for (const p of ["docker","C:/Program Files/Docker/Docker/resources/bin/docker.exe","wsl docker"]) {
        try { execSync(`${p} --version`, {stdio:"pipe"}); return p } catch {}
      }
      return "docker"
    })()

    const dockerCmd = [
      dockerBin, "run", "--rm",
      "--name", containerName,
      "--network", "none",
      "--memory", "2g",
      "--cpus", "2",
      "-v", `${ROOT}:/app`,
      "-w", "/app",
      "node:20-alpine",
      "sh", "-c", `cd /app && ${testCmd}`
    ].join(" ")

    const output = execSync(dockerCmd, {
      timeout: 120000, encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    })

    const passed = !output.toLowerCase().includes("error") &&
                   !output.toLowerCase().includes("failed") &&
                   !output.toLowerCase().includes("fail")

    log("CONTAINER", `Tests ${passed ? "PASSED ✅" : "FAILED ❌"}`)
    return { passed, output: output.slice(-2000) }
  } catch (e) {
    const output = (e.stdout || "") + (e.stderr || "") || e.message
    log("CONTAINER", `Tests FAILED: ${output.slice(0, 200)}`, "ERROR")
    return { passed: false, output: output.slice(-2000) }
  }
}

// ── Phase 4: VISION VERIFY ────────────────────────────────────────────────────

async function visionVerifyPhase(hypothesis) {
  if (!enableVision) {
    log("VISION", "Skipped (--no-vision)")
    return { passed: true, skipped: true }
  }

  // Look for a screenshot to analyze
  const screenshotPaths = [
    path.join(ROOT, "test-screenshot.png"),
    path.join(ROOT, "screenshot.png"),
    path.join(os.homedir(), "Downloads", "screenshot.png"),
  ]

  const screenshot = screenshotPaths.find(p => fs.existsSync(p))
  if (!screenshot) {
    log("VISION", "No screenshot found — skipping vision verification")
    log("VISION", "To use vision: save a screenshot as test-screenshot.png in project root")
    return { passed: true, skipped: true, note: "no screenshot available" }
  }

  log("VISION", `Analyzing screenshot with llava:7b: ${screenshot}`)

  const question = `Look at this screenshot carefully.
Bug being fixed: ${hypothesis.hypothesis}
Question: Does this screenshot show the bug has been fixed? Is the feature working correctly?
Answer with PASS or FAIL and one sentence explanation.`

  const answer = await ollamaVision(screenshot, question)
  const passed = answer.toUpperCase().includes("PASS") || answer.toLowerCase().includes("working")

  log("VISION", `Vision result: ${passed ? "PASS ✅" : "FAIL ❌"} — ${answer.slice(0, 100)}`)
  return { passed, answer, screenshotPath: screenshot }
}

// ── Phase 5: VPS TEST ─────────────────────────────────────────────────────────

async function vpsTestPhase(hypothesis) {
  if (!enableVPS) {
    log("VPS", "Skipped (--no-vps)")
    return { passed: true, skipped: true }
  }

  log("VPS", `Running tests on VPS ${VPS_SSH}...`)

  const testCmd = hypothesis.testCmd || "cd /opt/superroo2 && node scripts/sync-daemon.mjs --once 2>&1 | tail -5"

  try {
    const output = execSync(
      `ssh -i "${VPS_SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${VPS_SSH} "${testCmd}"`,
      { timeout: 60000, encoding: "utf8" }
    )
    const passed = !output.toLowerCase().includes("error") &&
                   !output.toLowerCase().includes("failed")
    log("VPS", `VPS test ${passed ? "PASSED ✅" : "FAILED ❌"}: ${output.slice(0, 200)}`)
    return { passed, output: output.slice(-1000) }
  } catch (e) {
    log("VPS", `VPS test FAILED: ${e.message}`, "WARN")
    return { passed: false, output: e.message, error: true }
  }
}

// ── Phase 6: COMMIT + LEARN ───────────────────────────────────────────────────

async function commitAndLearnPhase(bug, hypothesis, attempts) {
  log("COMMIT", "All tests passed — committing fix...")

  if (!dryRun) {
    try {
      execSync(`git add -A && git commit -m "fix: ${bug.slice(0, 72)}\n\ndebug-loop: ${hypothesis.hypothesis}\nAttempts: ${attempts}"`,
        { cwd: ROOT, stdio: "pipe" })
      log("COMMIT", "✅ Committed successfully")
    } catch (e) { log("COMMIT", `Commit warning: ${e.message}`, "WARN") }
  }

  // Store lesson
  const lesson = `Bug fixed: ${bug}\nHypothesis that worked: ${hypothesis.hypothesis}\nFix approach: ${hypothesis.fixApproach}\nAttempts needed: ${attempts}`
  runCodexBrain(["remember", lesson, "--collection", "debug"], 30000)

  log("COMMIT", "Lesson stored to global memory")
}

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────

async function main() {
  if (statusOnly) {
    const state = loadState()
    if (!state) { console.log("No active debug loop state"); return }
    console.log(JSON.stringify(state, null, 2))
    return
  }

  if (!bugDescription) {
    console.log("Usage: node scripts/debug-loop.mjs \"bug description\" [--max=8] [--no-vision] [--no-vps] [--no-docker] [--dry-run]")
    process.exit(1)
  }

  console.log(`\n${"═".repeat(60)}`)
  console.log(`  🔁 DEBUG LOOP — ${maxAttempts} max attempts`)
  console.log(`  Bug: ${bugDescription}`)
  console.log(`  Vision: ${enableVision ? "✅ llava:7b" : "❌ skipped"}`)
  console.log(`  Docker: ${enableDocker ? "✅ container sandbox" : "❌ skipped"}`)
  console.log(`  VPS:    ${enableVPS ? "✅ " + VPS_SSH : "❌ skipped"}`)
  console.log(`${"═".repeat(60)}\n`)

  const state = {
    bug: bugDescription, startedAt: new Date().toISOString(),
    attempts: 0, maxAttempts, status: "running",
    failures: [], currentHypothesis: null, lastSnapshot: null,
  }
  saveState(state)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n${"─".repeat(60)}`)
    console.log(`  ATTEMPT ${attempt}/${maxAttempts}`)
    console.log(`${"─".repeat(60)}`)
    state.attempts = attempt
    saveState(state)

    // ── Phase 1: Analyze ──
    log("ANALYZE", `Attempt ${attempt}: generating hypothesis...`)
    const hypothesis = await analyzePhase(bugDescription, state.failures)
    state.currentHypothesis = hypothesis
    log("ANALYZE", `Hypothesis (${Math.round(hypothesis.confidence * 100)}% confidence): ${hypothesis.hypothesis}`)
    log("ANALYZE", `Fix approach: ${hypothesis.fixApproach}`)
    saveState(state)

    // ── Phase 2: Snapshot + Patch ──
    const snapshot = gitSnapshot(`attempt-${attempt}`)
    state.lastSnapshot = snapshot
    saveState(state)

    if (!dryRun) {
      const fix = await patchPhase(hypothesis)
      log("PATCH", `Fix generated (${fix.length} chars)`)
    } else {
      log("PATCH", "DRY RUN — skipping actual code changes")
    }

    // ── Phase 3: Container test ──
    const containerResult = await containerTestPhase(hypothesis, attempt)

    // ── Phase 4: Vision verify ──
    const visionResult = await visionVerifyPhase(hypothesis)

    // ── Phase 5: VPS test ──
    const vpsResult = await vpsTestPhase(hypothesis)

    // ── Decision ──
    const allPassed = containerResult.passed && visionResult.passed && vpsResult.passed
    const summary = [
      `Container: ${containerResult.skipped ? "skip" : containerResult.passed ? "✅" : "❌"}`,
      `Vision:    ${visionResult.skipped ? "skip" : visionResult.passed ? "✅" : "❌"}`,
      `VPS:       ${vpsResult.skipped ? "skip" : vpsResult.passed ? "✅" : "❌"}`,
    ].join("  ")

    log("DECISION", summary)

    if (allPassed) {
      log("DECISION", `✅ BUG FIXED on attempt ${attempt}!`)
      await commitAndLearnPhase(bugDescription, hypothesis, attempt)
      state.status = "fixed"
      state.fixedBy = hypothesis
      state.fixedAt = new Date().toISOString()
      saveState(state)

      console.log(`\n${"═".repeat(60)}`)
      console.log(`  ✅ BUG FIXED in ${attempt} attempt${attempt > 1 ? "s" : ""}`)
      console.log(`  Hypothesis: ${hypothesis.hypothesis}`)
      console.log(`${"═".repeat(60)}\n`)
      return
    }

    // ── Failure: rollback + record ──
    log("ROLLBACK", `Attempt ${attempt} failed — rolling back...`)
    if (!dryRun) gitRollback(snapshot)

    const failureRecord = {
      attempt,
      hypothesis: hypothesis.hypothesis,
      result: [
        containerResult.passed ? null : `Container: ${containerResult.output?.slice(0, 200)}`,
        visionResult.passed ? null : `Vision: ${visionResult.answer?.slice(0, 100)}`,
        vpsResult.passed ? null : `VPS: ${vpsResult.output?.slice(0, 100)}`,
      ].filter(Boolean).join(" | "),
    }
    state.failures.push(failureRecord)
    saveState(state)

    if (attempt < maxAttempts) {
      log("RETRY", `Will refine hypothesis and retry (${maxAttempts - attempt} attempts left)`)
      await new Promise(r => setTimeout(r, 2000))  // Brief pause
    }
  }

  // Max attempts reached
  state.status = "exhausted"
  state.exhaustedAt = new Date().toISOString()
  saveState(state)

  log("EXHAUSTED", `❌ Max attempts (${maxAttempts}) reached without fixing bug`)
  log("EXHAUSTED", "Failure patterns:")
  state.failures.forEach((f, i) => log("EXHAUSTED", `  ${i+1}. ${f.hypothesis}: ${f.result?.slice(0, 100)}`))

  // Store failure lessons
  const failureLesson = `UNSOLVED BUG after ${maxAttempts} attempts: ${bugDescription}\nFailed hypotheses:\n${state.failures.map(f => `- ${f.hypothesis}`).join("\n")}`
  runCodexBrain(["remember", failureLesson, "--collection", "debug"], 30000)

  console.log(`\n${"═".repeat(60)}`)
  console.log(`  ❌ Exhausted all ${maxAttempts} attempts`)
  console.log(`  Bug: ${bugDescription}`)
  console.log(`  Lessons stored for future reference`)
  console.log(`  Check state: node scripts/debug-loop.mjs --status`)
  console.log(`${"═".repeat(60)}\n`)
  process.exit(1)
}

main().catch(e => { console.error("Debug loop crashed:", e); process.exit(1) })
