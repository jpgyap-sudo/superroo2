#!/usr/bin/env node
/**
 * Visual Crawler — Tab Error Detection (with auto-registration)
 * Attempts to register a test account, log in, and test all dashboard tabs.
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

  // If registration failed (maybe email exists), try login
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

async function crawlTabs(token) {
  await ensureDirs()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })
  const page = await context.newPage()

  // Inject auth token
  await page.addInitScript((t) => {
    localStorage.setItem("superroo_auth_token", t)
  }, token)

  console.log(`Navigating to ${TARGET_URL}...`)
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(3000)

  const title = await page.title()
  console.log(`Page title: ${title}`)

  // Check if still on login page
  const isLoginPage = await page.locator('button:has-text("Sign In")').isVisible({ timeout: 2000 }).catch(() => false)
  if (isLoginPage) {
    console.log("WARNING: Still on login page after injecting token. Token may be invalid or API may be down.")
    const screenshotPath = path.join(SCREENSHOT_DIR, `login-still-visible.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await browser.close()
    return
  }

  // Take screenshot of dashboard
  const dashboardScreenshot = path.join(SCREENSHOT_DIR, `dashboard-home.png`)
  await page.screenshot({ path: dashboardScreenshot, fullPage: true })
  console.log(`Dashboard screenshot: ${dashboardScreenshot}`)

  // Find all tab/navigation elements
  const tabSelectors = [
    'button[role="tab"]',
    '[role="tablist"] button',
    '[role="tablist"] [role="tab"]',
    'nav button',
    'aside button',
    '[data-state]',
    '[class*="tab"]',
    'a[href*="page="]',
    'nav a',
    'aside a',
  ]

  let tabs = []
  for (const sel of tabSelectors) {
    const found = await page.locator(sel).all()
    if (found.length > 0) {
      console.log(`Found ${found.length} elements with selector: ${sel}`)
      tabs = [...tabs, ...found]
    }
  }

  // Deduplicate
  const seen = new Set()
  tabs = tabs.filter((t) => {
    const key = t.toString()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`Total unique clickable nav items: ${tabs.length}`)

  const results = []
  let index = 0

  for (const tab of tabs) {
    const tabInfo = await tab.evaluate((el) => ({
      text: el.textContent?.trim() || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      id: el.id || "",
      className: el.className || "",
      tagName: el.tagName,
      href: el.getAttribute("href") || "",
      disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
      dataState: el.getAttribute("data-state") || "",
      dataValue: el.getAttribute("data-value") || "",
    }))

    const tabName = tabInfo.text || tabInfo.ariaLabel || tabInfo.dataValue || `item-${index}`
    console.log(`\n[${index + 1}/${tabs.length}] Testing: "${tabName}"`)

    let error = null
    let screenshotPath = null
    let consoleErrors = []
    let networkErrors = []

    const consoleHandler = (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    }
    page.on("console", consoleHandler)

    const requestHandler = (req) => {
      if (req.failure()) networkErrors.push(`${req.url()} — ${req.failure().errorText}`)
    }
    page.on("requestfailed", requestHandler)

    try {
      await tab.scrollIntoViewIfNeeded({ timeout: 3000 })
      await tab.click({ timeout: 5000 })
      await page.waitForTimeout(2000)

      // Check for visible errors
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

      for (const errSel of errorSelectors) {
        const errEl = page.locator(errSel).first()
        if (await errEl.isVisible({ timeout: 500 }).catch(() => false)) {
          const errText = await errEl.textContent({ timeout: 1000 }).catch(() => "unknown")
          error = { type: "visible-error", selector: errSel, text: errText.trim().slice(0, 200) }
          break
        }
      }

      // Check for blank/empty content areas
      const mainContent = await page.locator("main, [role='main'], .content, [class*='content']").first()
      if (await mainContent.isVisible({ timeout: 500 }).catch(() => false)) {
        const text = await mainContent.textContent().catch(() => "")
        if (text.trim().length < 10) {
          error = { type: "empty-content", text: "Content area appears empty after clicking tab" }
        }
      }
    } catch (err) {
      error = { type: "click-exception", message: err.message }
    }

    page.off("console", consoleHandler)
    page.off("requestfailed", requestHandler)

    consoleErrors = [...new Set(consoleErrors)]
    networkErrors = [...new Set(networkErrors)]

    if (error || consoleErrors.length > 0 || networkErrors.length > 0) {
      const safeName = tabName.replace(/[^a-z0-9]/gi, "_").slice(0, 40)
      screenshotPath = path.join(SCREENSHOT_DIR, `tab-${index}-${safeName}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: false })
      console.log(`  ❌ ISSUE — screenshot: ${screenshotPath}`)
      if (error) console.log(`  Error:`, error)
      if (consoleErrors.length) console.log(`  Console:`, consoleErrors.slice(0, 3))
      if (networkErrors.length) console.log(`  Network:`, networkErrors.slice(0, 3))
    } else {
      console.log(`  ✅ OK`)
    }

    results.push({
      index,
      name: tabName,
      tabInfo,
      error,
      consoleErrors: consoleErrors.slice(0, 5),
      networkErrors: networkErrors.slice(0, 5),
      screenshot: screenshotPath,
    })

    index++
  }

  await browser.close()

  const report = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    totalTabs: tabs.length,
    issuesFound: results.filter((r) => r.error || r.consoleErrors.length > 0 || r.networkErrors.length > 0).length,
    results,
  }

  const reportPath = path.join(OUT_DIR, `tab-crawl-auth-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`\n============================================`)
  console.log(`Tab crawl complete!`)
  console.log(`Total tabs tested: ${report.totalTabs}`)
  console.log(`Issues found:      ${report.issuesFound}`)
  console.log(`Report saved:      ${reportPath}`)
  console.log(`Screenshots:       ${SCREENSHOT_DIR}`)
  console.log(`============================================`)
}

async function main() {
  try {
    const token = await registerAndLogin()
    await crawlTabs(token)
  } catch (err) {
    console.error("Crawl failed:", err.message)
    // Try crawling without auth to at least report the login page state
    console.log("\nFalling back to unauthenticated crawl...")
    await crawlTabs(null)
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
