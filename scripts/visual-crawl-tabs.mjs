#!/usr/bin/env node
/**
 * Visual Crawler — Tab Error Detection
 * Crawls https://dev.abcx124.xyz/, finds all tabs, clicks them,
 * and reports any that fail to open or show errors.
 */

import { chromium } from "playwright"
import fs from "fs"
import path from "path"

const TARGET_URL = "https://dev.abcx124.xyz/"
const OUT_DIR = path.join(process.cwd(), "cloud", "e2e", "tab-crawl-reports")
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots")

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-")
const REPORT_FILE = path.join(OUT_DIR, `tab-errors-${TIMESTAMP}.json`)

async function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

async function crawlTabs() {
  await ensureDirs()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })
  const page = await context.newPage()

  console.log(`Navigating to ${TARGET_URL}...`)
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 })
  } catch (err) {
    console.error("Failed to load page:", err.message)
    await browser.close()
    process.exit(1)
  }

  // Wait a moment for any lazy tabs to render
  await page.waitForTimeout(2000)

  // Find all tab-like elements
  const tabSelectors = [
    'button[role="tab"]',
    '[role="tablist"] button',
    '[role="tablist"] [role="tab"]',
    '.tabs button',
    '.tab',
    '[data-state="active"]',
    '[data-state="inactive"]',
    'a[role="tab"]',
    '.radix-tabs button',
    '[class*="tab"]',
  ]

  let tabs = []
  for (const sel of tabSelectors) {
    const found = await page.locator(sel).all()
    if (found.length > 0) {
      console.log(`Found ${found.length} tabs with selector: ${sel}`)
      tabs = [...tabs, ...found]
    }
  }

  // Deduplicate by element handle
  const seen = new Set()
  tabs = tabs.filter((t) => {
    const key = t.toString()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`Total unique tabs found: ${tabs.length}`)

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
    }))

    const tabName = tabInfo.text || tabInfo.ariaLabel || `tab-${index}`
    console.log(`\n[${index + 1}/${tabs.length}] Testing tab: "${tabName}"`)

    let error = null
    let screenshotPath = null
    let consoleErrors = []
    let networkErrors = []

    // Listen for console errors during this tab click
    const consoleHandler = (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text())
      }
    }
    page.on("console", consoleHandler)

    // Listen for failed network requests
    const requestHandler = (req) => {
      if (req.failure()) {
        networkErrors.push(`${req.url()} — ${req.failure().errorText}`)
      }
    }
    page.on("requestfailed", requestHandler)

    try {
      // Scroll tab into view and click
      await tab.scrollIntoViewIfNeeded({ timeout: 5000 })
      await tab.click({ timeout: 5000 })
      await page.waitForTimeout(1500)

      // Check for visible error states
      const errorSelectors = [
        '[role="alert"]',
        '.error',
        '.text-red-500',
        '.text-red-400',
        '.bg-red-500',
        '.bg-red-900',
        '[class*="error"]',
        '[class*="Error"]',
        'text=Error',
        'text=Failed',
        'text=Something went wrong',
        'text=404',
        'text=500',
      ]

      for (const errSel of errorSelectors) {
        const errEl = page.locator(errSel).first()
        if (await errEl.isVisible({ timeout: 500 }).catch(() => false)) {
          const errText = await errEl.textContent({ timeout: 1000 }).catch(() => "unknown error")
          error = { type: "visible-error", selector: errSel, text: errText.trim() }
          break
        }
      }

      // Check if URL changed (for link-tabs)
      const currentUrl = page.url()
      if (currentUrl !== TARGET_URL && tabInfo.href) {
        // It's a navigation tab — check if it 404s
        const res = await page.evaluate(() => document.title)
        if (res.includes("404") || res.includes("Not Found")) {
          error = { type: "404", url: currentUrl, title: res }
        }
      }
    } catch (err) {
      error = { type: "click-exception", message: err.message }
    }

    page.off("console", consoleHandler)
    page.off("requestfailed", requestHandler)

    // Deduplicate console/network errors
    consoleErrors = [...new Set(consoleErrors)]
    networkErrors = [...new Set(networkErrors)]

    if (error || consoleErrors.length > 0 || networkErrors.length > 0) {
      screenshotPath = path.join(SCREENSHOT_DIR, `tab-${index}-${tabName.replace(/[^a-z0-9]/gi, "_")}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: false })
      console.log(`  ❌ ISSUE DETECTED — screenshot: ${screenshotPath}`)
      if (error) console.log(`  Error:`, error)
      if (consoleErrors.length) console.log(`  Console errors:`, consoleErrors)
      if (networkErrors.length) console.log(`  Network errors:`, networkErrors)
    } else {
      console.log(`  ✅ OK`)
    }

    results.push({
      index,
      name: tabName,
      tabInfo,
      error,
      consoleErrors,
      networkErrors,
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

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  console.log(`\n============================================`)
  console.log(`Tab crawl complete!`)
  console.log(`Total tabs tested: ${report.totalTabs}`)
  console.log(`Issues found:      ${report.issuesFound}`)
  console.log(`Report saved:      ${REPORT_FILE}`)
  console.log(`Screenshots:       ${SCREENSHOT_DIR}`)
  console.log(`============================================`)

  return report
}

crawlTabs().catch((err) => {
  console.error("Crawl failed:", err)
  process.exit(1)
})
