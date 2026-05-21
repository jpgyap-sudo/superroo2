/**
 * MemoryApprovalService — Secret redaction + approval queue management
 *
 * Features:
 * - Secret/API key redaction before storage
 * - Configurable approval rules per memory type
 * - Dangerous pattern detection
 * - Approval queue CRUD
 */

// Patterns that indicate sensitive data
const SECRET_PATTERNS = [
	/(?:api[_-]?key|apikey|api_key)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}['"]?/gi,
	/(?:sk-[a-zA-Z0-9]{20,})/g, // OpenAI keys
	/(?:ghp_[a-zA-Z0-9]{36})/g, // GitHub PAT
	/(?:gho_[a-zA-Z0-9]{36})/g, // GitHub OAuth
	/(?:xox[bpras]-[a-zA-Z0-9\-]{24,})/g, // Slack tokens
	/(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/g, // Private keys
	/(?:AKIA[0-9A-Z]{16})/g, // AWS access keys
	/(?:eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,})/g, // JWTs
	/(?:password|passwd|pwd)\s*[:=]\s*['"]?[^'"]{8,}['"]?/gi,
	/(?:secret|token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{8,}['"]?/gi,
	/(?:mongodb\+srv:\/\/[^@]+@)/g, // MongoDB connection strings
	/(?:postgres(?:ql)?:\/\/[^@]+@)/g, // Postgres connection strings
	/(?:redis:\/\/:[^@]+@)/g, // Redis connection strings
]

// Patterns that indicate dangerous or low-quality content
const DANGEROUS_CONTENT_PATTERNS = [
	/rm\s+-rf\s+\//g, // rm -rf /
	/DROP\s+TABLE/gi, // SQL injection
	/TRUNCATE\s+TABLE/gi,
	/EXEC\s+xp_cmdshell/gi, // MSSQL command execution
	/eval\s*\(\s*request/gi, // Unsafe eval
	/innerHTML\s*=\s*request/gi, // XSS
]

class MemoryApprovalService {
	/**
	 * @param {object} [options]
	 * @param {string[]} [options.requireApprovalFor] - Memory types that need approval
	 * @param {number} [options.minConfidenceForAutoApprove=0.9]
	 * @param {boolean} [options.redactSecrets=true]
	 */
	constructor(options = {}) {
		this.requireApprovalFor = options.requireApprovalFor || ["bug", "pattern", "decision"]
		this.minConfidenceForAutoApprove = options.minConfidenceForAutoApprove || 0.9
		this.redactSecrets = options.redactSecrets !== undefined ? options.redactSecrets : true
	}

	/**
	 * Check if a memory requires human approval before being active.
	 */
	shouldRequireApproval(memory) {
		// High-confidence lessons auto-approve
		if ((memory.confidence || 0) >= this.minConfidenceForAutoApprove) {
			return false
		}

		// Specific memory types always require approval
		if (this.requireApprovalFor.includes(memory.memoryType || memory.memory_type)) {
			return true
		}

		// Low-importance memories require approval
		if ((memory.importance || 0) < 0.4) {
			return true
		}

		// Check for dangerous content
		const content = memory.content || ""
		for (const pattern of DANGEROUS_CONTENT_PATTERNS) {
			if (pattern.test(content)) {
				return true
			}
		}

		return false
	}

	/**
	 * Sanitize lesson content by redacting secrets and sensitive data.
	 * Returns the sanitized string.
	 */
	sanitizeLesson(content) {
		if (!content || !this.redactSecrets) {
			return content || ""
		}

		let sanitized = content

		for (const pattern of SECRET_PATTERNS) {
			sanitized = sanitized.replace(pattern, (match) => {
				// Preserve the key name but redact the value
				const keyMatch = match.match(/^([a-zA-Z_\-]+)\s*[:=]\s*['"]?/)
				if (keyMatch) {
					return `${keyMatch[1]}: [REDACTED]`
				}
				return "[REDACTED_SECRET]"
			})
		}

		return sanitized
	}

	/**
	 * Check content for dangerous patterns.
	 * Returns array of { pattern, match } for each dangerous pattern found.
	 */
	checkDangerousContent(content) {
		if (!content) return []

		const findings = []
		for (const pattern of DANGEROUS_CONTENT_PATTERNS) {
			const matches = content.match(pattern)
			if (matches) {
				findings.push({
					pattern: pattern.source,
					matches: matches.slice(0, 3), // limit to first 3
				})
			}
		}
		return findings
	}

	/**
	 * Get pending approval queue items.
	 */
	async getPendingApprovals(memoryService, projectId, limit = 50) {
		const result = await memoryService.query(
			`SELECT aq.*, am.title, am.summary, am.memory_type, am.agent, am.confidence, am.importance
       FROM memory_approval_queue aq
       JOIN agent_memory am ON am.id = aq.memory_id
       WHERE aq.status = 'pending'
       AND (aq.project_id = $1 OR $1 IS NULL)
       ORDER BY aq.created_at DESC
       LIMIT $2`,
			[projectId || null, limit],
		)
		return result.rows || []
	}

	/**
	 * Approve a pending memory.
	 */
	async approveMemory(memoryService, approvalId, reviewedBy) {
		// Get the approval record
		const approvalResult = await memoryService.query(
			`SELECT * FROM memory_approval_queue WHERE id = $1 AND status = 'pending'`,
			[approvalId],
		)

		if (approvalResult.rows.length === 0) {
			throw new Error(`Approval record ${approvalId} not found or already processed`)
		}

		const approval = approvalResult.rows[0]

		// Update approval status
		await memoryService.query(
			`UPDATE memory_approval_queue SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
			[reviewedBy, approvalId],
		)

		// Update memory status
		await memoryService.updateStatus(approval.memory_id, "approved", reviewedBy)

		return { approvalId, memoryId: approval.memory_id, status: "approved" }
	}

	/**
	 * Reject a pending memory.
	 */
	async rejectMemory(memoryService, approvalId, reviewedBy) {
		const approvalResult = await memoryService.query(
			`SELECT * FROM memory_approval_queue WHERE id = $1 AND status = 'pending'`,
			[approvalId],
		)

		if (approvalResult.rows.length === 0) {
			throw new Error(`Approval record ${approvalId} not found or already processed`)
		}

		const approval = approvalResult.rows[0]

		await memoryService.query(
			`UPDATE memory_approval_queue SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
			[reviewedBy, approvalId],
		)

		await memoryService.updateStatus(approval.memory_id, "rejected", reviewedBy)

		return { approvalId, memoryId: approval.memory_id, status: "rejected" }
	}
}

module.exports = { MemoryApprovalService, SECRET_PATTERNS, DANGEROUS_CONTENT_PATTERNS }
