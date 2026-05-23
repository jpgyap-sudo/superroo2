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

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 })
  } catch {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 10000 })
    } catch {}
  }
  await page.waitForTimeout(800)

  const hasNextError = await page.locator('text=Application error: a client-side exception has occurred').isVisible({ timeout: 800 }).catch(() => false)

  const errorTexts = []
  const els = await page.locator('[role="alert"], .error, .text-red-500, .text-red-400').all()
  for (const el of els) {
    const text = await el.textContent().catch(() => "")
    if (text.trim() && text.trim().length < 200 && !text.includes("Offline") && !text.includes("Down") && !text.includes("Unavailable") && !text.includes("Unknown") && !text.includes("Pause") && !text.includes("Reconnecting") && !text.includes("danger") && !text.includes("critical")) {
      errorTexts.push(text.trim())
    }
  }

  // Also check for console errors by briefly listening
  const consoleErrors = []
  const handler = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()) }
  page.on("console", handler)
  await page.waitForTimeout(300)
  page.off("console", handler)

  const hasRealError = hasNextError || errorTexts.length > 0 || consoleErrors.some(e => e.includes("TypeError") || e.includes("ReferenceError") || e.includes("Cannot read"))

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
    hasNextError,
    errorTexts: [...new Set(errorTexts)].slice(0, 5),
    consoleErrors: [...new Set(consoleErrors)].filter(e => e.includes("TypeError") || e.includes("ReferenceError") || e.includes("Cannot read") || e.includes("500") || e.includes("401")).slice(0, 5),
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
    const hasIssue = res.hasNextError || res.errorTexts.length > 0 || res.consoleErrors.length > 0
    results.push(res)
    console.log(`${hasIssue ? '❌' : '✅'} [${i + 1}/${PAGES.length}] ${res.pageId || 'home'}${hasIssue ? ' — ISSUE' : ''}`)
    if (res.hasNextError) console.log(`   Next.js crash`)
    if (res.errorTexts.length) console.log(`   Errors:`, res.errorTexts.slice(0, 3))
    if (res.consoleErrors.length) console.log(`   Console:`, res.consoleErrors.slice(0, 2))
  }

  await browser.close()

  const report = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    totalPages: PAGES.length,
    issuesFound: results.filter((r) => r.hasNextError || r.errorTexts.length > 0 || r.consoleErrors.length > 0).length,
    results,
  }

  const reportPath = path.join(OUT_DIR, `tab-crawl-final-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`\n========== VISUAL CRAWL COMPLETE ==========`)
  console.log(`Pages tested: ${report.totalPages}`)
  console.log(`Issues found: ${report.issuesFound}`)
  console.log(`Report: ${reportPath}`)
  console.log(`Screenshots: ${SCREENSHOT_DIR}`)

  console.log(`\n📋 CONFIRMED BUGS (real crashes/errors):`)
  const realBugs = results.filter((r) => r.hasNextError || r.errorTexts.length > 0 || r.consoleErrors.length > 0)
  for (const b of realBugs) {
    const reasons = []
    if (b.hasNextError) reasons.push("Next.js crash")
    if (b.errorTexts.length) reasons.push(b.errorTexts[0])
    if (b.consoleErrors.length) reasons.push(b.consoleErrors[0].slice(0, 80))
    console.log(`  • ${b.pageId}: ${reasons.join(" | ").slice(0, 120)}`)
  }
}

main().catch(console.error)
