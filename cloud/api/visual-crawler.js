/**
 * Visual Crawler — E2E visual regression detection pipeline
 *
 * Now supports MULTI-PROJECT mode:
 *   - Each project has its own baselines/, current/, diffs/, reports/ directories
 *   - A project registry (projects.json) tracks known projects and their page lists
 *   - The core engine is URL-agnostic — any URL can be crawled
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
// Optional deps — visual crawling is disabled when these are not installed
// (e.g. the slim 256MB API container has no playwright/browsers).
let chromium = null
let pixelmatch = null
let PNG = null
try {
	;({ chromium } = require("playwright"))
	pixelmatch = require("pixelmatch")
	;({ PNG } = require("pngjs"))
} catch (err) {
	console.warn(`[visual-crawler] optional deps missing — visual crawling disabled: ${err.message}`)
}

const E2E_ROOT = path.join(__dirname, "..", "e2e")
const REGISTRY_PATH = path.join(E2E_ROOT, "projects.json")

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "gemma3:4b"

const DEFAULT_VIEWPORTS = [
	{ name: "desktop-dark", width: 1920, height: 1080, colorScheme: "dark" },
	{ name: "desktop-light", width: 1920, height: 1080, colorScheme: "light" },
	{ name: "ipad-dark", width: 768, height: 1024, colorScheme: "dark" },
	{ name: "iphone-dark", width: 390, height: 844, colorScheme: "dark" },
	{ name: "iphone-light", width: 390, height: 844, colorScheme: "light" },
]

// ── Project-scoped directory helpers ────────────────────────────────────────

function projectDirs(projectName) {
	const base = path.join(E2E_ROOT, projectName)
	return {
		baselines: path.join(base, "baselines"),
		current: path.join(base, "current"),
		diffs: path.join(base, "diffs"),
		reports: path.join(base, "reports"),
	}
}

async function ensureProjectDirs(projectName) {
	const dirs = projectDirs(projectName)
	for (const d of Object.values(dirs)) {
		await fs.mkdir(d, { recursive: true })
	}
}

// ── Project Registry ────────────────────────────────────────────────────────

/**
 * Get the project registry. Creates default if missing.
 */
async function getProjectRegistry() {
	try {
		if (fsSync.existsSync(REGISTRY_PATH)) {
			return JSON.parse(await fs.readFile(REGISTRY_PATH, "utf8"))
		}
	} catch {}
	// Default registry with the SuperRoo dashboard project
	const defaultRegistry = {
		projects: [
			{
				name: "superroo-dashboard",
				label: "SuperRoo Dashboard",
				baseUrl: "http://localhost:3001",
				authToken: "",
				pages: [
					{ id: "overview", label: "Overview" },
					{ id: "working-tree", label: "Working Tree" },
					{ id: "provider-dashboard", label: "Provider Dashboard" },
					{ id: "jobs", label: "Jobs" },
					{ id: "queue", label: "Queue" },
					{ id: "agents", label: "Agents" },
					{ id: "bugs", label: "Bugs" },
					{ id: "healing", label: "Healing" },
					{ id: "monitoring", label: "Monitoring" },
					{ id: "workflow-compliance", label: "Workflow Compliance" },
					{ id: "skill-generator", label: "Skill Generator" },
					{ id: "logs", label: "Logs" },
					{ id: "docker", label: "Docker" },
					{ id: "approvals", label: "Approvals" },
					{ id: "api-keys", label: "API Keys" },
					{ id: "settings", label: "Settings" },
					{ id: "ai", label: "AI Assistant" },
					{ id: "model-router", label: "Model Router" },
					{ id: "github", label: "GitHub" },
					{ id: "ide-terminal", label: "IDE Terminal" },
					{ id: "projects", label: "Projects" },
					{ id: "telegram", label: "Telegram" },
					{ id: "deploy", label: "Deploy" },
					{ id: "auto-deploy", label: "Auto Deploy" },
					{ id: "commit-deploy", label: "Commit & Deploy" },
					{ id: "debug-team", label: "Debug Team" },
					{ id: "intelligence-layer", label: "Intelligence Layer" },
					{ id: "brain", label: "Brain" },
					{ id: "ollama-growth", label: "Ollama Growth" },
					{ id: "memory-explorer", label: "Memory Explorer" },
					{ id: "visual-crawler", label: "Visual Crawler" },
					{ id: "parallel-execution", label: "Parallel Execution" },
					{ id: "autonomous-loop", label: "Autonomous Loop" },
					{ id: "commissioning-loop", label: "Commissioning Loop" },
					{ id: "hermes-claw", label: "Hermes Claw" },
					{ id: "deploy-orchestrator", label: "Deploy Orchestrator" },
					{ id: "ml-engine", label: "ML Engine" },
					{ id: "ram-orchestrator", label: "RAM Orchestrator" },
					{ id: "product-memory", label: "Product Memory" },
					{ id: "task-timeline", label: "Task Timeline" },
					{ id: "collaboration", label: "Collaboration" },
					{ id: "mcp-servers", label: "MCP Servers" },
					{ id: "sandbox", label: "Sandbox" },
				],
			},
		],
	}
	await saveProjectRegistry(defaultRegistry)
	return defaultRegistry
}

/**
 * Save the project registry.
 */
async function saveProjectRegistry(registry) {
	await fs.mkdir(E2E_ROOT, { recursive: true })
	await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2))
}

/**
 * Add a project to the registry.
 */
async function addProject({ name, label, baseUrl, authToken, pages }) {
	const registry = await getProjectRegistry()
	// Remove existing project with same name
	registry.projects = registry.projects.filter((p) => p.name !== name)
	registry.projects.push({ name, label: label || name, baseUrl, authToken: authToken || "", pages: pages || [] })
	await saveProjectRegistry(registry)
	return registry
}

/**
 * Remove a project from the registry.
 */
async function removeProject(name) {
	const registry = await getProjectRegistry()
	registry.projects = registry.projects.filter((p) => p.name !== name)
	await saveProjectRegistry(registry)
	return registry
}

/**
 * Update a project's pages list.
 */
async function updateProjectPages(name, pages) {
	const registry = await getProjectRegistry()
	const project = registry.projects.find((p) => p.name === name)
	if (!project) throw new Error(`Project "${name}" not found in registry`)
	project.pages = pages
	await saveProjectRegistry(registry)
	return registry
}

// ── Core Crawl Functions ────────────────────────────────────────────────────

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

		const prompt = `You are a visual QA engineer. I am showing you three screenshots in this order:
1. BASELINE (expected result)
2. CURRENT (actual result)
3. DIFF (pixel differences highlighted)

Analyze them carefully. Describe what changed, whether it is a bug or acceptable variance, and suggest a fix if it is a bug.

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
				images: [baselineBase64, currentBase64, diffBase64],
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
 * Now accepts an optional `projectName` for scoped storage.
 */
async function runCrawl({
	url,
	viewports = DEFAULT_VIEWPORTS,
	authToken,
	updateBaselines = false,
	thresholdPercent = 0.5,
	projectName = "_default",
}) {
	const dirs = projectDirs(projectName)
	await ensureProjectDirs(projectName)
	const crawlId = `crawl-${Date.now()}`
	const results = []

	for (const vp of viewports) {
		const slug = `${crawlId}-${vp.name}`
		const baselinePath = path.join(dirs.baselines, `${slug}.png`)
		const currentPath = path.join(dirs.current, `${slug}.png`)
		const diffPath = path.join(dirs.diffs, `${slug}.png`)

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
		projectName,
		url,
		timestamp: new Date().toISOString(),
		viewportsTested: viewports.length,
		issuesFound: results.filter((r) => r.analysis && r.analysis.isBug).length,
		results,
	}

	const reportPath = path.join(dirs.reports, `${crawlId}.json`)
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2))

	return report
}

/**
 * List all saved reports, optionally filtered by project.
 */
async function listReports(projectName) {
	// If project specified, list only that project's reports
	if (projectName) {
		const dirs = projectDirs(projectName)
		await ensureProjectDirs(projectName)
		return readReportsFromDir(dirs.reports)
	}

	// Otherwise list reports from ALL projects
	const registry = await getProjectRegistry()
	const allReports = []
	for (const project of registry.projects) {
		const dirs = projectDirs(project.name)
		await ensureProjectDirs(project.name)
		const reports = await readReportsFromDir(dirs.reports)
		allReports.push(...reports)
	}
	return allReports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}

/**
 * Read reports from a single directory.
 */
async function readReportsFromDir(reportsDir) {
	let files = []
	try {
		files = await fs.readdir(reportsDir)
	} catch {
		return []
	}
	const reports = []
	for (const f of files.filter((f) => f.endsWith(".json"))) {
		try {
			const data = JSON.parse(await fs.readFile(path.join(reportsDir, f), "utf8"))
			reports.push({
				crawlId: data.crawlId,
				projectName: data.projectName,
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
 * Get a single report by ID, searching across all projects.
 */
async function getReport(crawlId) {
	// Search across all project report dirs
	const registry = await getProjectRegistry()
	for (const project of registry.projects) {
		const dirs = projectDirs(project.name)
		const reportPath = path.join(dirs.reports, `${crawlId}.json`)
		if (fsSync.existsSync(reportPath)) {
			return JSON.parse(await fs.readFile(reportPath, "utf8"))
		}
	}
	// Also check _default
	const defaultPath = path.join(projectDirs("_default").reports, `${crawlId}.json`)
	if (fsSync.existsSync(defaultPath)) {
		return JSON.parse(await fs.readFile(defaultPath, "utf8"))
	}
	return null
}

/**
 * Re-run a crawl after a fix is applied (FixVerifier).
 */
async function rerunAfterFix(originalCrawlId, { url, viewports, authToken, thresholdPercent, projectName }) {
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
		projectName: projectName || original.projectName,
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
	ensureProjectDirs,
	getProjectRegistry,
	saveProjectRegistry,
	addProject,
	removeProject,
	updateProjectPages,
}
