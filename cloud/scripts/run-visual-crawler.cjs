/**
 * Run Visual Crawler — Capture baselines for all dashboard views
 *
 * Usage:
 *   node cloud/scripts/run-visual-crawler.cjs
 *
 * Environment variables:
 *   DASHBOARD_URL  - Dashboard URL (default: http://100.64.175.88:3001)
 *   AUTH_TOKEN     - Optional auth token for protected pages
 *   UPDATE_BASELINES - Set to "true" to update baselines instead of comparing
 *   VIEWPORTS      - Comma-separated list of viewport names (default: all)
 *   SKIP_OLLAMA    - Set to "true" to skip Ollama analysis (faster)
 */

const { runCrawl, listReports, DEFAULT_VIEWPORTS } = require("../api/visual-crawler.js")

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://100.64.175.88:3001"
const AUTH_TOKEN = process.env.AUTH_TOKEN || ""
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === "true"
const SKIP_OLLAMA = process.env.SKIP_OLLAMA === "true"
const VIEWPORT_FILTER = process.env.VIEWPORTS
  ? process.env.VIEWPORTS.split(",").map((v) => v.trim())
  : null

// All dashboard pages to crawl
const DASHBOARD_PAGES = [
  { id: "overview", label: "Overview" },
  { id: "working-tree", label: "Working Tree" },
  { id: "provider-dashboard", label: "Provider Dashboard" },
  { id: "jobs", label: "Jobs" },
  { id: "queue", label: "Queue" },
  { id: "agents", label: "Agents" },
  { id: "bugs", label: "Bugs" },
  { id: "healing", label: "Healing" },
  { id: "monitoring", label: "Monitoring" },
  { id: "workflow-compliance", label: "Workflow Compliance" },
  { id: "skill-generator", label: "Skill Generator" },
  { id: "logs", label: "Logs" },
  { id: "docker", label: "Docker" },
  { id: "approvals", label: "Approvals" },
  { id: "api-keys", label: "API Keys" },
  { id: "settings", label: "Settings" },
  { id: "ai", label: "AI Assistant" },
  { id: "model-router", label: "Model Router" },
  { id: "github", label: "GitHub" },
  { id: "ide-terminal", label: "IDE Terminal" },
  { id: "projects", label: "Projects" },
  { id: "telegram", label: "Telegram" },
  { id: "deploy", label: "Deploy" },
  { id: "auto-deploy", label: "Auto Deploy" },
  { id: "commit-deploy", label: "Commit & Deploy" },
  { id: "debug-team", label: "Debug Team" },
  { id: "intelligence-layer", label: "Intelligence Layer" },
  { id: "brain", label: "Brain" },
  { id: "ollama-growth", label: "Ollama Growth" },
  { id: "memory-explorer", label: "Memory Explorer" },
  { id: "visual-crawler", label: "Visual Crawler" },
  { id: "parallel-execution", label: "Parallel Execution" },
  { id: "autonomous-loop", label: "Autonomous Loop" },
  { id: "commissioning-loop", label: "Commissioning Loop" },
  { id: "hermes-claw", label: "Hermes Claw" },
  { id: "deploy-orchestrator", label: "Deploy Orchestrator" },
  { id: "ml-engine", label: "ML Engine" },
  { id: "ram-orchestrator", label: "RAM Orchestrator" },
  { id: "product-memory", label: "Product Memory" },
  { id: "task-timeline", label: "Task Timeline" },
  { id: "collaboration", label: "Collaboration" },
  { id: "mcp-servers", label: "MCP Servers" },
  { id: "sandbox", label: "Sandbox" },
]

// Filter viewports
const viewports = VIEWPORT_FILTER
  ? DEFAULT_VIEWPORTS.filter((vp) => VIEWPORT_FILTER.includes(vp.name))
  : DEFAULT_VIEWPORTS

async function main() {
  console.log("=".repeat(60))
  console.log("Visual Crawler — Dashboard E2E")
  console.log("=".repeat(60))
  console.log(`Dashboard URL: ${DASHBOARD_URL}`)
  console.log(`Viewports: ${viewports.map((v) => v.name).join(", ")}`)
  console.log(`Update Baselines: ${UPDATE_BASELINES}`)
  console.log(`Skip Ollama: ${SKIP_OLLAMA}`)
  console.log(`Auth Token: ${AUTH_TOKEN ? "✓ provided" : "✗ not provided"}`)
  console.log("")

  const results = []
  let totalIssues = 0

  for (const page of DASHBOARD_PAGES) {
    const url = `${DASHBOARD_URL}/?page=${page.id}`
    console.log(`\n📄 Crawling: ${page.label} (${page.id})`)
    console.log(`   URL: ${url}`)

    try {
      const report = await runCrawl({
        url,
        viewports,
        authToken: AUTH_TOKEN || undefined,
        updateBaselines: UPDATE_BASELINES,
        thresholdPercent: 0.5,
      })

      const issues = report.results.filter((r) => r.analysis && r.analysis.isBug)
      const newBaselines = report.results.filter((r) => r.comparison && r.comparison.isNewBaseline)
      const matches = report.results.filter((r) => r.comparison && r.comparison.match && !r.comparison.isNewBaseline)
      const diffs = report.results.filter((r) => r.comparison && !r.comparison.match && !r.comparison.isNewBaseline)

      console.log(`   ✓ Report: ${report.crawlId}`)
      console.log(`   Viewports tested: ${report.viewportsTested}`)
      console.log(`   New baselines: ${newBaselines.length}`)
      console.log(`   Matches: ${matches.length}`)
      console.log(`   Diffs: ${diffs.length}`)
      console.log(`   Issues found: ${issues.length}`)

      if (issues.length > 0) {
        totalIssues += issues.length
        for (const issue of issues) {
          console.log(`   ⚠ Issue in ${issue.viewport}: ${issue.analysis?.summary || "Unknown"}`)
          if (issue.analysis?.severity) {
            console.log(`     Severity: ${issue.analysis.severity}`)
          }
          if (issue.analysis?.details) {
            console.log(`     Details: ${issue.analysis.details}`)
          }
        }
      }

      results.push({
        page: page.id,
        label: page.label,
        crawlId: report.crawlId,
        viewportsTested: report.viewportsTested,
        issuesFound: report.issuesFound,
        newBaselines: newBaselines.length,
        matches: matches.length,
        diffs: diffs.length,
      })
    } catch (err) {
      console.error(`   ✗ Error crawling ${page.label}: ${err.message}`)
      results.push({
        page: page.id,
        label: page.label,
        error: err.message,
      })
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Total pages crawled: ${results.filter((r) => !r.error).length}/${DASHBOARD_PAGES.length}`)
  console.log(`Total issues found: ${totalIssues}`)
  console.log(`Pages with errors: ${results.filter((r) => r.error).length}`)
  console.log("")

  if (results.filter((r) => !r.error).length > 0) {
    console.log("\nResults by page:")
    console.log("─".repeat(60))
    for (const r of results) {
      if (r.error) {
        console.log(`  ✗ ${r.label.padEnd(25)} ERROR: ${r.error}`)
      } else {
        const status = r.issuesFound > 0 ? "⚠" : "✓"
        console.log(`  ${status} ${r.label.padEnd(25)} baselines:${r.newBaselines} matches:${r.matches} diffs:${r.diffs} issues:${r.issuesFound}`)
      }
    }
  }

  // List all reports
  console.log("\n" + "─".repeat(60))
  console.log("All saved reports:")
  const reports = await listReports()
  for (const r of reports.slice(0, 10)) {
    console.log(`  ${r.timestamp} | ${r.url} | ${r.viewportsTested} viewports | ${r.issuesFound} issues`)
  }
  if (reports.length > 10) {
    console.log(`  ... and ${reports.length - 10} more`)
  }

  console.log("\n✅ Visual crawl complete!")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
