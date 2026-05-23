#!/usr/bin/env node
/**
 * Visual Crawler — Robust Tab Error Detection
 * Navigates directly to each dashboard page and checks for errors.
 */

import { chromium } from "playwright"
import fs from "fs"
import path from "path"

const TARGET_URL = "https://dev.abcx124.xyz/"
const API_URL = "https://dev.abcx124.xyz/api"
const OUT_DIR = path.join(process.cwd(), "cloud", "e2e", "tab-crawl-reports")
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots")

const TEST_EMAIL = `visualcrawler_${Date.now()}@test.local`
const TEST_PASSWORD = "TestPass123!"
const TEST_NAME = "VisualCrawler"

const PAGES = [
  "overview", "provider-dashboard", "working-tree", "jobs", "queue",
  "projects", "agents", "bugs", "healing", "monitoring", "workflow-compliance",
  "skill-generator", "logs", "docker", "approvals", "api-keys",
  "settings", "ai", "model-router", "github", "ide-terminal",
  "telegram", "deploy", "auto-deploy", "commit-deploy",
  "debug-team", "intelligence-layer", "brain", "ollama-growth",
  "memory-explorer", "visual-crawler", "parallel-execution",
  "autonomous-loop", "commissioning-loop", "hermes-claw",
  "deploy-orchestrator", "ml-engine", "ram-orchestrator",
  "product-memory", "task-timeline", "collaboration", "mcp-servers", "sandbox",
]

async function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

async function registerAndLogin() {
  console.log(`Registering test account: ${TEST_EMAIL}`)
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
  })
  const registerData = await registerRes.json()

  if (registerData.ok) {
    console.log("Registration successful!")
    return registerData.token
  }

  console.log(`Registration failed: ${registerData.error}. Trying login...`)
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  const loginData = await loginRes.json()

  if (loginData.ok) {
    console.log("Login successful!")
    return loginData.token
  }

  throw new Error(`Auth failed: ${loginData.error || registerData.error}`)
}

async function testPage(page, token, pageId, index) {
  const url = pageId ? `${TARGET_URL}?page=${pageId}` : TARGET_URL
  const pageLabel = pageId || "home"

  console.log(`\n[${index + 1}/${PAGES.length}] Testing page: ${pageLabel}`)

  // Inject token and navigate
  await page.addInitScript((t) => {
    localStorage.setItem("superroo_auth_token", t)
  }, token)

  let res = null
  try {
    res = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 })
  } catch (err) {
    console.log(`  ⚠️ Navigation timeout/error: ${err.message}`)
  }

  await page.waitForTimeout(2000)

  // Check for Next.js error boundary
  const hasNextError = await page.locator('text=Application error: a client-side exception has occurred').isVisible({ timeout: 1000 }).catch(() => false)

  // Check for other visible errors
  const errorTexts = []
  const errorSelectors = [
    '[role="alert"]',
    '.error',
    '.text-red-500',
    '.text-red-400',
    'text=Error',
    'text=Failed',
    'text=Something went wrong',
    'text=404',
    'text=500',
  ]

  for (const sel of errorSelectors) {
    const els = await page.locator(sel).all()
    for (const el of els) {
      const text = await el.textContent().catch(() => "")
      if (text.trim() && text.trim().length < 300) {
        errorTexts.push({ selector: sel, text: text.trim() })
      }
    }
  }

  // Capture console errors
  const consoleErrors = []
  const consoleHandler = (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  }
  page.on("console", consoleHandler)
  await page.waitForTimeout(500)
  page.off("console", consoleHandler)

  // Capture network errors (last few seconds)
  const networkErrors = []
  const requestHandler = (req) => {
    if (req.failure()) networkErrors.push(`${req.url()} — ${req.failure().errorText}`)
  }
  page.on("requestfailed", requestHandler)
  await page.waitForTimeout(500)
  page.off("requestfailed", requestHandler)

  const hasErrors = hasNextError || errorTexts.length > 0 || consoleErrors.length > 0 || networkErrors.length > 0

  let screenshotPath = null
  if (hasErrors) {
    const safeName = pageLabel.replace(/[^a-z0-9]/gi, "_")
    screenshotPath = path.join(SCREENSHOT_DIR, `page-${index}-${safeName}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`  ❌ ISSUE — screenshot: ${screenshotPath}`)
    if (hasNextError) console.log(`  Next.js error boundary triggered`)
    if (errorTexts.length) console.log(`  Visible errors:`, errorTexts.slice(0, 3))
    if (consoleErrors.length) console.log(`  Console errors (${consoleErrors.length}):`, consoleErrors.slice(0, 3))
    if (networkErrors.length) console.log(`  Network errors (${networkErrors.length}):`, networkErrors.slice(0, 3))
  } else {
    console.log(`  ✅ OK`)
  }

  return {
    pageId,
    url,
    status: res?.status() || 0,
    hasNextError,
    errorTexts: errorTexts.slice(0, 5),
    consoleErrors: consoleErrors.slice(0, 5),
    networkErrors: networkErrors.slice(0, 5),
    screenshot: screenshotPath,
  }
}

async function crawlTabs(token) {
  await ensureDirs()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })

  const results = []
  let index = 0

  for (const pageId of PAGES) {
    const page = await context.newPage()
    try {
      const result = await testPage(page, token, pageId, index)
      results.push(result)
    } catch (err) {
      console.log(`  💥 CRITICAL: ${err.message}`)
      results.push({ pageId, url: `${TARGET_URL}?page=${pageId}`, error: err.message, screenshot: null })
    } finally {
      await page.close()
    }
    index++
  }

  await browser.close()

  const report = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    totalPages: PAGES.length,
    issuesFound: results.filter((r) => r.hasNextError || r.errorTexts?.length > 0 || r.consoleErrors?.length > 0 || r.networkErrors?.length > 0 || r.error).length,
    results,
  }

  const reportPath = path.join(OUT_DIR, `tab-crawl-robust-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`\n============================================`)
  console.log(`Visual Crawl Complete!`)
  console.log(`Total pages tested: ${report.totalPages}`)
  console.log(`Issues found:       ${report.issuesFound}`)
  console.log(`Report saved:       ${reportPath}`)
  console.log(`Screenshots:        ${SCREENSHOT_DIR}`)
  console.log(`============================================`)

  // Print summary of issues
  const issues = results.filter((r) => r.hasNextError || r.errorTexts?.length > 0 || r.consoleErrors?.length > 0 || r.networkErrors?.length > 0 || r.error)
  if (issues.length > 0) {
    console.log(`\n📋 ISSUE SUMMARY:`)
    for (const issue of issues) {
      const reasons = []
      if (issue.hasNextError) reasons.push("Next.js crash")
      if (issue.errorTexts?.length) reasons.push(`visible errors (${issue.errorTexts.length})`)
      if (issue.consoleErrors?.length) reasons.push(`console errors (${issue.consoleErrors.length})`)
      if (issue.networkErrors?.length) reasons.push(`network errors (${issue.networkErrors.length})`)
      if (issue.error) reasons.push(`critical: ${issue.error}`)
      console.log(`  • ${issue.pageId || "home"}: ${reasons.join(", ")}`)
    }
  }
}

async function main() {
  const token = await registerAndLogin()
  await crawlTabs(token)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
