import * as fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"

export interface DomainEvidence {
	projectName?: string
	description?: string
	keywords: string[]
	entities: string[]
}

export interface MismatchResult {
	mismatch: boolean
	confidence: "high" | "medium" | "low"
	workspaceDomain: DomainEvidence
	requestDomain: DomainEvidence
	reason: string
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
	medical: [
		"patient",
		"doctor",
		"hospital",
		"clinic",
		"diagnosis",
		"prescription",
		"medical",
		"health",
		"emr",
		"ehr",
		"healthcare",
		"treatment",
		"symptom",
		"appointment",
		"billing",
		"insurance",
		"pharmacy",
		"lab",
		"radiology",
	],
	ecommerce: [
		"product",
		"cart",
		"checkout",
		"order",
		"payment",
		"shipping",
		"inventory",
		"warehouse",
		"customer",
		"shop",
		"store",
		"catalog",
		"discount",
		"coupon",
		"refund",
		"invoice",
	],
	finance: [
		"bank",
		"account",
		"transaction",
		"transfer",
		"deposit",
		"withdrawal",
		"loan",
		"mortgage",
		"stock",
		"trading",
		"portfolio",
		"investment",
		"crypto",
		"budget",
		"expense",
		"revenue",
	],
	education: [
		"student",
		"teacher",
		"course",
		"lesson",
		"classroom",
		"enrollment",
		"grade",
		"assignment",
		"quiz",
		"exam",
		"curriculum",
		"university",
		"school",
		"learning",
		"lms",
	],
	realEstate: [
		"property",
		"listing",
		"agent",
		"broker",
		"rent",
		"lease",
		"mortgage",
		"appraisal",
		"tenant",
		"landlord",
		"hoa",
		"mls",
	],
	travel: [
		"flight",
		"hotel",
		"booking",
		"reservation",
		"itinerary",
		"destination",
		"tour",
		"vacation",
		"passport",
		"visa",
		"checkin",
		"luggage",
	],
	food: [
		"restaurant",
		"menu",
		"dish",
		"recipe",
		"delivery",
		"order",
		"reservation",
		"chef",
		"kitchen",
		"ingredient",
		"cuisine",
		"review",
	],
	pet: [
		"dog",
		"cat",
		"pet",
		"adoption",
		"breed",
		"veterinarian",
		"vet",
		"shelter",
		"rescue",
		"puppy",
		"kitten",
		"animal",
		"grooming",
		"boarding",
	],
	gaming: [
		"game",
		"player",
		"level",
		"score",
		"leaderboard",
		"matchmaking",
		"quest",
		"achievement",
		"inventory",
		"npc",
		"multiplayer",
		"campaign",
	],
	social: [
		"user",
		"profile",
		"friend",
		"follow",
		"post",
		"feed",
		"comment",
		"like",
		"message",
		"chat",
		"group",
		"community",
		"notification",
		"share",
	],
}

/**
 * Infers the workspace domain by reading durable repository signals.
 */
export async function inferWorkspaceDomain(cwd: string): Promise<DomainEvidence> {
	const keywords = new Set<string>()
	const entities = new Set<string>()
	let projectName: string | undefined
	let description: string | undefined

	// 1. README
	const readmePath = path.join(cwd, "README.md")
	if (await fileExistsAtPath(readmePath)) {
		try {
			const readme = await fs.readFile(readmePath, "utf8")
			const firstLines = readme.slice(0, 2000).toLowerCase()
			extractKeywords(firstLines, keywords)
			// Try to grab project name from first heading
			const titleMatch = readme.match(/^#\s+(.+)$/m)
			if (titleMatch) projectName = titleMatch[1].trim()
			// Grab first paragraph as description
			const descMatch = readme.match(/^#\s+.+\n+([^#\n].+(?:\n[^#\n].+)*)/m)
			if (descMatch) description = descMatch[1].trim().slice(0, 200)
		} catch {
			// ignore
		}
	}

	// 2. package.json / project metadata
	const pkgPath = path.join(cwd, "package.json")
	if (await fileExistsAtPath(pkgPath)) {
		try {
			const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"))
			if (pkg.name) {
				projectName = projectName || pkg.name
				extractKeywords(pkg.name.toLowerCase(), keywords)
			}
			if (pkg.description) {
				description = description || pkg.description
				extractKeywords(pkg.description.toLowerCase(), keywords)
			}
			if (pkg.keywords) {
				for (const kw of pkg.keywords) {
					keywords.add(String(kw).toLowerCase())
				}
			}
		} catch {
			// ignore
		}
	}

	// 3. Directory names (top-level only, limited depth)
	try {
		const entries = await fs.readdir(cwd, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("node_modules")) {
				extractKeywords(entry.name.toLowerCase(), keywords)
				if (entry.name.includes("-")) {
					for (const part of entry.name.split("-")) {
						if (part.length > 2) entities.add(part)
					}
				}
			}
		}
	} catch {
		// ignore
	}

	// 4. Sample source files (first few .ts/.tsx/.js files in src/)
	const srcDir = path.join(cwd, "src")
	if (await fileExistsAtPath(srcDir)) {
		try {
			const files = await collectSourceFiles(srcDir, 20)
			for (const file of files.slice(0, 5)) {
				const content = await fs.readFile(file, "utf8").catch(() => "")
				// Look for class/interface names and route paths
				const classMatches = content.match(/(?:class|interface|type|enum)\s+([A-Z]\w+)/g)
				if (classMatches) {
					for (const m of classMatches) {
						const name = m.replace(/(?:class|interface|type|enum)\s+/, "")
						entities.add(name)
					}
				}
				// Route paths
				const routeMatches = content.match(/['"`]\/(?:api\/)?[a-z-]+['"`]/g)
				if (routeMatches) {
					for (const r of routeMatches) {
						const clean = r.replace(/['"`]/g, "").toLowerCase()
						for (const part of clean.split("/")) {
							if (part.length > 2) keywords.add(part)
						}
					}
				}
			}
		} catch {
			// ignore
		}
	}

	return {
		projectName,
		description,
		keywords: Array.from(keywords),
		entities: Array.from(entities).slice(0, 50),
	}
}

/**
 * Infers the domain of a user request from its text.
 */
export function inferRequestDomain(requestText: string): DomainEvidence {
	const lower = requestText.toLowerCase()
	const keywords = new Set<string>()
	const entities = new Set<string>()

	extractKeywords(lower, keywords)

	// Extract capitalized words as likely entities
	const entityMatches = requestText.match(/\b[A-Z][a-zA-Z]{2,}\b/g)
	if (entityMatches) {
		for (const e of entityMatches) {
			entities.add(e)
		}
	}

	return {
		keywords: Array.from(keywords),
		entities: Array.from(entities).slice(0, 20),
	}
}

/**
 * Detects whether a user request strongly mismatches the current workspace domain.
 */
export async function detectDomainMismatch(cwd: string, requestText: string): Promise<MismatchResult> {
	const workspaceDomain = await inferWorkspaceDomain(cwd)
	const requestDomain = inferRequestDomain(requestText)

	// Score workspace domain buckets
	const workspaceBuckets = scoreBuckets(workspaceDomain.keywords)
	const requestBuckets = scoreBuckets(requestDomain.keywords)

	// Find dominant workspace bucket
	const topWorkspaceBucket = Object.entries(workspaceBuckets).sort((a, b) => b[1] - a[1])[0]
	const topRequestBucket = Object.entries(requestBuckets).sort((a, b) => b[1] - a[1])[0]

	// If workspace has no clear domain, we can't confidently mismatch
	if (!topWorkspaceBucket || topWorkspaceBucket[1] < 2) {
		return {
			mismatch: false,
			confidence: "low",
			workspaceDomain,
			requestDomain,
			reason: "Workspace domain is not clearly identifiable.",
		}
	}

	// If request has no clear domain, be lenient
	if (!topRequestBucket || topRequestBucket[1] < 1) {
		return {
			mismatch: false,
			confidence: "low",
			workspaceDomain,
			requestDomain,
			reason: "Request does not contain identifiable domain keywords.",
		}
	}

	// Check for overlap (request keywords that match workspace)
	const workspaceSet = new Set(workspaceDomain.keywords)
	const overlap = requestDomain.keywords.filter((k) => workspaceSet.has(k)).length
	const overlapRatio = requestDomain.keywords.length > 0 ? overlap / requestDomain.keywords.length : 0

	// If strong overlap, no mismatch
	if (overlapRatio >= 0.3) {
		return {
			mismatch: false,
			confidence: "low",
			workspaceDomain,
			requestDomain,
			reason: `Request shares ${Math.round(overlapRatio * 100)}% keywords with workspace domain.`,
		}
	}

	// If request bucket is different from workspace bucket with no overlap → mismatch
	if (topRequestBucket[0] !== topWorkspaceBucket[0] && overlap === 0) {
		return {
			mismatch: true,
			confidence: "high",
			workspaceDomain,
			requestDomain,
			reason: `Workspace looks like a "${topWorkspaceBucket[0]}" project (${workspaceDomain.projectName ?? "unknown"}), but the request is about "${topRequestBucket[0]}" with no shared terminology.`,
		}
	}

	// If request bucket is different but some overlap → medium confidence
	if (topRequestBucket[0] !== topWorkspaceBucket[0]) {
		return {
			mismatch: true,
			confidence: "medium",
			workspaceDomain,
			requestDomain,
			reason: `Workspace looks like a "${topWorkspaceBucket[0]}" project, but the request introduces "${topRequestBucket[0]}" concepts with limited overlap.`,
		}
	}

	return {
		mismatch: false,
		confidence: "low",
		workspaceDomain,
		requestDomain,
		reason: "Request aligns with the detected workspace domain.",
	}
}

// ────────────────────────────── helpers ──────────────────────────────

function extractKeywords(text: string, into: Set<string>) {
	const words = text.split(/[^a-z]+/)
	for (const w of words) {
		if (w.length >= 3) into.add(w)
	}
}

function scoreBuckets(keywords: string[]): Record<string, number> {
	const scores: Record<string, number> = {}
	for (const [bucket, bucketWords] of Object.entries(DOMAIN_KEYWORDS)) {
		scores[bucket] = keywords.filter((k) => bucketWords.includes(k)).length
	}
	return scores
}

async function collectSourceFiles(dir: string, limit: number): Promise<string[]> {
	const results: string[] = []
	async function walk(current: string) {
		if (results.length >= limit) return
		const entries = await fs.readdir(current, { withFileTypes: true })
		for (const entry of entries) {
			if (results.length >= limit) return
			const full = path.join(current, entry.name)
			if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.includes("node_modules")) {
				await walk(full)
			} else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
				results.push(full)
			}
		}
	}
	await walk(dir)
	return results
}
