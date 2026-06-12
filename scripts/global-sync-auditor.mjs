#!/usr/bin/env node
/**
 * global-sync-auditor.mjs — Pure Audit-Only Scanner for Global Sync
 *
 * Scans all extensions and generates structured JSON audit reports.
 * NEVER modifies any files — read-only operation.
 *
 * USAGE:
 *   node scripts/global-sync-auditor.mjs              # full audit
 *   node scripts/global-sync-auditor.mjs --status     # summary only, no file write
 *   node scripts/global-sync-auditor.mjs --export-json # write audit report to file
 *   node scripts/global-sync-auditor.mjs --format=summary|detailed|json
 *   node scripts/global-sync-auditor.mjs --dry-run     # same as audit mode (no writes)
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import http from "node:http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME =
  process.env.SUPERROO_HOME || path.join(HOME, ".superroo")
const ENGINE_SCRIPT = path.join(ROOT, "scripts", "global-sync-engine.mjs")
const AUDIT_REPORTS_DIR = path.join(SUPERROO_HOME, "memory", "audit-reports")
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const OLLAMA_MODEL = process.env.SUPERROO_OLLAMA_MODEL || "qwen3:14b"

const args = process.argv.slice(2)
const statusOnly = args.includes("--status")
const exportJson = args.includes("--export-json")
const dryRun = args.includes("--dry-run")
const formatArg = args.find((a) => a.startsWith("--format="))?.split("=")?.[1] || "summary"

const log = (...a) => console.log(...a)
const warn = (...a) => console.warn("  ⚠️  ", ...a)
const ok = (...a) => console.log("  ✅", ...a)

// ── Ensure audit reports directory exists ──────────────────────────────────────

function ensureAuditDir() {
  try {
    fs.mkdirSync(AUDIT_REPORTS_DIR, { recursive: true })
  } catch {}
}

// ── Run engine scan and capture output ────────────────────────────────────────

function runEngineScan() {
  try {
    const output = spawnSync(
      process.execPath,
      [ENGINE_SCRIPT, "--json"],
      { encoding: "utf8", cwd: ROOT, timeout: 30000, windowsHide: true }
    )
    if (output.status !== 0) {
      warn("Engine returned non-zero:", output.stderr?.slice(0, 200))
      return null
    }
    return JSON.parse(output.stdout)
  } catch (e) {
    warn("Could not run engine scan:", e.message)
    return null
  }
}

// ── Generate audit report ─────────────────────────────────────────────────────

function generateAuditReport(scanResult) {
  const timestamp = new Date().toISOString()
  const dateStr = timestamp.slice(0, 10)

  return {
    auditId: `audit-${dateStr}-${Date.now().toString(36).slice(-6)}`,
    timestamp,
    date: dateStr,
    version: "1.0.0",
    auditor: "global-sync-auditor",
    scanResult,
    summary: {
      totalExtensions: scanResult?.extensions?.length || 0,
      totalGaps: scanResult?.summary?.totalGaps || 0,
      safeFixes: scanResult?.summary?.safeFixes || 0,
      approvalRequired: scanResult?.summary?.approvalRequired || 0,
      domains: scanResult?.summary?.byDomain || {},
    },
    findings: scanResult
      ? generateFindings(scanResult)
      : [],
    recommendations: scanResult
      ? generateRecommendations(scanResult)
      : [],
  }
}

function generateFindings(scanResult) {
  const findings = []
  const { matrix } = scanResult

  for (const [extId, ext] of Object.entries(matrix)) {
    for (const gap of ext.gaps) {
      findings.push({
        extension: extId,
        domain: gap.domain,
        type: gap.type,
        action: gap.action,
        safe: gap.safe,
        details: gap,
      })
    }
  }

  return findings
}

function generateRecommendations(scanResult) {
  const recommendations = []
  const { matrix, summary } = scanResult

  if (summary.totalGaps === 0) {
    return [
      {
        priority: "none",
        action: "no_action",
        reason: "All extensions fully synced",
      },
    ]
  }

  const highPriority = []
  const mediumPriority = []

  for (const [extId, ext] of Object.entries(matrix)) {
    for (const gap of ext.gaps) {
      const rec = {
        extension: extId,
        domain: gap.domain,
        type: gap.type,
        action: gap.action,
        priority: gap.safe ? "medium" : "high",
        reason: gap.safe
          ? "Safe to fix autonomously"
          : "Requires human approval before modification",
      }

      if (rec.priority === "high") highPriority.push(rec)
      else mediumPriority.push(rec)
    }
  }

  recommendations.push(...highPriority.sort((a, b) => a.extension.localeCompare(b.extension)))
  recommendations.push(...mediumPriority.sort((a, b) => a.extension.localeCompare(b.extension)))

  return recommendations
}

// ── Write audit report to file ────────────────────────────────────────────────

function writeAuditReport(report) {
  ensureAuditDir()

  const fileName = `audit-${report.date}.json`
  const filePath = path.join(AUDIT_REPORTS_DIR, fileName)

  const existingReports = []
  if (fs.existsSync(filePath)) {
    try {
      existingReports.push(...JSON.parse(fs.readFileSync(filePath, "utf8")))
    } catch {}
  }

  const allReports = [...existingReports, report]

  fs.writeFileSync(filePath, JSON.stringify(allReports, null, 2), "utf8")
  ok(`Audit report written to: ${filePath}`)

  return filePath
}

// ── Ollama summarization ───────────────────────────────────────────────────────

function ollamaAvailable() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on("error", () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function ollamaSummarize(report) {
  const prompt = `Analyze this Global Sync audit report and produce a concise executive summary.

## Audit Report Summary

- Total extensions: ${report.summary.totalExtensions}
- Total gaps: ${report.summary.totalGaps}
- Safe fixes: ${report.summary.safeFixes}
- Approval required: ${report.summary.approvalRequired}

## Gap Breakdown
${JSON.stringify(report.summary.domains, null, 2)}

## Recommendations
${report.recommendations.slice(0, 5).map(r => `- [${r.priority.toUpperCase()}] ${r.extension}: ${r.type} (${r.action})`).join('\n')}

Write a clear, actionable summary (under 30 lines). Highlight any concerning patterns.
`

  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.3, num_predict: 1024 },
  })

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${OLLAMA_URL}/api/generate`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data)
            resolve(parsed.response || "")
          } catch {
            resolve("")
          }
        })
      }
    )
    req.on("error", reject)
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error("timeout"))
    })
    req.write(body)
    req.end()
  })
}

// ── Render output ───────────────────────────────────────────────────────────────

function renderSummary(report) {
  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  🔍 Global Sync Auditor — Pure Audit Mode")
  log("══════════════════════════════════════════════════════════════")
  log("")
  log(`  Audit ID         : ${report.auditId}`)
  log(`  Timestamp        : ${report.timestamp}`)
  log(`  Extensions       : ${report.summary.totalExtensions}`)
  log(`  Total gaps       : ${report.summary.totalGaps}`)
  log(`  Safe to fix      : ${report.summary.safeFixes}`)
  log(`  Approval required: ${report.summary.approvalRequired}`)
  log("")
  log("  Gap breakdown:")
  for (const [domain, count] of Object.entries(report.summary.domains)) {
    log(`    ${domain.padEnd(14)} : ${count}`)
  }
  log("")

  if (report.summary.totalGaps > 0) {
    log("  Recommendations (top 5):")
    for (const rec of report.recommendations.slice(0, 5)) {
      const marker = rec.priority === "high" ? "🔶" : "🔸"
      log(`    ${marker} [${rec.extension}] ${rec.type} → ${rec.action}`)
    }
    log("")
  }
}

function renderDetailed(report) {
  renderSummary(report)

  log("  Detailed Findings:")
  log("")
  for (const finding of report.findings.slice(0, 20)) {
    const marker = finding.safe ? "✅" : "🔶"
    log(`    ${marker} [${finding.extension}] ${finding.domain}/${finding.type}`)
    log(`        Action: ${finding.action}`)
  }
  if (report.findings.length > 20) {
    log(`    ... and ${report.findings.length - 20} more findings`)
  }
  log("")
}

function renderJson(report) {
  console.log(JSON.stringify(report, null, 2))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("")
  log("══════════════════════════════════════════════════════════════")
  log("  🔍 Global Sync Auditor — Pure Audit Mode (Read-Only)")
  log("══════════════════════════════════════════════════════════════")
  log("")

  // Always audit mode (no modifications)
  const scanResult = runEngineScan()

  if (!scanResult) {
    warn("Could not run engine scan — audit incomplete")
    process.exit(1)
  }

  const report = generateAuditReport(scanResult)

  // Handle output format
  if (formatArg === "json") {
    renderJson(report)
  } else if (formatArg === "detailed") {
    renderDetailed(report)
  } else {
    renderSummary(report)
  }

  // Write audit report if requested (not in --status mode)
  if (exportJson && !statusOnly) {
    const filePath = writeAuditReport(report)
    if (!filePath) {
      warn("Failed to write audit report")
    }
  }

  // Try Ollama summarization
  if (!(await ollamaAvailable())) {
    log("  (Ollama unavailable — using rule-based output)")
    return
  }

  try {
    const summary = await ollamaSummarize(report)
    if (summary && summary.trim().length > 50) {
      log("")
      log("  ── AI Summary ─────────────────────────────────────────────")
      log(summary)
    }
  } catch (e) {
    warn("Ollama summarization failed:", e.message)
  }
}

main().catch((e) => {
  console.error("❌ Auditor failed:", e.message)
  process.exit(1)
})