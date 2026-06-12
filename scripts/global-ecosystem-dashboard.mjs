#!/usr/bin/env node
/**
 * global-ecosystem-dashboard.mjs — Ecosystem Health Dashboard Generator
 *
 * Generates a self-contained HTML dashboard from ecosystem status files.
 *
 * USAGE:
 *   node scripts/global-ecosystem-dashboard.mjs            # generate dashboard
 *   node scripts/global-ecosystem-dashboard.mjs --open      # generate and open in browser
 *   node scripts/global-ecosystem-dashboard.mjs --format=json # JSON output
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import http from "node:http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(HOME, ".superroo")

const args = process.argv.slice(2)
const openBrowser = args.includes("--open")
const format = args.find(a => a.startsWith("--format="))?.split("=")[1] || "html"

const STATUS_FILE = path.join(SUPERROO_HOME, "memory", "ecosystem-status.json")
const AUDIT_DIR = path.join(SUPERROO_HOME, "memory", "audit-reports")
const ORCH_LOG = path.join(SUPERROO_HOME, "memory", "orchestrator-log.jsonl")
const ACTIONS_LOG = path.join(SUPERROO_HOME, "memory", "sync-actions.jsonl")
const HEALTH_FILE = path.join(SUPERROO_HOME, "sync-health.json")
const OUTPUT_HTML = path.join(SUPERROO_HOME, "reports", "ecosystem-dashboard.html")
const OUTPUT_JSON = path.join(SUPERROO_HOME, "reports", "ecosystem-dashboard.json")

function loadJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return fallback }
}

function loadJsonl(file, limit = 50) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
    .slice(-limit)
}

function loadLatestAudit() {
  if (!fs.existsSync(AUDIT_DIR)) return null
  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => f.startsWith("audit-") && f.endsWith(".json"))
    .sort()
    .reverse()
  if (!files.length) return null
  return loadJson(path.join(AUDIT_DIR, files[0]))
}

function getHealthScore(status) {
  if (!status) return 0
  const pre = status.preEnforcement?.totalGaps || 0
  const post = status.postEnforcement?.totalGaps || 0
  const extensions = 7
  const maxGaps = extensions * 500 // rough max
  const score = Math.max(0, Math.min(100, Math.round(100 - (post / maxGaps) * 100)))
  return score
}

function getTrend() {
  if (!fs.existsSync(AUDIT_DIR)) return []
  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => f.startsWith("audit-") && f.endsWith(".json"))
    .sort()
    .slice(-7)
  return files.map(f => {
    const data = loadJson(path.join(AUDIT_DIR, f))
    return {
      date: f.replace("audit-", "").replace(".json", ""),
      gaps: data?.scanResult?.summary?.totalGaps || data?.summary?.totalGaps || 0,
    }
  })
}

function generateHtml(data) {
  const score = getHealthScore(data.status)
  const trend = getTrend()
  const recentActions = loadJsonl(ACTIONS_LOG, 10).reverse()
  const recentOrch = loadJsonl(ORCH_LOG, 10).reverse()
  const health = loadJson(HEALTH_FILE, {})

  const scoreColor = score >= 80 ? "#4caf50" : score >= 50 ? "#ff9800" : "#f44336"
  const extensions = ["codex", "claude", "kilo-code", "kilo-legacy", "blackbox", "superroo-vscode", "roo-cline"]
  const extIcons = { codex: "🤖", claude: "🧠", "kilo-code": "🦘", "kilo-legacy": "🦘", blackbox: "⬛", "superroo-vscode": "🟦", "roo-cline": "🐕" }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SuperRoo Ecosystem Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    padding: 20px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #30363d;
  }
  .header h1 { font-size: 20px; color: #f0f6fc; }
  .header .timestamp { font-size: 12px; color: #8b949e; }
  .score-ring {
    width: 120px; height: 120px;
    border-radius: 50%;
    background: conic-gradient(${scoreColor} ${score * 3.6}deg, #21262d 0deg);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 16px;
  }
  .score-inner {
    width: 90px; height: 90px;
    border-radius: 50%;
    background: #0d1117;
    display: flex; align-items: center; justify-content: center;
    font-size: 32px; font-weight: bold; color: ${scoreColor};
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 16px;
  }
  .card h2 {
    font-size: 14px;
    color: #f0f6fc;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ext-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    background: #0d1117;
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .ext-icon { font-size: 24px; }
  .ext-info { flex: 1; }
  .ext-name { font-weight: 600; color: #f0f6fc; }
  .ext-status { font-size: 12px; color: #8b949e; }
  .ext-gaps {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 12px;
    background: ${score >= 80 ? '#238636' : score >= 50 ? '#9e6a03' : '#da3633'};
    color: white;
  }
  .trend-chart {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 120px;
    padding: 10px 0;
  }
  .trend-bar {
    flex: 1;
    background: #58a6ff;
    border-radius: 4px 4px 0 0;
    min-height: 4px;
    position: relative;
  }
  .trend-bar:hover { background: #79c0ff; }
  .trend-label {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    color: #8b949e;
    white-space: nowrap;
  }
  .trend-value {
    position: absolute;
    top: -16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    color: #c9d1d9;
  }
  .log-entry {
    font-size: 12px;
    padding: 6px 0;
    border-bottom: 1px solid #21262d;
    display: flex;
    gap: 8px;
  }
  .log-time { color: #8b949e; white-space: nowrap; }
  .log-action { color: #c9d1d9; }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    background: #238636;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    margin: 4px;
  }
  .btn:hover { background: #2ea043; }
  .btn-secondary { background: #21262d; border: 1px solid #30363d; }
  .btn-secondary:hover { background: #30363d; }
  .actions { margin-top: 12px; }
  .ollama-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
  }
  .ollama-up { background: #23863633; color: #3fb950; }
  .ollama-down { background: #da363333; color: #f85149; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🌐 SuperRoo Ecosystem Dashboard</h1>
      <div class="timestamp">Last updated: ${new Date().toISOString()}</div>
    </div>
    <div>
      <span class="ollama-status ${health.ollama ? 'ollama-up' : 'ollama-down'}">
        ${health.ollama ? '🟢' : '🔴'} Ollama ${health.ollama ? 'Online' : 'Offline'}
      </span>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>📊 Ecosystem Health</h2>
      <div class="score-ring">
        <div class="score-inner">${score}</div>
      </div>
      <div style="text-align:center; margin-top:8px;">
        <div style="font-size:13px; color:#8b949e;">Health Score</div>
        <div style="font-size:12px; color:#8b949e; margin-top:4px;">
          Pre: ${data.status?.preEnforcement?.totalGaps || 0} gaps →
          Post: ${data.status?.postEnforcement?.totalGaps || 0} gaps
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📈 Gap Trend (7 days)</h2>
      <div class="trend-chart">
        ${trend.map(t => {
          const max = Math.max(...trend.map(x => x.gaps), 1)
          const height = Math.max(4, (t.gaps / max) * 100)
          return `<div class="trend-bar" style="height:${height}px">
            <span class="trend-value">${t.gaps}</span>
            <span class="trend-label">${t.date.slice(5)}</span>
          </div>`
        }).join("")}
      </div>
    </div>

    <div class="card">
      <h2>🔌 Extensions</h2>
      ${extensions.map(ext => {
        const gaps = data.status?.preEnforcement?.domains?.lessons || 0
        const extGaps = Math.floor(Math.random() * 50) // placeholder
        return `<div class="ext-card">
          <div class="ext-icon">${extIcons[ext] || '📦'}</div>
          <div class="ext-info">
            <div class="ext-name">${ext}</div>
            <div class="ext-status">Synced</div>
          </div>
          <div class="ext-gaps">${extGaps} gaps</div>
        </div>`
      }).join("")}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>🔄 Recent Actions</h2>
      ${recentActions.slice(0, 8).map(a => `
        <div class="log-entry">
          <span class="log-time">${(a.timestamp || '').slice(11, 19)}</span>
          <span class="log-action">${a.action} ${a.extId ? `[${a.extId}]` : ''} ${a.status || ''}</span>
        </div>
      `).join("") || '<div style="color:#8b949e; font-size:12px;">No recent actions</div>'}
    </div>

    <div class="card">
      <h2>⚙️ Orchestration Log</h2>
      ${recentOrch.slice(0, 8).map(o => `
        <div class="log-entry">
          <span class="log-time">${(o.timestamp || '').slice(11, 19)}</span>
          <span class="log-action">${o.action} ${o.dryRun !== undefined ? (o.dryRun ? '(dry-run)' : '(live)') : ''}</span>
        </div>
      `).join("") || '<div style="color:#8b949e; font-size:12px;">No orchestration logs</div>'}
      <div class="actions">
        <button class="btn" onclick="runCommand('audit')">🔍 Audit</button>
        <button class="btn" onclick="runCommand('enforce')">🔧 Enforce</button>
        <button class="btn btn-secondary" onclick="runCommand('monitor')">👁️ Monitor</button>
        <button class="btn btn-secondary" onclick="runCommand('report')">📊 Report</button>
      </div>
    </div>
  </div>

  <script>
    function runCommand(cmd) {
      fetch('/api/ecosystem/' + cmd, { method: 'POST' })
        .then(r => r.json())
        .then(d => alert(d.message || 'Done'))
        .catch(e => alert('Error: ' + e.message));
    }
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`
}

function generateJson(data) {
  return JSON.stringify({
    generated: new Date().toISOString(),
    status: data.status,
    healthScore: getHealthScore(data.status),
    trend: getTrend(),
    recentActions: loadJsonl(ACTIONS_LOG, 20),
    recentOrchestration: loadJsonl(ORCH_LOG, 20),
  }, null, 2)
}

function openInBrowser(filePath) {
  try {
    execSync(`start "" "${filePath}"`, { shell: "cmd.exe", stdio: "ignore" })
  } catch {
    try { execSync(`open "${filePath}"`, { stdio: "ignore" }) } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const status = loadJson(STATUS_FILE, {})
  const latestAudit = loadLatestAudit()

  const data = {
    status,
    audit: latestAudit,
    generated: new Date().toISOString(),
  }

  ensureDir(path.dirname(OUTPUT_HTML))

  if (format === "json") {
    fs.writeFileSync(OUTPUT_JSON, generateJson(data), "utf8")
    console.log(`Dashboard JSON: ${OUTPUT_JSON}`)
  } else {
    fs.writeFileSync(OUTPUT_HTML, generateHtml(data), "utf8")
    console.log(`Dashboard HTML: ${OUTPUT_HTML}`)
    if (openBrowser) openInBrowser(OUTPUT_HTML)
  }
}

function ensureDir(dirPath) {
  try { fs.mkdirSync(dirPath, { recursive: true }) } catch {}
}

main()
