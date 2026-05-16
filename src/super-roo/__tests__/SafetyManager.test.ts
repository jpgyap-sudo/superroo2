import { describe, expect, it } from "vitest"

import { SafetyManager } from "../safety/SafetyManager"
import { SafetyMode } from "../types"

const TEST_BLOCKLIST = {
	commandPatterns: ["rm\\s+-rf\\s+/(?:\\s|$)", "\\bcat\\s+\\.env\\b"],
	sqlPatterns: ["DROP\\s+DATABASE", "TRUNCATE\\s+TABLE"],
	pathPatterns: ["^/etc/"],
	capabilityRules: {
		OFF: [],
		SAFE: ["read.file", "network.crawl"],
		AUTO: ["read.file", "write.file", "execute.command", "git.commit", "git.push", "deploy.staging"],
		FULL_AUTONOMOUS: [
			"read.file",
			"write.file",
			"execute.command",
			"database.sql.read",
			"database.sql.write",
			"database.sql.migrate",
			"database.sql.admin",
			"git.commit",
			"git.push",
			"deploy.staging",
			"deploy.production",
			"supabase.manage.local",
			"supabase.manage.remote",
		],
	},
}

describe("SafetyManager — capability checks by mode", () => {
	it("OFF blocks everything including reads", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.OFF, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("read.file").allowed).toBe(false)
		expect(s.checkCapability("write.file").allowed).toBe(false)
	})

	it("SAFE allows reads and crawls but not writes", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.SAFE, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("read.file").allowed).toBe(true)
		expect(s.checkCapability("network.crawl").allowed).toBe(true)
		expect(s.checkCapability("write.file").allowed).toBe(false)
		expect(s.checkCapability("execute.command").allowed).toBe(false)
	})

	it("AUTO allows edits/commits/staging but blocks production deploy", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("write.file").allowed).toBe(true)
		expect(s.checkCapability("git.commit").allowed).toBe(true)
		expect(s.checkCapability("deploy.staging").allowed).toBe(true)
		expect(s.checkCapability("deploy.production").allowed).toBe(false)
	})

	it("FULL_AUTONOMOUS allows production deploy", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.FULL_AUTONOMOUS, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("deploy.production").allowed).toBe(true)
	})

	it("FULL_AUTONOMOUS allows Supabase and SQL administration", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.FULL_AUTONOMOUS, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("database.sql.admin").allowed).toBe(true)
		expect(s.checkCapability("supabase.manage.remote").allowed).toBe(true)
	})

	it("checkCapabilities returns the first failure", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.SAFE, blocklist: TEST_BLOCKLIST })
		const d = s.checkCapabilities(["read.file", "write.file", "git.push"])
		expect(d.allowed).toBe(false)
		expect(d.reason).toContain("write.file")
	})

	it("setMode mutates", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.SAFE, blocklist: TEST_BLOCKLIST })
		expect(s.checkCapability("write.file").allowed).toBe(false)
		s.setMode(SafetyMode.AUTO)
		expect(s.checkCapability("write.file").allowed).toBe(true)
	})
})

describe("SafetyManager — command blocklist", () => {
	const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST })

	it("blocks rm -rf /", () => {
		expect(s.checkCommand("rm -rf /").allowed).toBe(false)
		expect(s.checkCommand("rm -rf / --no-preserve-root").allowed).toBe(false)
	})

	it("does not over-block legitimate rm -rf", () => {
		expect(s.checkCommand("rm -rf node_modules").allowed).toBe(true)
		expect(s.checkCommand("rm -rf ./build/dist").allowed).toBe(true)
	})

	it("blocks cat .env", () => {
		expect(s.checkCommand("cat .env").allowed).toBe(false)
	})

	it("blocks SQL inside shell commands", () => {
		expect(s.checkCommand('psql -c "DROP DATABASE prod"').allowed).toBe(false)
	})

	it("ignores empty input", () => {
		expect(s.checkCommand("").allowed).toBe(true)
		expect(s.checkCommand("   ").allowed).toBe(true)
	})
})

describe("SafetyManager — path blocklist", () => {
	const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST })
	it("blocks /etc paths", () => {
		expect(s.checkPath("/etc/passwd").allowed).toBe(false)
		expect(s.checkPath("/etc/nginx/nginx.conf").allowed).toBe(false)
	})
	it("allows project paths", () => {
		expect(s.checkPath("/home/user/project/src/index.ts").allowed).toBe(true)
	})
})

describe("SafetyManager — self-improve guard", () => {
	it("blocks edits inside super-roo when selfImprove=false", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST, selfImprove: false })
		const d = s.checkSelfImproveBoundary("/repo/src/super-roo/safety/SafetyManager.ts", "/repo/src/super-roo")
		expect(d.allowed).toBe(false)
		expect(d.reason).toMatch(/super_roo_self_improve/)
	})

	it("allows edits inside super-roo when selfImprove=true", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST, selfImprove: true })
		const d = s.checkSelfImproveBoundary("/repo/src/super-roo/safety/SafetyManager.ts", "/repo/src/super-roo")
		expect(d.allowed).toBe(true)
	})

	it("allows edits outside super-roo regardless of mode", () => {
		const s = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: TEST_BLOCKLIST, selfImprove: false })
		const d = s.checkSelfImproveBoundary("/some/user/workspace/index.ts", "/repo/src/super-roo")
		expect(d.allowed).toBe(true)
	})
})

describe("SafetyManager — invalid pattern handling", () => {
	it("does not throw on a malformed regex; just drops it", () => {
		const s = new SafetyManager({
			initialMode: SafetyMode.AUTO,
			blocklist: {
				...TEST_BLOCKLIST,
				commandPatterns: ["[invalid(", "rm\\s+-rf\\s+/"],
			},
		})
		expect(s.checkCommand("rm -rf /").allowed).toBe(false)
		expect(s.checkCommand("anything").allowed).toBe(true)
	})
})
