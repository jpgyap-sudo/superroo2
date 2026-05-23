#!/usr/bin/env node
import { chromium } from "playwright"
import fs from "fs"
import path from "path"

const BASE_URL = "https://dev.abcx124.xyz/"
const OUT_DIR = path.join(process.cwd(), "cloud", "e2e", "tab-crawl-reports")

const PAGES_TO_TEST = [
  "", "overview", "working-tree", "provider-dashboard", "jobs", "queue",
  "agents", "bugs", "healing", "monitoring", "workflow-compliance",
  "skill-generator", "logs", "docker", "approvals", "api-keys",
  "settings", "ai", "model-router", "github", "ide-terminal",
  "projects", "telegram", "deploy", "auto-deploy", "commit-deploy",
  "debug-team", "intelligence-layer", "brain", "ollama-growth",
  "memory-explorer", "visual-crawler", "parallel-execution",
  "autonomous-loop", "commissioning-loop", "hermes-claw",
  "deploy-orchestrator", "ml-engine", "ram-orchestrator",
  "product-memory", "task-timeline", "collaboration", "mcp-servers", "sandbox"
]

async function testPages() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })
  const page = await context.newPage()

  const results = []

  for (const pageId of PAGES_TO_TEST) {
    const url = pageId ? `${BASE_URL}?page=${pageId}` : BASE_URL
    console.log(`Testing: ${url}`)
    try {
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 })
      await page.waitForTimeout(1000)

      const title = await page.title()
      const bodyText = await page.locator("body").textContent()
      const hasError = bodyText.toLowerCase().includes("error") ||
                       bodyText.toLowerCase().includes("failed") ||
                       bodyText.toLowerCase().includes("something went wrong") ||
                       title.includes("404") || title.includes("Error")

      // Check for visible tabs on this page
      const tabs = await page.locator('[role="tab"], [role="tablist"] button, .tabs button, [class*="tab"]').all()
      const tabTexts = []
      for (const t of tabs.slice(0, 20)) {
        const text = await t.textContent().catch(() => "")
        if (text?.trim()) tabTexts.push(text.trim().slice(0, 40))
      }

      results.push({
        pageId,
        url,
        status: res?.status() || 0,
        title,
        hasError,
        tabCount: tabs.length,
        tabs: tabTexts,
      })

      console.log(`  Status: ${res?.status()}, Title: ${title}, Tabs: ${tabs.length}, Error: ${hasError}`)
    } catch (err) {
      results.push({ pageId, url, status: 0, title: "", hasError: true, error: err.message, tabCount: 0, tabs: [] })
      console.log(`  FAILED: ${err.message}`)
    }
  }

  await browser.close()

  const reportPath = path.join(OUT_DIR, `page-scan-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\nReport saved: ${reportPath}`)
}

testPages().catch(console.error)
