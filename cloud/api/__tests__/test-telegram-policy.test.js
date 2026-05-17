/**
 * Tests for telegramPolicy.js
 *
 * Run with: cd src && npx vitest run ../cloud/api/__tests__/test-telegram-policy.test.js
 */

const path = require("path")
const policyPath = path.join(__dirname, "..", "telegramPolicy.js")

// Clear any cached module state
delete require.cache[require.resolve(policyPath)]

describe("telegramPolicy", () => {
	let policy

	beforeEach(() => {
		// Reset env before each test
		delete process.env.REQUIRE_CODING_APPROVAL
		delete process.env.DASHBOARD_URL
		// Re-require to pick up fresh env
		delete require.cache[require.resolve(policyPath)]
		policy = require(policyPath)
	})

	describe("canRunWithoutApproval", () => {
		test("allows chat without approval", () => {
			expect(policy.canRunWithoutApproval("chat")).toBe(true)
		})

		test("allows debug_plan without approval", () => {
			expect(policy.canRunWithoutApproval("debug_plan")).toBe(true)
		})

		test("allows read_logs without approval", () => {
			expect(policy.canRunWithoutApproval("read_logs")).toBe(true)
		})

		test("allows run_tests without approval", () => {
			expect(policy.canRunWithoutApproval("run_tests")).toBe(true)
		})

		test("allows create_branch without approval", () => {
			expect(policy.canRunWithoutApproval("create_branch")).toBe(true)
		})

		test("allows create_pr without approval", () => {
			expect(policy.canRunWithoutApproval("create_pr")).toBe(true)
		})

		test("allows restart_worker without approval", () => {
			expect(policy.canRunWithoutApproval("restart_worker")).toBe(true)
		})

		test("blocks deploy without approval", () => {
			expect(policy.canRunWithoutApproval("deploy")).toBe(false)
		})

		test("blocks delete_data without approval", () => {
			expect(policy.canRunWithoutApproval("delete_data")).toBe(false)
		})

		test("blocks destructive shell without approval", () => {
			expect(policy.canRunWithoutApproval("shell", "rm -rf /")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "sudo apt install nginx")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "docker run --rm -it ubuntu")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "systemctl restart nginx")).toBe(false)
		})

		test("allows read-only shell commands without approval", () => {
			expect(policy.canRunWithoutApproval("shell", "what version of ollama do i have")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "ollama --version")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "docker ps")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "ps aux")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "df -h")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "free -m")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "systemctl status nginx")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "cat /etc/os-release")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "ls -la")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "uptime")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "curl -I https://example.com")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "ollama list")).toBe(true)
		})

		test("blocks shell without command text (default deny)", () => {
			expect(policy.canRunWithoutApproval("shell")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "")).toBe(false)
		})

		test("blocks unknown actions", () => {
			expect(policy.canRunWithoutApproval("unknown_action")).toBe(false)
		})
	})

	describe("isBlocked", () => {
		test("returns true for deploy", () => {
			expect(policy.isBlocked("deploy")).toBe(true)
		})

		test("returns true for delete_data", () => {
			expect(policy.isBlocked("delete_data")).toBe(true)
		})

		test("returns true for shell", () => {
			expect(policy.isBlocked("shell")).toBe(true)
		})

		test("returns false for safe actions", () => {
			expect(policy.isBlocked("chat")).toBe(false)
			expect(policy.isBlocked("debug_plan")).toBe(false)
			expect(policy.isBlocked("read_logs")).toBe(false)
			expect(policy.isBlocked("run_tests")).toBe(false)
		})
	})

	describe("getBlockedReason", () => {
		test("returns deploy-specific message with dashboard link", () => {
			const reason = policy.getBlockedReason("deploy")
			expect(reason).toContain("Blocked for Safety")
			expect(reason).toContain("Deploy")
			expect(reason).toContain("dashboard")
			expect(reason).toContain("https://dev.abcx124.xyz")
		})

		test("returns delete_data-specific message with warning", () => {
			const reason = policy.getBlockedReason("delete_data")
			expect(reason).toContain("Blocked for Safety")
			expect(reason).toContain("irreversible")
			expect(reason).toContain("Dashboard")
		})

		test("returns shell-specific message with SSH hint when command text provided", () => {
			const reason = policy.getBlockedReason("shell", "what version of ollama do i have")
			expect(reason).toContain("Blocked for Safety")
			expect(reason).toContain("shell command")
			expect(reason).toContain("ssh root@100.64.175.88")
			expect(reason).toContain("ide-terminal")
		})

		test("returns shell-specific message without SSH hint when no command text provided", () => {
			const reason = policy.getBlockedReason("shell")
			expect(reason).toContain("Blocked for Safety")
			expect(reason).toContain("ide-terminal")
			expect(reason).not.toContain("Try this yourself")
		})

		test("returns generic message for unknown kind", () => {
			const reason = policy.getBlockedReason("unknown")
			expect(reason).toContain("Blocked for Safety")
			expect(reason).toContain("Dashboard")
		})
	})

	describe("getActionLabel", () => {
		test("returns correct labels for all kinds", () => {
			expect(policy.getActionLabel("chat")).toContain("Chat")
			expect(policy.getActionLabel("debug_plan")).toContain("Debug")
			expect(policy.getActionLabel("read_logs")).toContain("Logs")
			expect(policy.getActionLabel("run_tests")).toContain("Tests")
			expect(policy.getActionLabel("create_branch")).toContain("Branch")
			expect(policy.getActionLabel("create_pr")).toContain("PR")
			expect(policy.getActionLabel("restart_worker")).toContain("Restart")
			expect(policy.getActionLabel("deploy")).toContain("Deploy")
			expect(policy.getActionLabel("delete_data")).toContain("Delete")
			expect(policy.getActionLabel("shell")).toContain("Shell")
		})

		test("returns Unknown for unrecognized kind", () => {
			expect(policy.getActionLabel("foobar")).toContain("Unknown")
		})
	})

	describe("isSafeShellCommand", () => {
		test("returns true for read-only commands", () => {
			expect(policy.isSafeShellCommand("ollama --version")).toBe(true)
			expect(policy.isSafeShellCommand("docker ps")).toBe(true)
			expect(policy.isSafeShellCommand("ps aux")).toBe(true)
			expect(policy.isSafeShellCommand("df -h")).toBe(true)
			expect(policy.isSafeShellCommand("cat /etc/passwd")).toBe(true)
		})

		test("returns false for destructive commands", () => {
			expect(policy.isSafeShellCommand("rm -rf /")).toBe(false)
			expect(policy.isSafeShellCommand("sudo apt install nginx")).toBe(false)
			expect(policy.isSafeShellCommand("docker run -it ubuntu")).toBe(false)
			expect(policy.isSafeShellCommand("systemctl restart nginx")).toBe(false)
			expect(policy.isSafeShellCommand("curl -o file.zip https://example.com")).toBe(false)
		})

		test("returns false for empty or missing input", () => {
			expect(policy.isSafeShellCommand("")).toBe(false)
			expect(policy.isSafeShellCommand()).toBe(false)
			expect(policy.isSafeShellCommand(null)).toBe(false)
		})

		test("dangerous patterns override safe patterns", () => {
			// "ps" is safe, but "sudo ps" is dangerous
			expect(policy.isSafeShellCommand("sudo ps aux")).toBe(false)
			// "cat" is safe, but "cat > file" is dangerous
			expect(policy.isSafeShellCommand("cat > /etc/passwd")).toBe(false)
		})
	})

	describe("REQUIRE_CODING_APPROVAL env var", () => {
		test("blocks safe actions when REQUIRE_CODING_APPROVAL is true", () => {
			process.env.REQUIRE_CODING_APPROVAL = "true"
			delete require.cache[require.resolve(policyPath)]
			const strictPolicy = require(policyPath)
			expect(strictPolicy.canRunWithoutApproval("chat")).toBe(false)
			expect(strictPolicy.canRunWithoutApproval("debug_plan")).toBe(false)
			expect(strictPolicy.canRunWithoutApproval("run_tests")).toBe(false)
		})
	})
})
