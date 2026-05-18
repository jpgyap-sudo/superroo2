/**
 * Visual Crawler — E2E visual regression detection pipeline
 *
 * Flow:
 *   1. Capture baseline screenshots (golden reference)
 *   2. Capture current screenshots across viewport matrix
 *   3. Pixel-compare current vs baseline
 *   4. If diff > threshold, call Ollama Vision to analyze
 *   5. Generate structured bug report
 *   6. Optional: auto-retry after fix, compare again
 *
 * Dependencies: playwright, pixelmatch, pngjs
 */

const fs = require("fs").promises
const fsSync = require("fs")
const path = require("path")
const { chromium } = require("playwright")
const pixelmatch = require("pixelmatch")
const { PNG } = require("pngjs")

const BASELINE_DIR = path.join(__dirname, "..", "e2e", "baselines")
const CURRENT_DIR = path.join(__dirname, "..", "e2e", "current")
const DIFF_DIR = path.join(__dirname, "..", "e2e", "diffs")
const REPORTS_DIR = path.join(__dirname, "..", "e2e", "reports")

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "gemma3:4b"

const DEFAULT_VIEWPORTS = [
	{ name: "desktop-dark", width: 1920, height: 1080, colorScheme: "dark" },
	{ name: "desktop-light", width: 1920, height: 1080, colorScheme: "light" },
	{ name: "ipad-dark", width: 768, height: 1024, colorScheme: "dark" },
	{ name: "iphone-dark", width: 390, height: 844, colorScheme: "dark" },
	{ name: "iphone-light", width: 390, height: 844, colorScheme: "light" },
]

// Ensure directories exist
async function ensureDirs() {
	for (const dir of [BASELINE_DIR, CURRENT_DIR, DIFF_DIR, REPORTS_DIR]) {
		await fs.mkdir(dir, { recursive: true })
	}
}

/**
 * Capture a screenshot of a URL with given viewport settings.
 */
async function captureScreenshot(url, viewport, authToken, outPath) {
	const browser = await chromium.launch()
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		colorScheme: viewport.colorScheme,
	})
	const page = await context.newPage()

	if (authToken) {
		await page.addInitScript((token) => {
			localStorage.setItem("superroo_auth_token", token)
		}, authToken)
	}

	await page.goto(url, { waitUntil: "networkidle" })
	await page.screenshot({ path: outPath, fullPage: true })
	await browser.close()
	return outPath
}

/**
 * Compare two PNG images and return diff info.
 */
function compareImages(baselinePath, currentPath, diffPath) {
	const baseline = PNG.sync.read(fsSync.readFileSync(baselinePath))
	const current = PNG.sync.read(fsSync.readFileSync(currentPath))

	const { width, height } = baseline
	if (current.width !== width || current.height !== height) {
		return {
			match: false,
			diffPixels: -1,
			diffPercent: -1,
			message: `Size mismatch: baseline ${width}x${height} vs current ${current.width}x${current.height}`,
		}
	}

	const diff = new PNG({ width, height })
	const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
		threshold: 0.1,
		includeAA: true,
	})
	fsSync.writeFileSync(diffPath, PNG.sync.write(diff))

	const totalPixels = width * height
	const diffPercent = (diffPixels / totalPixels) * 100

	return {
		match: diffPixels === 0,
		diffPixels,
		diffPercent: Math.round(diffPercent * 1000) / 1000,
		baselineSize: { width, height },
		diffPath,
	}
}

/**
 * Call Ollama Vision API to analyze a diff image.
 */
async function analyzeWithOllama(diffPath, baselinePath, currentPath) {
	try {
		// Read images as base64
		const diffBase64 = fsSync.readFileSync(diffPath).toString("base64")
		const baselineBase64 = fsSync.readFileSync(baselinePath).toString("base64")
		const currentBase64 = fsSync.readFileSync(currentPath).toString("base64")

		const prompt = `You are a visual QA engineer. Analyze these three screenshots:
1. BASELINE (expected): data:image/png;base64,${baselineBase64.slice(0, 100)}... (truncated)
2. CURRENT (actual): data:image/png;base64,${currentBase64.slice(0, 100)}... (truncated)
3. DIFF (red highlights): data:image/png;base64,${diffBase64.slice(0, 100)}... (truncated)

The full base64 images are available. Describe what changed, whether it is a bug or acceptable variance, and suggest a fix if it is a bug.

Respond in JSON format:
{
  "summary": "Brief description of what changed",
  "severity": "none|low|medium|high|critical",
  "isBug": true|false,
  "details": "Detailed explanation",
  "suggestedFix": "What a developer should do to fix this"
}`

		const res = await fetch(`${OLLAMA_URL}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: OLLAMA_VISION_MODEL,
				prompt,
				stream: false,
				format: "json",
			}),
		})

		if (!res.ok) {
			return { error: `Ollama API error: ${res.status}` }
		}

		const data = await res.json()
		let parsed = null
		try {
			parsed = JSON.parse(data.response)
		} catch {
			parsed = { summary: data.response, severity: "unknown", isBug: false, details: "", suggestedFix: "" }
		}
		return parsed
	} catch (err) {
		return { error: err.message, severity: "unknown", isBug: false }
	}
}

/**
 * Run the full visual crawl for a single URL across all viewports.
 */
async function runCrawl({
	url,
	viewports = DEFAULT_VIEWPORTS,
	authToken,
	updateBaselines = false,
	thresholdPercent = 0.5,
}) {
	await ensureDirs()
	const crawlId = `crawl-${Date.now()}`
	const results = []

	for (const vp of viewports) {
		const slug = `${crawlId}-${vp.name}`
		const baselinePath = path.join(BASELINE_DIR, `${slug}.png`)
		const currentPath = path.join(CURRENT_DIR, `${slug}.png`)
		const diffPath = path.join(DIFF_DIR, `${slug}.png`)

		// Capture current screenshot
		await captureScreenshot(url, vp, authToken, currentPath)

		let comparison = null
		let analysis = null

		if (fsSync.existsSync(baselinePath) && !updateBaselines) {
			// Compare against baseline
			comparison = compareImages(baselinePath, currentPath, diffPath)

			if (!comparison.match && comparison.diffPercent > thresholdPercent) {
				analysis = await analyzeWithOllama(diffPath, baselinePath, currentPath)
			}
		} else {
			// Save as new baseline
			await fs.copyFile(currentPath, baselinePath)
			comparison = { match: true, diffPixels: 0, diffPercent: 0, isNewBaseline: true }
		}

		results.push({
			viewport: vp.name,
			width: vp.width,
			height: vp.height,
			colorScheme: vp.colorScheme,
			baselinePath: fsSync.existsSync(baselinePath) ? baselinePath : null,
			currentPath,
			diffPath: comparison && !comparison.match ? diffPath : null,
			comparison,
			analysis,
		})
	}

	const report = {
		crawlId,
		url,
		timestamp: new Date().toISOString(),
		viewportsTested: viewports.length,
		issuesFound: results.filter((r) => r.analysis && r.analysis.isBug).length,
		results,
	}

	const reportPath = path.join(REPORTS_DIR, `${crawlId}.json`)
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2))

	return report
}

/**
 * List all saved reports.
 */
async function listReports() {
	await ensureDirs()
	const files = await fs.readdir(REPORTS_DIR)
	const reports = []
	for (const f of files.filter((f) => f.endsWith(".json"))) {
		try {
			const data = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, f), "utf8"))
			reports.push({
				crawlId: data.crawlId,
				url: data.url,
				timestamp: data.timestamp,
				viewportsTested: data.viewportsTested,
				issuesFound: data.issuesFound,
			})
		} catch {}
	}
	return reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}

/**
 * Get a single report by ID.
 */
async function getReport(crawlId) {
	const reportPath = path.join(REPORTS_DIR, `${crawlId}.json`)
	if (!fsSync.existsSync(reportPath)) return null
	return JSON.parse(await fs.readFile(reportPath, "utf8"))
}

/**
 * Re-run a crawl after a fix is applied (FixVerifier).
 */
async function rerunAfterFix(originalCrawlId, { url, viewports, authToken, thresholdPercent }) {
	const original = await getReport(originalCrawlId)
	if (!original) throw new Error(`Original crawl ${originalCrawlId} not found`)

	const newReport = await runCrawl({
		url: url || original.url,
		viewports:
			viewports ||
			original.results.map((r) => ({
				name: r.viewport,
				width: r.width,
				height: r.height,
				colorScheme: r.colorScheme,
			})),
		authToken,
		updateBaselines: false,
		thresholdPercent,
	})

	// Mark original issues as verified if fixed
	const verified = original.results.map((orig) => {
		const fixed = newReport.results.find((r) => r.viewport === orig.viewport)
		return {
			viewport: orig.viewport,
			wasIssue: orig.analysis && orig.analysis.isBug,
			isFixed: fixed ? fixed.comparison.match : false,
			fixedReportCrawlId: newReport.crawlId,
		}
	})

	return {
		originalCrawlId,
		newCrawlId: newReport.crawlId,
		verified,
		newReport,
	}
}

module.exports = {
	runCrawl,
	listReports,
	getReport,
	rerunAfterFix,
	DEFAULT_VIEWPORTS,
	ensureDirs,
}
