import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { inferWorkspaceDomain, inferRequestDomain, detectDomainMismatch } from "../WorkspaceDomainGuard"

let tmpDir: string

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "domain-guard-test-"))
})

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

async function writeFile(relPath: string, content: string) {
	const full = path.join(tmpDir, relPath)
	await fs.mkdir(path.dirname(full), { recursive: true })
	await fs.writeFile(full, content, "utf8")
}

describe("inferWorkspaceDomain", () => {
	it("extracts medical domain from README", async () => {
		await writeFile("README.md", "# MediCare\nA medical records platform for hospitals and clinics.")
		const domain = await inferWorkspaceDomain(tmpDir)
		expect(domain.keywords).toContain("medical")
		expect(domain.keywords).toContain("hospitals")
		expect(domain.keywords).toContain("clinics")
		expect(domain.projectName).toBe("MediCare")
	})

	it("extracts ecommerce domain from package.json", async () => {
		await writeFile(
			"package.json",
			JSON.stringify({
				name: "super-store",
				description: "Online shop with product catalog and checkout",
				keywords: ["ecommerce", "retail"],
			}),
		)
		const domain = await inferWorkspaceDomain(tmpDir)
		expect(domain.keywords).toContain("shop")
		expect(domain.keywords).toContain("product")
		expect(domain.keywords).toContain("checkout")
		expect(domain.projectName).toBe("super-store")
	})

	it("extracts entities from source files", async () => {
		await writeFile("src/PatientRecord.ts", "export class PatientRecord { id: string }")
		await writeFile("src/api/patients.ts", "app.get('/api/patients', () => {})")
		const domain = await inferWorkspaceDomain(tmpDir)
		expect(domain.entities).toContain("PatientRecord")
		expect(domain.keywords).toContain("patients")
	})
})

describe("inferRequestDomain", () => {
	it("detects pet domain in request", () => {
		const domain = inferRequestDomain("Add a dog adoption feature with breed search")
		expect(domain.keywords).toContain("dog")
		expect(domain.keywords).toContain("adoption")
		expect(domain.keywords).toContain("breed")
	})

	it("detects finance domain in request", () => {
		const domain = inferRequestDomain("Implement stock trading and portfolio management")
		expect(domain.keywords).toContain("stock")
		expect(domain.keywords).toContain("trading")
		expect(domain.keywords).toContain("portfolio")
	})
})

describe("detectDomainMismatch", () => {
	it("detects high-confidence mismatch when request is unrelated to workspace", async () => {
		await writeFile("README.md", "# MediCare\nA medical records platform for hospitals.")
		await writeFile("package.json", JSON.stringify({ name: "medicare", description: "EMR system" }))
		const result = await detectDomainMismatch(tmpDir, "Create a dog adoption page with breed filters")
		expect(result.mismatch).toBe(true)
		expect(result.confidence).toBe("high")
		expect(result.reason).toContain("medical")
		expect(result.reason).toContain("pet")
	})

	it("allows same-domain requests", async () => {
		await writeFile("README.md", "# MediCare\nA medical records platform for hospitals.")
		await writeFile("package.json", JSON.stringify({ name: "medicare", description: "EMR system" }))
		const result = await detectDomainMismatch(tmpDir, "Add patient diagnosis workflow")
		expect(result.mismatch).toBe(false)
	})

	it("is lenient when workspace domain is unclear", async () => {
		// No README, no package.json
		const result = await detectDomainMismatch(tmpDir, "Create a dog adoption page")
		expect(result.mismatch).toBe(false)
		expect(result.confidence).toBe("low")
	})

	it("allows requests with shared keywords (integration scenario)", async () => {
		await writeFile("README.md", "# MediCare\nA medical records platform.")
		await writeFile("package.json", JSON.stringify({ name: "medicare" }))
		// "patient portal" shares "patient" which is in medical domain
		const result = await detectDomainMismatch(tmpDir, "Build a patient portal dashboard")
		expect(result.mismatch).toBe(false)
	})
})
