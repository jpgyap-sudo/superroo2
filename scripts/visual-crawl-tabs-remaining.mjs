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

const REMAINING = [
  "ollama-growth", "memory-explorer", "visual-crawler", "parallel-execution",
  "autonomous-loop", "commissioning-loop", "hermes-claw",
  "deploy-orchestrator", "ml-engine", "ram-orchestrator",
  "product-memory", "task-timeline", "collaboration", "mcp-servers", "sandbox",
]

async function registerAndLogin() {
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
  })
  const d = await registerRes.json()
  if (d.ok) return d.token
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  const d2 = await loginRes.json()
  if (d2.ok) return d2.token
  throw new Error("Auth failed")
}

async function testOne(browser, token, pageId, index) {
  const url = `${TARGET_URL}?page=${pageId}`
  const page = await browser.newPage()
  await page.addInitScript((t) => { localStorage.setItem("superroo_auth_token", t) }, token)

  let navError = null
  try { await page.goto(url, { waitUntil: "networkidle", timeout: 10000 }) }
  catch (e) { navError = e.message; try { await page.goto(url, { waitUntil: "load", timeout: 6000 }) } catch {} }
  await page.waitForTimeout(400)

  const hasNextError = await page.locator('text=Application error: a client-side exception has occurred').isVisible({ timeout: 400 }).catch(() => false)

  const bodyText = await page.locator("body").textContent().catch(() => "")
  const realErrors = []
  if (bodyText.includes("Failed to load")) { const m = bodyText.match(/Failed to load[^\n.]{0,200}/); if (m) realErrors.push(m[0]) }
  if (bodyText.includes("Unauthorized. Please sign in again.")) realErrors.push("Unauthorized")
  if (bodyText.includes("HTTP 404")) realErrors.push("HTTP 404")

  const consoleErrors = []
  const h = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()) }
  page.on("console", h)
  await page.waitForTimeout(300)
  page.off("console", h)

  const jsCrashes = consoleErrors.filter(e => e.includes("TypeError") || e.includes("Cannot read"))
  const serverErrors = consoleErrors.filter(e => e.includes("500") || e.includes("401"))

  const hasIssue = hasNextError || realErrors.length > 0 || jsCrashes.length > 0 || serverErrors.length > 0 || navError?.includes("timeout")

  let screenshotPath = null
  if (hasIssue) {
    screenshotPath = path.join(SCREENSHOT_DIR, `page-rem-${index}-${pageId}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
  }

  await page.close()
  return { pageId, navError, hasNextError, realErrors, jsCrashes, serverErrors, screenshot: screenshotPath }
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const token = await registerAndLogin()
  const browser = await chromium.launch({ headless: true })

  const results = []
  for (let i = 0; i < REMAINING.length; i++) {
    const res = await testOne(browser, token, REMAINING[i], i)
    const bad = res.hasNextError || res.realErrors.length || res.jsCrashes.length || res.serverErrors.length || res.navError
    results.push(res)
    console.log(`${bad ? '❌' : '✅'} ${res.pageId}${bad ? ' — ISSUE' : ''}`)
    if (res.navError) console.log(`   timeout`)
    if (res.hasNextError) console.log(`   Next.js crash`)
    if (res.realErrors.length) console.log(`   ${res.realErrors[0]}`)
    if (res.jsCrashes.length) console.log(`   ${res.jsCrashes[0].slice(0, 80)}`)
    if (res.serverErrors.length) console.log(`   ${res.serverErrors[0].slice(0, 80)}`)
  }

  await browser.close()

  const reportPath = path.join(OUT_DIR, `tab-crawl-remaining-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2))
  console.log(`\nDone. Report: ${reportPath}`)
}

main().catch(console.error)
