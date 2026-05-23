#!/usr/bin/env node
import { chromium } from "playwright"
import fs from "fs"
import path from "path"

const TARGET_URL = "https://dev.abcx124.xyz/"
const OUT_DIR = path.join(process.cwd(), "cloud", "e2e", "tab-crawl-reports")

async function debugPage() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })
  const page = await context.newPage()

  console.log(`Navigating to ${TARGET_URL}...`)
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(3000)

  // Take screenshot
  const screenshotPath = path.join(OUT_DIR, "debug-homepage.png")
  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(`Screenshot saved: ${screenshotPath}`)

  // Dump all clickable elements and their text
  const clickables = await page.locator('button, a, [role="tab"], [class*="tab"]').all()
  console.log(`\nFound ${clickables.length} clickable elements:`)
  for (let i = 0; i < Math.min(clickables.length, 50); i++) {
    const el = clickables[i]
    const info = await el.evaluate((e) => ({
      tag: e.tagName,
      text: e.textContent?.trim().slice(0, 60) || "",
      className: e.className?.slice(0, 80) || "",
      role: e.getAttribute("role") || "",
      href: e.getAttribute("href") || "",
    }))
    console.log(`  [${i}] <${info.tag}> text="${info.text}" class="${info.className}" role="${info.role}" href="${info.href}"`)
  }

  // Look for any navigation or sidebar
  const navs = await page.locator('nav, aside, [role="navigation"], [role="tablist"]').all()
  console.log(`\nFound ${navs.length} nav/tablist elements`)

  // Dump page title
  const title = await page.title()
  console.log(`\nPage title: ${title}`)

  // Save HTML snippet
  const html = await page.content()
  fs.writeFileSync(path.join(OUT_DIR, "debug-homepage.html"), html.slice(0, 50000))
  console.log(`HTML saved: ${path.join(OUT_DIR, "debug-homepage.html")}`)

  await browser.close()
}

debugPage().catch((err) => {
  console.error("Debug failed:", err)
  process.exit(1)
})
