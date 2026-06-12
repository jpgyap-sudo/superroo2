#!/usr/bin/env node
/**
 * global-ecosystem-orchestrator.mjs — Master Orchestrator for Global Sync
 *
 * Coordinates all global sync agents in the correct order:
 *   Audit → Report → Enforce → Verify → Report → Monitor
 *
 * USAGE:
 *   node scripts/global-ecosystem-orchestrator.mjs              # full cycle
 *   node scripts/global-ecosystem-orchestrator.mjs --full       # complete cycle (default)
 *   node scripts/global-ecosystem-orchestrator.mjs --audit       # scan only
 *   node scripts/global-ecosystem-orchestrator.mjs --enforce   # fix only
 *   node scripts/global-ecosystem-orchestrator.mjs --monitor   # continuous watch
 *   node scripts/global-ecosystem-orchestrator.mjs --status    # ecosystem health
 *   node scripts/global-ecosystem-orchestrator.mjs --report    # generate report
 *   node scripts/global-ecosystem-orchestrator.mjs --dry-run   # no mutations
 *   node scripts/global-ecosystem-orchestrator.mjs --force     # actually fix
 *   node scripts/global-ecosystem-orchestrator.mjs --once      # single run (monitor mode)
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync, spawn } from "node:child_process"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(HOME, ".superroo")

// Paths to sub-scripts
const SCRIPTS = {
  auditor: path.join(ROOT, "scripts", "global-sync-auditor.mjs"),
  engine: path.join(ROOT, "scripts", "global-sync-engine.mjs"),
  executor: path.join(ROOT, "scripts", "global-sync-executor.mjs"),
  reporter: path.join(ROOT, "scripts", "global-sync-report.mjs"),
  monitor: path.join(ROOT, "scripts", "global-sync-monitor.mjs"),
}

// Output paths
const ECOSYSTEM_STATUS_FILE = path.join(SUPERROO_HOME, "memory", "ecosystem-status.json")
const ORCHESTRATOR_LOG = path.join(SUPERROO_HOME, "memory", "orchestrator-log.jsonl")
const AUDIT_REPORTS_DIR = path.join(SUPERROO_HOME, "memory", "audit-reports")

// CLI args
const args = process.argv.slice(2)
const mode = args.find(a => !a.startsWith("-")) || "full"
const fullMode = mode === "full" || args.includes("--full")
const auditOnly = args.includes("--audit")
const enforceOnly = args.includes("--enforce")
const monitorMode = args.includes("--monitor")
const reportOnly = args.includes("--report")
const statusOnly = args.includes("--status")
const dryRun = args.includes("--dry-run") || !args.includes("--force")
const onceMode = args.includes("--once")
const forceMode = args.includes("--force")

// Logging helpers
const log = (...a) => console.log(...a)
const warn = (...a) => console.warn("  ⚠️  ", ...a)
const ok = (...a) => console.log("  ✅", ...a)
const section = (title) => {
  log("")
  log("══════════════════════════════════════════════════════════════")
  log(`  ${title}`)
  log("══════════════════════════════════════════════════════════════")
  log("")
}

// I/O helpers
function ensureDir(dirPath) {
  try { fs.mkdirSync(dirPath, { recursive: true }) } catch {}
}

function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  fs.writeFileSync(tmpPath, content, "utf8")
  try { fs.renameSync(tmpPath, filePath); return true } catch { return false }
}

function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) } catch { return fallback }
}

function getTimestamp() {
  return new Date().toISOString()
}

// ── Orchestrator logging ───────────────────────────────────────────────────────

function logOrchestration(action, details = {}) {
  ensureDir(path.dirname(ORCHESTRATOR_LOG))
  const entry = {
    timestamp: getTimestamp(),
    action,
    dryRun,
    ...details,
  }
  fs.appendFileSync(ORCHESTRATOR_LOG, JSON.stringify(entry) + "\n", "utf8")
}

// ── Run subprocess and capture output ──────────────────────────────────────────

function runScript(scriptPath, extraArgs = []) {
  const allArgs = [scriptPath, ...extraArgs]
  const result = spawnSync(process.execPath, allArgs, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
  })
  return {
    success: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  }
}

// ── Step 1: Audit ─────────────────────────────────────────────────────────────

function runAudit() {
  logOrchestration("audit_start", { phase: "scanning extensions" })
  // Use engine directly for JSON output
  const result = runScript(SCRIPTS.engine, ["--json"])
  
  if (!result.success) {
    warn("Audit failed:", result.stderr?.slice(0, 200))
    logOrchestration("audit_failed", { error: result.stderr?.slice(0, 200) })
    return null
  }
  
  logOrchestration("audit_complete", { phase: "scanning complete" })
  return JSON.parse(result.stdout)
}

// ── Step 2: Report generation ───────────────────────────────────────────────────

function runReport(auditResult, suffix = "") {
  logOrchestration("report_start", { phase: `generating report${suffix}` })
  const reportPath = path.join(AUDIT_REPORTS_DIR, `ecosystem-${getTimestamp().slice(0, 10)}${suffix}.json`)
  ensureDir(AUDIT_REPORTS_DIR)
  
  const report = {
    reportId: `ecosystem-report-${Date.now().toString(36).slice(-6)}${suffix}`,
    timestamp: getTimestamp(),
    phase: suffix || "pre-enforcement",
    auditResult,
    summary: {
      totalExtensions: auditResult?.extensions?.length || 0,
      totalGaps: auditResult?.summary?.totalGaps || 0,
      safeFixes: auditResult?.summary?.safeFixes || 0,
      approvalRequired: auditResult?.summary?.approvalRequired || 0,
      domains: auditResult?.summary?.byDomain || {},
    },
  }
  
  atomicWrite(reportPath, JSON.stringify(report, null, 2))
  ok(`Report written to: ${reportPath}`)
  logOrchestration("report_complete", { reportPath, gaps: report.summary.totalGaps })
  
  return report
}

// ── Step 3: Enforce fixes ───────────────────────────────────────────────────────

function runEnforce() {
  logOrchestration("enforce_start", { phase: "applying fixes", dryRun })
  
  if (dryRun) {
    log("  🔍 DRY RUN — no files will be modified")
  }
  
  const args = forceMode ? ["--force"] : ["--dry-run"]
  const result = runScript(SCRIPTS.executor, args)
  
  if (!result.success) {
    warn("Enforcement failed:", result.stderr?.slice(0, 200))
    logOrchestration("enforce_failed", { error: result.stderr?.slice(0, 200) })
    return { success: false, output: result.stdout }
  }
  
  ok("Enforcement complete")
  logOrchestration("enforce_complete", { dryRun, success: true })
  return { success: true, output: result.stdout }
}

// ── Step 4: Verify fixes ────────────────────────────────────────────────────────

function runVerify() {
  logOrchestration("verify_start", { phase: "re-running audit to verify fixes" })
  const result = runAudit()
  
  if (!result) {
    logOrchestration("verify_failed", { error: "could not re-audit" })
    return null
  }
  
  logOrchestration("verify_complete", { 
    phase: "verification complete", 
    gapsRemaining: result.summary?.totalGaps || 0 
  })
  return result
}

// ── Step 5: Update ecosystem status ─────────────────────────────────────────────

function updateEcosystemStatus(preAudit, postAudit, enforcementResult) {
  ensureDir(path.dirname(ECOSYSTEM_STATUS_FILE))
  
  const status = {
    lastUpdated: getTimestamp(),
    orchestratorVersion: "1.0.0",
    preEnforcement: {
      totalGaps: preAudit?.summary?.totalGaps || 0,
      safeFixes: preAudit?.summary?.safeFixes || 0,
      approvalRequired: preAudit?.summary?.approvalRequired || 0,
      domains: preAudit?.summary?.byDomain || {},
    },
    postEnforcement: {
      totalGaps: postAudit?.summary?.totalGaps || 0,
      safeFixes: postAudit?.summary?.safeFixes || 0,
      approvalRequired: postAudit?.summary?.approvalRequired || 0,
      domains: postAudit?.summary?.byDomain || {},
    },
    fixesApplied: preAudit && postAudit ? 
      (preAudit.summary?.totalGaps || 0) - (postAudit.summary?.totalGaps || 0) : 0,
    enforcementSuccess: !!enforcementResult?.success,
    dryRun,
  }
  
  atomicWrite(ECOSYSTEM_STATUS_FILE, JSON.stringify(status, null, 2))
  ok(`Ecosystem status updated: ${ECOSYSTEM_STATUS_FILE}`)
  logOrchestration("status_update", { statusFile: ECOSYSTEM_STATUS_FILE })
}

// ── Step 6: Monitor mode ────────────────────────────────────────────────────────

function runMonitor() {
  logOrchestration("monitor_start", { phase: "starting continuous monitoring", onceMode })
  
  const monitorArgs = onceMode ? ["--once"] : []
  if (dryRun) monitorArgs.push("--dry-run")
  
  const proc = spawn(process.execPath, [SCRIPTS.monitor, ...monitorArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
  })
  
  proc.on("close", (code) => {
    logOrchestration("monitor_exit", { code, onceMode })
    process.exit(code || 0)
  })
  
  proc.on("error", (err) => {
    warn("Monitor failed to start:", err.message)
    logOrchestration("monitor_error", { error: err.message })
    process.exit(1)
  })
}

// ── Status display ───────────────────────────────────────────────────────────────

function showStatus() {
  section("🌐 Ecosystem Status")
  
  if (!fs.existsSync(ECOSYSTEM_STATUS_FILE)) {
    warn("No ecosystem status file found — run --audit first")
    return 1
  }
  
  const status = loadJson(ECOSYSTEM_STATUS_FILE)
  
  log(`  Last updated     : ${status.lastUpdated}`)
  log(`  Pre-enforcement gaps : ${status.preEnforcement?.totalGaps || 0}`)
  log(`  Post-enforcement gaps: ${status.postEnforcement?.totalGaps || 0}`)
  log(`  Fixes applied    : ${status.fixesApplied || 0}`)
  log("")
  
  if (status.preEnforcement?.domains) {
    log("  Pre-enforcement gap breakdown:")
    for (const [domain, count] of Object.entries(status.preEnforcement.domains)) {
      log(`    ${domain.padEnd(14)} : ${count}`)
    }
    log("")
  }
  
  if (status.postEnforcement?.domains) {
    log("  Post-enforcement gap breakdown:")
    for (const [domain, count] of Object.entries(status.postEnforcement.domains)) {
      log(`    ${domain.padEnd(14)} : ${count}`)
    }
    log("")
  }
  
  const health = status.postEnforcement?.totalGaps === 0 ? "healthy" : "needs attention"
  const healthIcon = health === "healthy" ? "✅" : "⚠️"
  log(`  Ecosystem health: ${healthIcon} ${health}`)
  
  return status.postEnforcement?.totalGaps > 0 ? 1 : 0
}

// ── Main orchestration flow ───────────────────────────────────────────────────

async function main() {
  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  🌐 Global Ecosystem Orchestrator — Master Coordinator")
  log("══════════════════════════════════════════════════════════════")
  log("")
  
  // Ensure directories exist
  ensureDir(AUDIT_REPORTS_DIR)
  
  // Mode: Monitor
  if (monitorMode) {
    runMonitor()
    return
  }
  
  // Mode: Status only
  if (statusOnly) {
    process.exit(showStatus())
  }
  
  // Mode: Report only
  if (reportOnly) {
    section("📊 Generating Report Only")
    const auditResult = runAudit()
    if (auditResult) {
      runReport(auditResult)
      process.exit(0)
    }
    process.exit(1)
  }
  
  // Mode: Audit only
  if (auditOnly) {
    section("🔍 Audit Only Mode")
    const auditResult = runAudit()
    if (auditResult) {
      runReport(auditResult)
      process.exit(0)
    }
    process.exit(1)
  }
  
  // Mode: Enforce only (requires prior audit)
  if (enforceOnly) {
    section("🔧 Enforce Only Mode")
    const result = runEnforce()
    process.exit(result.success ? 0 : 1)
  }
  
  // Mode: Full pipeline
  if (fullMode) {
    section("🏁 Full Pipeline — Audit → Report → Enforce → Verify → Report")
    
    // Step 1: Audit
    const preAudit = runAudit()
    if (!preAudit) {
      warn("Audit failed — aborting pipeline")
      process.exit(2)
    }
    
    // Step 2: Generate pre-enforcement report
    const preReport = runReport(preAudit, "-pre")
    
    // Step 3: Enforce fixes
    const enforceResult = runEnforce()
    
    // Step 4: Verify fixes
    const postAudit = runVerify()
    
    // Step 5: Generate post-enforcement report
    if (postAudit) {
      runReport(postAudit, "-post")
    }
    
    // Step 6: Update ecosystem status
    updateEcosystemStatus(preAudit, postAudit, enforceResult)
    
    // Final summary
    section("📋 Pipeline Complete")
    log(`  Pre-enforcement gaps    : ${preAudit.summary.totalGaps}`)
    log(`  Post-enforcement gaps   : ${postAudit?.summary?.totalGaps || 0}`)
    log(`  Fixes applied           : ${(preAudit.summary.totalGaps || 0) - (postAudit?.summary?.totalGaps || 0)}`)
    log(`  Enforcement success     : ${enforceResult.success ? "yes" : "no"}`)
    log("")
    
    const exitCode = !enforceResult.success ? 1 : 
      (postAudit?.summary?.totalGaps > 0 ? 1 : 0)
    process.exit(exitCode)
  }
  
  // Default: show help
  log("  Usage: node scripts/global-ecosystem-orchestrator.mjs [options]")
  log("")
  log("  Modes:")
  log("    --full      Complete cycle (default)")
  log("    --audit     Scan only")
  log("    --enforce   Fix only")
  log("    --monitor   Continuous watch")
  log("    --status    Show ecosystem health")
  log("    --report    Generate report")
  log("")
  log("  Flags:")
  log("    --dry-run   No mutations (default)")
  log("    --force     Actually apply fixes")
  log("    --once      Single run (monitor mode)")
  process.exit(0)
}

main().catch((e) => {
  console.error("❌ Orchestrator failed:", e.message)
  logOrchestration("orchestrator_error", { error: e.message })
  process.exit(2)
})