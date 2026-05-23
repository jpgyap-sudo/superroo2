#!/usr/bin/env node
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

async function registerAndLogin() {
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
  })
  const registerData = await registerRes.json()
  if (registerData.ok) return registerData.token

  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  const loginData = await loginRes.json()
  if (loginData.ok) return loginData.token
  throw new Error(`Auth failed`)
}

async function testPage(browser, token, pageId, index) {
  const url = pageId ? `${TARGET_URL}?page=${pageId}` : TARGET_URL
  const pageLabel = pageId || "home"
  const page = await browser.newPage()

  await page.addInitScript((t) => {
    localStorage.setItem("superroo_auth_token", t)
  }, token)

  let navError = null
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 12000 })
  } catch (err) {
    navError = err.message
    try {
      await page.goto(url, { waitUntil: "load", timeout: 8000 })
    } catch {}
  }
  await page.waitForTimeout(500)

  const hasNextError = await page.locator('text=Application error: a client-side exception has occurred').isVisible({ timeout: 500 }).catch(() => false)

  // Gather real error indicators (not status badges)
  const errorTexts = []
  const errorEls = await page.locator('[role="alert"]').all()
  for (const el of errorEls) {
    const text = await el.textContent().catch(() => "")
    if (text.trim()) errorTexts.push(text.trim().slice(0, 200))
  }

  // Check for "Failed to load" or "Unauthorized" messages
  const bodyText = await page.locator("body").textContent().catch(() => "")
  const realErrors = []
  if (bodyText.includes("Failed to load")) {
    const match = bodyText.match(/Failed to load[^\n.]{0,200}/)
    if (match) realErrors.push(match[0])
  }
  if (bodyText.includes("Unauthorized. Please sign in again.")) {
    realErrors.push("Unauthorized. Please sign in again.")
  }
  if (bodyText.includes("HTTP 404")) {
    realErrors.push("HTTP 404")
  }

  const consoleErrors = []
  const handler = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()) }
  page.on("console", handler)
  await page.waitForTimeout(400)
  page.off("console", handler)

  const jsCrashes = consoleErrors.filter(e => e.includes("TypeError") || e.includes("ReferenceError") || e.includes("Cannot read") || e.includes("undefined"))
  const serverErrors = consoleErrors.filter(e => e.includes("500") || e.includes("401"))

  const hasRealError = hasNextError || errorTexts.length > 0 || realErrors.length > 0 || jsCrashes.length > 0 || serverErrors.length > 0 || navError?.includes("timeout")

  let screenshotPath = null
  if (hasRealError) {
    const safeName = pageLabel.replace(/[^a-z0-9]/gi, "_")
    screenshotPath = path.join(SCREENSHOT_DIR, `page-${index}-${safeName}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
  }

  await page.close()

  return {
    pageId,
    url,
    navError,
    hasNextError,
    errorTexts,
    realErrors: [...new Set(realErrors)].slice(0, 3),
    jsCrashes: [...new Set(jsCrashes)].slice(0, 3),
    serverErrors: [...new Set(serverErrors)].slice(0, 3),
    screenshot: screenshotPath,
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  const token = await registerAndLogin()
  const browser = await chromium.launch({ headless: true })

  const results = []
  for (let i = 0; i < PAGES.length; i++) {
    const res = await testPage(browser, token, PAGES[i], i)
    const hasIssue = res.hasNextError || res.errorTexts.length > 0 || res.realErrors.length > 0 || res.jsCrashes.length > 0 || res.serverErrors.length > 0 || res.navError
    results.push(res)
    console.log(`${hasIssue ? '❌' : '✅'} [${i + 1}/${PAGES.length}] ${res.pageId || 'home'}${hasIssue ? ' — ISSUE' : ''}`)
    if (res.navError) console.log(`   Nav timeout: ${res.navError.slice(0, 60)}`)
    if (res.hasNextError) console.log(`   Next.js crash`)
    if (res.errorTexts.length) console.log(`   Alerts:`, res.errorTexts.slice(0, 2))
    if (res.realErrors.length) console.log(`   Errors:`, res.realErrors.slice(0, 2))
    if (res.jsCrashes.length) console.log(`   JS crash:`, res.jsCrashes[0].slice(0, 100))
    if (res.serverErrors.length) console.log(`   Server:`, res.serverErrors.slice(0, 2))
  }

  await browser.close()

  const report = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    totalPages: PAGES.length,
    issuesFound: results.filter((r) => r.hasNextError || r.errorTexts.length > 0 || r.realErrors.length > 0 || r.jsCrashes.length > 0 || r.serverErrors.length > 0 || r.navError).length,
    results,
  }

  const reportPath = path.join(OUT_DIR, `tab-crawl-final-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`\n========== VISUAL CRAWL COMPLETE ==========`)
  console.log(`Pages tested: ${report.totalPages}`)
  console.log(`Issues found: ${report.issuesFound}`)
  console.log(`Report: ${reportPath}`)

  console.log(`\n📋 CONFIRMED BUGS:`)
  const realBugs = results.filter((r) => r.hasNextError || r.errorTexts.length > 0 || r.realErrors.length > 0 || r.jsCrashes.length > 0 || r.serverErrors.length > 0 || r.navError)
  for (const b of realBugs) {
    const reasons = []
    if (b.navError) reasons.push("nav timeout")
    if (b.hasNextError) reasons.push("Next.js crash")
    if (b.errorTexts.length) reasons.push(b.errorTexts[0])
    if (b.realErrors.length) reasons.push(b.realErrors[0])
    if (b.jsCrashes.length) reasons.push(b.jsCrashes[0].slice(0, 80))
    if (b.serverErrors.length) reasons.push(b.serverErrors[0].slice(0, 80))
    console.log(`  • ${b.pageId}: ${reasons.join(" | ").slice(0, 140)}`)
  }
}

main().catch(console.error)
