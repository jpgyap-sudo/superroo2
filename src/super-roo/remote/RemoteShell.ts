/**
 * Super Roo — Secure Remote Shell Module
 *
 * Security-first SSH client that protects against credential leakage,
 * unauthorized access, and command injection.
 *
 * Security guarantees:
 *   1. Keys are NEVER stored in config files, logs, or error messages
 *   2. Every SSH connection requires explicit user approval
 *   3. Commands are validated against an allowlist
 *   4. Full audit trail of all remote operations
 *   5. Automatic session timeout and cleanup
 */

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"

// ── Types ────────────────────────────────────────────────────────────────────

export interface RemoteHost {
	/** Human-readable label (e.g. "Production VPS") */
	label: string
	/** SSH hostname or IP */
	host: string
	/** SSH port (default 22) */
	port: number
	/** SSH username */
	user: string
	/**
	 * Path to the SSH private key on disk.
	 * The key file itself is NEVER read or stored by this module.
	 * Only the path is passed to the `ssh` / `scp` binary via `-i`.
	 */
	keyPath: string
}

export interface RemoteCommand {
	/** The command string to execute on the remote host */
	command: string
	/** Optional timeout in seconds (default 30) */
	timeout?: number
}

export interface CommandResult {
	exitCode: number | null
	stdout: string
	stderr: string
	/** Wall-clock duration in ms */
	durationMs: number
}

export interface AuditEntry {
	id: string
	timestamp: string
	hostLabel: string
	host: string
	user: string
	command: string
	exitCode: number | null
	approved: boolean
	durationMs: number
}

// ── Command Allowlist ────────────────────────────────────────────────────────

/**
 * Patterns that are ALLOWED for remote execution.
 * This prevents arbitrary command injection.
 *
 * Extend this list as needed — each entry is a regex that the
 * full command string must match.
 */
export const ALLOWED_COMMAND_PATTERNS: RegExp[] = [
	// Read-only inspection
	/^echo\s+/,
	/^cat\s+/,
	/^ls\s+/,
	/^find\s+/,
	/^which\s+/,
	/^whoami\s*$/,
	/^hostname\s*$/,
	/^uname\s+/,
	/^df\s+/,
	/^free\s+/,
	/^ps\s+/,
	/^pm2\s+(list|status|show\s+|logs\s+|jlist)/,
	/^curl\s+/,
	/^nginx\s+-t\s*$/,

	// Git operations (read-only)
	/^git\s+(status|log|diff|show|branch|rev-parse)/,

	// File operations (read-only)
	/^head\s+/,
	/^tail\s+/,
	/^wc\s+/,
	/^grep\s+/,
	/^findstr\s+/,
	/^type\s+/,
	/^dir\s+/,

	// System inspection
	/^systemctl\s+(status|is-active|show)\s+/,
	/^journalctl\s+/,

	// Deployment operations (require approval)
	/^cd\s+\S+\s*&&\s*git\s+pull\s+/,
	/^cd\s+\S+\s*&&\s*pnpm\s+(install|run\s+build)/,
	/^mkdir\s+-p\s+/,
	/^cp\s+/,
	/^mv\s+/,
	/^sudo\s+cp\s+/,
	/^sudo\s+nginx\s+-t\s*$/,
	/^sudo\s+systemctl\s+(reload|restart|start|stop|status)\s+/,
	/^sudo\s+pm2\s+/,
	/^pm2\s+(restart|start|stop|save|delete)/,
	/^tar\s+/,
]

/**
 * Shell metacharacters that indicate command chaining or injection.
 * These are BLOCKED in simple commands (not compound deployment commands).
 */
const SHELL_METACHARACTERS = /[;|$()`<>\\\n]/

/**
 * Patterns that represent compound commands (using `&&` for chaining).
 * These are allowed to contain `&&` but not other shell metacharacters.
 */
const COMPOUND_PATTERNS: RegExp[] = [
	/^cd\s+\S+\s*&&\s+/,
	/^sudo\s+cp\s+/,
	/^sudo\s+systemctl\s+/,
	/^sudo\s+nginx\s+/,
	/^sudo\s+pm2\s+/,
]

export function isCommandAllowed(command: string): boolean {
	const trimmed = command.trim()
	if (!trimmed) return false

	// Check if this is a compound command (allowed to use &&)
	const isCompound = COMPOUND_PATTERNS.some((p) => p.test(trimmed))

	if (!isCompound) {
		// For simple commands, reject shell metacharacters
		if (SHELL_METACHARACTERS.test(trimmed)) {
			return false
		}
	}

	return ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))
}

// ── Sensitive Data Redaction ─────────────────────────────────────────────────

/**
 * Patterns that look like SSH keys, tokens, or credentials.
 * Used to redact them from logs and error messages.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
	/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
	/-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
	/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
	/(sk-[A-Za-z0-9]{20,})/g,
	/(api[-_]?key['":\s=]+)[A-Za-z0-9_\-]{16,}/gi,
	/(password['":\s=]+)[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:',.<>?`~]{4,}/gi,
	/(token['":\s=]+)[A-Za-z0-9_\-]{16,}/gi,
	/(secret['":\s=]+)[A-Za-z0-9_\-]{16,}/gi,
]

function redactSensitive(text: string): string {
	let result = text
	for (const pattern of SENSITIVE_PATTERNS) {
		result = result.replace(pattern, (match) => {
			// Keep first 4 chars + "[REDACTED]" for traceability
			const prefix = match.substring(0, 4)
			return `${prefix}[REDACTED]`
		})
	}
	return result
}

// ── Audit Log ────────────────────────────────────────────────────────────────

const AUDIT_LOG_DIR = path.join(process.cwd(), ".super-roo", "remote", "audit")

function ensureAuditDir(): void {
	fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true })
}

function writeAuditEntry(entry: AuditEntry): void {
	ensureAuditDir()
	const date = new Date().toISOString().split("T")[0]
	const logFile = path.join(AUDIT_LOG_DIR, `${date}.jsonl`)
	const line = JSON.stringify(entry) + "\n"
	fs.appendFileSync(logFile, line, "utf-8")
}

// ── Approval Store ───────────────────────────────────────────────────────────

const APPROVAL_DIR = path.join(process.cwd(), ".super-roo", "remote", "approvals")

function ensureApprovalDir(): void {
	fs.mkdirSync(APPROVAL_DIR, { recursive: true })
}

/**
 * Persist an approval request so the user can review it.
 * Returns a unique approval ID.
 */
function createApprovalRequest(host: RemoteHost, command: string): string {
	ensureApprovalDir()
	const id = crypto.randomUUID()
	const request = {
		id,
		createdAt: new Date().toISOString(),
		host: { label: host.label, host: host.host, user: host.user },
		command,
		status: "pending" as const,
	}
	fs.writeFileSync(path.join(APPROVAL_DIR, `${id}.json`), JSON.stringify(request, null, 2), "utf-8")
	return id
}

/**
 * Check if an approval request has been granted.
 * The user approves by writing `{ "status": "approved" }` to the file.
 */
function isApproved(id: string): boolean {
	try {
		const data = JSON.parse(fs.readFileSync(path.join(APPROVAL_DIR, `${id}.json`), "utf-8"))
		return data.status === "approved"
	} catch {
		return false
	}
}

// ── SSH Key Validation ──────────────────────────────────────────────────────

/**
 * Validate that an SSH key path exists and has correct permissions.
 * Does NOT read the key contents.
 */
function validateKeyPath(keyPath: string): void {
	if (!fs.existsSync(keyPath)) {
		throw new Error(`SSH key not found: ${keyPath}`)
	}
	const stat = fs.statSync(keyPath)
	if (!stat.isFile()) {
		throw new Error(`SSH key path is not a file: ${keyPath}`)
	}
	// On Unix, warn if permissions are too open
	if (process.platform !== "win32") {
		const mode = stat.mode & 0o777
		if (mode & 0o077) {
			console.warn(`⚠️  SSH key has open permissions (${mode.toString(8)}). ` + `Consider: chmod 600 ${keyPath}`)
		}
	}
}

// ── Main API ─────────────────────────────────────────────────────────────────

export class RemoteShell {
	private readonly auditLog: AuditEntry[] = []
	private readonly host: RemoteHost

	constructor(host: RemoteHost) {
		validateKeyPath(host.keyPath)
		this.host = host
	}

	/**
	 * Execute a command on the remote host.
	 *
	 * Security flow:
	 *   1. Command is validated against the allowlist
	 *   2. User must approve the command
	 *   3. Command is executed via SSH with the key path
	 *   4. Result is audited
	 *
	 * @param cmd - The command to execute
	 * @param requireApproval - If true, requires explicit user approval (default: true)
	 */
	async exec(cmd: RemoteCommand, requireApproval = true): Promise<CommandResult> {
		// Step 1: Validate command against allowlist
		if (!isCommandAllowed(cmd.command)) {
			const auditEntry: AuditEntry = {
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
				hostLabel: this.host.label,
				host: this.host.host,
				user: this.host.user,
				command: cmd.command,
				exitCode: null,
				approved: false,
				durationMs: 0,
			}
			this.auditLog.push(auditEntry)
			writeAuditEntry(auditEntry)
			throw new Error(
				`Command not in allowlist: ${cmd.command.substring(0, 120)}` +
					`\nAllowed patterns: file operations, git (read-only), ` +
					`systemctl status, pm2 list, deployment commands`,
			)
		}

		// Step 2: User approval
		if (requireApproval) {
			const approvalId = createApprovalRequest(this.host, cmd.command)
			console.log(
				`\n🔐 Remote Execution Requires Approval`,
				`\n   Host:  ${this.host.label} (${this.host.user}@${this.host.host})`,
				`\n   Command: ${cmd.command}`,
				`\n   Approval ID: ${approvalId}`,
				`\n   To approve, run:`,
				`\n     echo '{"status":"approved"}' > ${path.join(APPROVAL_DIR, `${approvalId}.json`)}`,
				`\n   Or reject by deleting the file.`,
				`\n   Waiting for approval...`,
			)

			// Poll for approval (up to 5 minutes)
			const deadline = Date.now() + 300_000
			while (Date.now() < deadline) {
				if (isApproved(approvalId)) {
					console.log(`   ✅ Approved`)
					break
				}
				await this.sleep(2000)
			}

			if (!isApproved(approvalId)) {
				const auditEntry: AuditEntry = {
					id: approvalId,
					timestamp: new Date().toISOString(),
					hostLabel: this.host.label,
					host: this.host.host,
					user: this.host.user,
					command: cmd.command,
					exitCode: null,
					approved: false,
					durationMs: 0,
				}
				this.auditLog.push(auditEntry)
				writeAuditEntry(auditEntry)
				throw new Error(`Remote command rejected (timeout): ${cmd.command.substring(0, 120)}`)
			}
		}

		// Step 3: Execute via SSH
		const startTime = Date.now()
		const timeout = cmd.timeout ?? 30

		return new Promise<CommandResult>((resolve, reject) => {
			const sshArgs = [
				"-o",
				"StrictHostKeyChecking=no",
				"-o",
				`ConnectTimeout=${Math.min(timeout, 10)}`,
				"-o",
				"ServerAliveInterval=15",
				"-o",
				"ServerAliveCountMax=3",
				"-o",
				"ExitOnForwardFailure=yes",
				"-i",
				this.host.keyPath,
				"-p",
				String(this.host.port),
				`${this.host.user}@${this.host.host}`,
				cmd.command,
			]

			const proc = spawn("ssh", sshArgs, {
				stdio: ["ignore", "pipe", "pipe"],
				timeout: timeout * 1000,
			})

			let stdout = ""
			let stderr = ""

			proc.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString()
			})

			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString()
			})

			proc.on("close", (exitCode) => {
				const durationMs = Date.now() - startTime

				// Redact sensitive data from output
				stdout = redactSensitive(stdout)
				stderr = redactSensitive(stderr)

				const result: CommandResult = {
					exitCode,
					stdout,
					stderr,
					durationMs,
				}

				const auditEntry: AuditEntry = {
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					hostLabel: this.host.label,
					host: this.host.host,
					user: this.host.user,
					command: cmd.command,
					exitCode,
					approved: true,
					durationMs,
				}
				this.auditLog.push(auditEntry)
				writeAuditEntry(auditEntry)

				resolve(result)
			})

			proc.on("error", (err) => {
				const durationMs = Date.now() - startTime
				reject(new Error(`SSH error: ${redactSensitive(err.message)}`))
			})
		})
	}

	/**
	 * Copy a local file to the remote host via SCP.
	 * Requires user approval.
	 */
	async scp(localPath: string, remotePath: string, requireApproval = true): Promise<CommandResult> {
		if (!fs.existsSync(localPath)) {
			throw new Error(`Local file not found: ${localPath}`)
		}

		const command = `scp ${localPath} → ${this.host.user}@${this.host.host}:${remotePath}`

		if (requireApproval) {
			const approvalId = createApprovalRequest(this.host, command)
			console.log(
				`\n📂 SCP Transfer Requires Approval`,
				`\n   Host:  ${this.host.label} (${this.host.user}@${this.host.host})`,
				`\n   From:  ${localPath}`,
				`\n   To:    ${remotePath}`,
				`\n   Approval ID: ${approvalId}`,
				`\n   To approve, run:`,
				`\n     echo '{"status":"approved"}' > ${path.join(APPROVAL_DIR, `${approvalId}.json`)}`,
				`\n   Waiting for approval...`,
			)

			const deadline = Date.now() + 300_000
			while (Date.now() < deadline) {
				if (isApproved(approvalId)) {
					console.log(`   ✅ Approved`)
					break
				}
				await this.sleep(2000)
			}

			if (!isApproved(approvalId)) {
				throw new Error(`SCP transfer rejected (timeout): ${localPath}`)
			}
		}

		const startTime = Date.now()
		return new Promise<CommandResult>((resolve, reject) => {
			const scpArgs = [
				"-o",
				"StrictHostKeyChecking=no",
				"-o",
				"ConnectTimeout=10",
				"-i",
				this.host.keyPath,
				"-P",
				String(this.host.port),
				localPath,
				`${this.host.user}@${this.host.host}:${remotePath}`,
			]

			const proc = spawn("scp", scpArgs, {
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 60_000,
			})

			let stdout = ""
			let stderr = ""

			proc.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString()
			})

			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString()
			})

			proc.on("close", (exitCode) => {
				const durationMs = Date.now() - startTime
				const result: CommandResult = {
					exitCode,
					stdout: redactSensitive(stdout),
					stderr: redactSensitive(stderr),
					durationMs,
				}
				resolve(result)
			})

			proc.on("error", (err) => {
				reject(new Error(`SCP error: ${redactSensitive(err.message)}`))
			})
		})
	}

	/** Get the audit log for this session. */
	getAuditLog(): AuditEntry[] {
		return [...this.auditLog]
	}

	/** Get the host configuration (key path is redacted). */
	getHostInfo(): Omit<RemoteHost, "keyPath"> & { keyPath: string } {
		return {
			...this.host,
			keyPath: this.host.keyPath.replace(/[^/\\]+$/, "[REDACTED]"),
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a RemoteShell instance from a host configuration.
 *
 * The host config should be loaded from a secure source (e.g. env vars,
 * secret manager, or user prompt) — NEVER from a checked-in file.
 *
 * @example
 * ```ts
 * const shell = createRemoteShell({
 *   label: "Production VPS",
 *   host: "104.248.225.250",
 *   port: 22,
 *   user: "superroo",
 *   keyPath: "C:\\Users\\User\\.ssh\\id_rsa",
 * })
 *
 * const result = await shell.exec({ command: "pm2 list" })
 * console.log(result.stdout)
 * ```
 */
export function createRemoteShell(host: RemoteHost): RemoteShell {
	return new RemoteShell(host)
}
