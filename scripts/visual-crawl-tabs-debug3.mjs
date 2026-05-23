#!/usr/bin/env node
import { chromium } from "playwright"
import fs from "fs"
import path from "path"

const BASE_URL = "http://100.64.175.88:3001/"
const OUT_DIR = path.join(process.cwd(), "cloud", "e2e", "tab-crawl-reports")

async function testTailscale() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  })
  const page = await context.newPage()

  console.log(`Testing: ${BASE_URL}`)
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 })
    await page.waitForTimeout(2000)

    const title = await page.title()
    const screenshotPath = path.join(OUT_DIR, `tailscale-homepage.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    console.log(`Title: ${title}`)
    console.log(`Screenshot: ${screenshotPath}`)

    // Find all clickable elements
    const clickables = await page.locator('button, a, [role="tab"], nav button, aside button, [class*="tab"]').all()
    console.log(`Found ${clickables.length} clickable elements`)
    for (let i = 0; i < Math.min(clickables.length, 30); i++) {
      const el = clickables[i]
      const info = await el.evaluate((e) => ({
        tag: e.tagName,
        text: e.textContent?.trim().slice(0, 60) || "",
        className: e.className?.slice(0, 80) || "",
        role: e.getAttribute("role") || "",
      }))
      console.log(`  [${i}] <${info.tag}> text="${info.text}" class="${info.className}" role="${info.role}"`)
    }
  } catch (err) {
    console.error(`Failed: ${err.message}`)
  }

  await browser.close()
}

testTailscale().catch(console.error)
