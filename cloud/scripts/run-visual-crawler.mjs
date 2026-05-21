/**
 * Run Visual Crawler — Multi-project visual regression detection
 *
 * Usage:
 *   node cloud/scripts/run-visual-crawler.mjs
 *   node cloud/scripts/run-visual-crawler.mjs --project superroo-dashboard
 *   node cloud/scripts/run-visual-crawler.mjs --project my-other-app --url http://myapp.com
 *
 * Environment variables:
 *   PROJECT_NAME   - Project name from registry (default: superroo-dashboard)
 *   DASHBOARD_URL  - Override base URL for the project
 *   AUTH_TOKEN     - Optional auth token for protected pages
 *   UPDATE_BASELINES - Set to "true" to update baselines instead of comparing
 *   VIEWPORTS      - Comma-separated list of viewport names (default: all)
 *   PAGES          - Comma-separated list of page IDs to crawl (default: all pages for project)
 */

import { runCrawl, listReports, DEFAULT_VIEWPORTS, getProjectRegistry } from "../api/visual-crawler.js"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const fs = await import("fs/promises")
const path = await import("path")

// Parse CLI args
const args = process.argv.slice(2)
const cliProjectIndex = args.indexOf("--project")
const cliProject = cliProjectIndex >= 0 ? args[cliProjectIndex + 1] : null
const cliUrlIndex = args.indexOf("--url")
const cliUrl = cliUrlIndex >= 0 ? args[cliUrlIndex + 1] : null

const PROJECT_NAME = cliProject || process.env.PROJECT_NAME || "superroo-dashboard"
const AUTH_TOKEN = process.env.AUTH_TOKEN || ""
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === "true"
const VIEWPORT_FILTER = process.env.VIEWPORTS
  ? process.env.VIEWPORTS.split(",").map((v) => v.trim())
  : null
const PAGE_FILTER = process.env.PAGES
  ? process.env.PAGES.split(",").map((p) => p.trim())
  : null

// Filter viewports
const viewports = VIEWPORT_FILTER
  ? DEFAULT_VIEWPORTS.filter((vp) => VIEWPORT_FILTER.includes(vp.name))
  : DEFAULT_VIEWPORTS

async function main() {
  // Load project from registry
  const registry = await getProjectRegistry()
  const project = registry.projects.find((p) => p.name === PROJECT_NAME)

  if (!project) {
    console.error(`✗ Project "${PROJECT_NAME}" not found in registry.`)
    console.error(`  Available projects: ${registry.projects.map((p) => p.name).join(", ")}`)
    process.exit(1)
  }

  const baseUrl = cliUrl || process.env.DASHBOARD_URL || project.baseUrl
  const authToken = AUTH_TOKEN || project.authToken

  // Filter pages
  const pages = PAGE_FILTER
    ? project.pages.filter((p) => PAGE_FILTER.includes(p.id))
    : project.pages

  if (pages.length === 0) {
    console.error(`✗ No pages to crawl for project "${PROJECT_NAME}".`)
    console.error(`  Project has ${project.pages.length} pages defined.`)
    if (PAGE_FILTER) {
      console.error(`  Page filter matched none: ${PAGE_FILTER.join(", ")}`)
    }
    process.exit(1)
  }

  console.log("=".repeat(60))
  console.log(`Visual Crawler — ${project.label} (${project.name})`)
  console.log("=".repeat(60))
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Pages: ${pages.length}`)
  console.log(`Viewports: ${viewports.map((v) => v.name).join(", ")}`)
  console.log(`Update Baselines: ${UPDATE_BASELINES}`)
  console.log(`Auth Token: ${authToken ? "✓ provided" : "✗ not provided"}`)
  console.log("")

  const results = []
  let totalIssues = 0

  for (const page of pages) {
    const url = `${baseUrl}/?page=${page.id}`
    console.log(`\n📄 Crawling: ${page.label} (${page.id})`)
    console.log(`   URL: ${url}`)

    try {
      const report = await runCrawl({
        url,
        viewports,
        authToken: authToken || undefined,
        updateBaselines: UPDATE_BASELINES,
        thresholdPercent: 0.5,
        projectName: project.name,
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
  console.log(`Project: ${project.label} (${project.name})`)
  console.log(`Total pages crawled: ${results.filter((r) => !r.error).length}/${pages.length}`)
  console.log(`Total issues found: ${totalIssues}`)
  console.log(`Pages with errors: ${results.filter((r) => r.error).length}`)
  console.log("")

  if (results.filter((r) => !r.error).length > 0) {
    console.log("Results by page:")
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

  // List recent reports for this project
  console.log("\n" + "─".repeat(60))
  console.log(`Recent reports for "${project.name}":`)
  const reports = await listReports(project.name)
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
