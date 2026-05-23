"use client"

/**
 * Smart Autocomplete — Context-aware command suggestions for the Dashboard terminal.
 *
 * Provides suggestions for:
 *   - File paths (from workspace files)
 *   - Git commands (branches, status, log)
 *   - Docker commands (ps, logs, exec, compose)
 *   - npm/pnpm commands (scripts from package.json)
 *   - Recent command history (fuzzy match)
 *   - Common shell commands
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface AutocompleteMatch {
	text: string
	description: string
	type: "file" | "git" | "docker" | "npm" | "history" | "shell" | "agent"
	relevance: number // 0-1, higher = better match
}

// ── Common Shell Commands ──────────────────────────────────────────────────

const SHELL_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "ls", desc: "List directory contents" },
	{ cmd: "ls -la", desc: "List all files with details" },
	{ cmd: "cd", desc: "Change directory" },
	{ cmd: "pwd", desc: "Print working directory" },
	{ cmd: "cat", desc: "Concatenate and display files" },
	{ cmd: "grep", desc: "Search text using patterns" },
	{ cmd: "find", desc: "Search for files" },
	{ cmd: "chmod", desc: "Change file permissions" },
	{ cmd: "mkdir", desc: "Create directory" },
	{ cmd: "rm", desc: "Remove files" },
	{ cmd: "rm -rf", desc: "Force remove recursively" },
	{ cmd: "cp", desc: "Copy files" },
	{ cmd: "mv", desc: "Move/rename files" },
	{ cmd: "head", desc: "Display first lines of file" },
	{ cmd: "tail", desc: "Display last lines of file" },
	{ cmd: "tail -f", desc: "Follow file output" },
	{ cmd: "less", desc: "View file with pager" },
	{ cmd: "echo", desc: "Print text" },
	{ cmd: "env", desc: "Show environment variables" },
	{ cmd: "export", desc: "Set environment variable" },
	{ cmd: "source", desc: "Execute script in current shell" },
	{ cmd: "which", desc: "Locate a command" },
	{ cmd: "whoami", desc: "Show current user" },
	{ cmd: "ps aux", desc: "List all processes" },
	{ cmd: "kill", desc: "Kill a process" },
	{ cmd: "top", desc: "Show process activity" },
	{ cmd: "htop", desc: "Interactive process viewer" },
	{ cmd: "df -h", desc: "Show disk usage" },
	{ cmd: "du -sh", desc: "Show directory size" },
	{ cmd: "free -h", desc: "Show memory usage" },
	{ cmd: "uname -a", desc: "Show system info" },
	{ cmd: "curl", desc: "HTTP request tool" },
	{ cmd: "wget", desc: "Download tool" },
	{ cmd: "tar", desc: "Archive tool" },
	{ cmd: "zip", desc: "Compress files" },
	{ cmd: "unzip", desc: "Decompress files" },
	{ cmd: "ssh", desc: "SSH connection" },
	{ cmd: "scp", desc: "Secure copy" },
	{ cmd: "rsync", desc: "Remote sync" },
	{ cmd: "crontab -l", desc: "List cron jobs" },
	{ cmd: "crontab -e", desc: "Edit cron jobs" },
	{ cmd: "systemctl", desc: "Systemd service manager" },
	{ cmd: "journalctl", desc: "View system logs" },
	{ cmd: "ping", desc: "Test network connectivity" },
	{ cmd: "nslookup", desc: "DNS lookup" },
	{ cmd: "netstat", desc: "Network statistics" },
	{ cmd: "ss", desc: "Socket statistics" },
	{ cmd: "iptables", desc: "Firewall management" },
	{ cmd: "ufw", desc: "Uncomplicated firewall" },
]

const GIT_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "git status", desc: "Show working tree status" },
	{ cmd: "git add .", desc: "Stage all changes" },
	{ cmd: "git add -p", desc: "Stage changes interactively" },
	{ cmd: "git commit -m", desc: "Commit staged changes" },
	{ cmd: "git commit --amend", desc: "Amend last commit" },
	{ cmd: "git push", desc: "Push to remote" },
	{ cmd: "git push --force", desc: "Force push (careful!)" },
	{ cmd: "git pull", desc: "Pull from remote" },
	{ cmd: "git fetch", desc: "Fetch from remote" },
	{ cmd: "git log --oneline -10", desc: "Show last 10 commits" },
	{ cmd: "git log --graph --oneline --all", desc: "Visual commit graph" },
	{ cmd: "git diff", desc: "Show unstaged changes" },
	{ cmd: "git diff --cached", desc: "Show staged changes" },
	{ cmd: "git branch", desc: "List branches" },
	{ cmd: "git branch -d", desc: "Delete branch" },
	{ cmd: "git checkout", desc: "Switch branch" },
	{ cmd: "git checkout -b", desc: "Create and switch branch" },
	{ cmd: "git merge", desc: "Merge branch" },
	{ cmd: "git rebase", desc: "Rebase branch" },
	{ cmd: "git stash", desc: "Stash changes" },
	{ cmd: "git stash pop", desc: "Apply stashed changes" },
	{ cmd: "git reset", desc: "Reset changes" },
	{ cmd: "git reset --hard", desc: "Hard reset (careful!)" },
	{ cmd: "git revert", desc: "Revert a commit" },
	{ cmd: "git cherry-pick", desc: "Cherry-pick a commit" },
	{ cmd: "git blame", desc: "Show who changed each line" },
	{ cmd: "git remote -v", desc: "Show remotes" },
	{ cmd: "git tag", desc: "List tags" },
	{ cmd: "git clean -fd", desc: "Remove untracked files" },
	{ cmd: "git reflog", desc: "Show reference log" },
]

const DOCKER_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "docker ps", desc: "List running containers" },
	{ cmd: "docker ps -a", desc: "List all containers" },
	{ cmd: "docker images", desc: "List images" },
	{ cmd: "docker build -t", desc: "Build an image" },
	{ cmd: "docker run", desc: "Run a container" },
	{ cmd: "docker run -d", desc: "Run container in background" },
	{ cmd: "docker run -it", desc: "Run container interactively" },
	{ cmd: "docker exec -it", desc: "Execute command in container" },
	{ cmd: "docker logs", desc: "View container logs" },
	{ cmd: "docker logs -f", desc: "Follow container logs" },
	{ cmd: "docker stop", desc: "Stop a container" },
	{ cmd: "docker start", desc: "Start a container" },
	{ cmd: "docker restart", desc: "Restart a container" },
	{ cmd: "docker rm", desc: "Remove a container" },
	{ cmd: "docker rmi", desc: "Remove an image" },
	{ cmd: "docker pull", desc: "Pull an image" },
	{ cmd: "docker push", desc: "Push an image" },
	{ cmd: "docker compose up", desc: "Start compose services" },
	{ cmd: "docker compose up -d", desc: "Start compose in background" },
	{ cmd: "docker compose down", desc: "Stop compose services" },
	{ cmd: "docker compose logs -f", desc: "Follow compose logs" },
	{ cmd: "docker compose build", desc: "Build compose services" },
	{ cmd: "docker network ls", desc: "List networks" },
	{ cmd: "docker volume ls", desc: "List volumes" },
	{ cmd: "docker system df", desc: "Show disk usage" },
	{ cmd: "docker system prune", desc: "Clean up unused resources" },
	{ cmd: "docker stats", desc: "Show container stats" },
]

const NPM_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "npm run dev", desc: "Start dev server" },
	{ cmd: "npm run build", desc: "Build project" },
	{ cmd: "npm run start", desc: "Start production server" },
	{ cmd: "npm run test", desc: "Run tests" },
	{ cmd: "npm run lint", desc: "Run linter" },
	{ cmd: "npm install", desc: "Install dependencies" },
	{ cmd: "npm install -g", desc: "Install globally" },
	{ cmd: "npm install --save-dev", desc: "Install dev dependency" },
	{ cmd: "npm uninstall", desc: "Uninstall package" },
	{ cmd: "npm update", desc: "Update packages" },
	{ cmd: "npm outdated", desc: "Check outdated packages" },
	{ cmd: "npm audit", desc: "Run security audit" },
	{ cmd: "npm audit fix", desc: "Fix vulnerabilities" },
	{ cmd: "npm ci", desc: "Clean install from lockfile" },
	{ cmd: "npm publish", desc: "Publish package" },
	{ cmd: "npm version", desc: "Bump version" },
	{ cmd: "npm cache clean", desc: "Clean npm cache" },
	{ cmd: "pnpm install", desc: "Install with pnpm" },
	{ cmd: "pnpm add", desc: "Add package with pnpm" },
	{ cmd: "pnpm remove", desc: "Remove package with pnpm" },
	{ cmd: "pnpm update", desc: "Update with pnpm" },
	{ cmd: "pnpm dev", desc: "Start dev with pnpm" },
	{ cmd: "pnpm build", desc: "Build with pnpm" },
	{ cmd: "pnpm test", desc: "Test with pnpm" },
	{ cmd: "pnpm lint", desc: "Lint with pnpm" },
	{ cmd: "pnpm dlx", desc: "Run package without installing" },
	{ cmd: "npx", desc: "Run npm package" },
]

const AGENT_COMMANDS: { cmd: string; desc: string }[] = [
	{ cmd: "/help", desc: "Show all commands" },
	{ cmd: "/agents", desc: "List available agents" },
	{ cmd: "/skills", desc: "List available skills" },
	{ cmd: "/deploy", desc: "Deploy the project" },
	{ cmd: "/autonomous", desc: "Run autonomous scan" },
	{ cmd: "/debug", desc: "Start debug session" },
	{ cmd: "/test", desc: "Run tests" },
	{ cmd: "/plan", desc: "Create a plan" },
	{ cmd: "/code", desc: "Execute coding task" },
	{ cmd: "/orchestrate", desc: "Break down complex tasks" },
	{ cmd: "/status", desc: "Show system status" },
	{ cmd: "/memory", desc: "Show memory status" },
	{ cmd: "/pipeline", desc: "Show pipeline status" },
	{ cmd: "/fix", desc: "Fix errors in code" },
	{ cmd: "/explain", desc: "Explain code" },
	{ cmd: "/optimize", desc: "Optimize code" },
	{ cmd: "/refactor", desc: "Refactor code" },
	{ cmd: "/docs", desc: "Generate documentation" },
	{ cmd: "/review", desc: "Review code" },
]

// ── Fuzzy Matching ─────────────────────────────────────────────────────────

/**
 * Simple Levenshtein distance for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = []
	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i]
	}
	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j
	}
	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1]
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1, // insertion
					matrix[i - 1][j] + 1, // deletion
				)
			}
		}
	}
	return matrix[b.length][a.length]
}

/**
 * Score how well a query matches a target string (0-1).
 * 1 = exact match, >0.5 = good prefix match, >0 = fuzzy match
 */
function fuzzyScore(query: string, target: string): number {
	const q = query.toLowerCase()
	const t = target.toLowerCase()

	// Exact match
	if (t === q) return 1.0

	// Prefix match
	if (t.startsWith(q)) return 0.9

	// Contains match
	if (t.includes(q)) return 0.7

	// Word boundary match (e.g., "dev" matches "npm run dev")
	const words = t.split(/\s+/)
	for (const word of words) {
		if (word.startsWith(q)) return 0.6
		if (word.includes(q)) return 0.4
	}

	// Fuzzy match using Levenshtein
	const maxLen = Math.max(t.length, q.length)
	if (maxLen === 0) return 0
	const dist = levenshteinDistance(q, t)
	const similarity = 1 - dist / maxLen
	if (similarity > 0.6) return similarity * 0.5 // Cap fuzzy matches at 0.5

	return 0
}

// ── Context Detection ──────────────────────────────────────────────────────

type CommandContext = "git" | "docker" | "npm" | "shell" | "agent" | "file" | "unknown"

function detectContext(input: string): CommandContext {
	const trimmed = input.toLowerCase().trim()

	if (trimmed.startsWith("/")) return "agent"
	if (trimmed.startsWith("git ") || trimmed === "git") return "git"
	if (trimmed.startsWith("docker ") || trimmed === "docker") return "docker"
	if (
		trimmed.startsWith("npm ") ||
		trimmed === "npm" ||
		trimmed.startsWith("pnpm ") ||
		trimmed === "pnpm" ||
		trimmed.startsWith("npx ") ||
		trimmed === "npx"
	)
		return "npm"
	if (
		trimmed.startsWith("cat ") ||
		trimmed.startsWith("less ") ||
		trimmed.startsWith("head ") ||
		trimmed.startsWith("tail ")
	)
		return "file"

	return "shell"
}

// ── Main Autocomplete Function ─────────────────────────────────────────────

export function getAutocompleteSuggestions(
	input: string,
	options: {
		recentCommands?: string[]
		workspaceFiles?: { path: string; name: string }[]
		branch?: string
		maxResults?: number
	} = {},
): AutocompleteMatch[] {
	if (!input.trim()) return []

	const { recentCommands = [], workspaceFiles = [], branch, maxResults = 10 } = options
	const context = detectContext(input)
	const results: AutocompleteMatch[] = []

	// ── Context-specific suggestions ────────────────────────────────────

	if (context === "git") {
		for (const cmd of GIT_COMMANDS) {
			const score = fuzzyScore(input, cmd.cmd)
			if (score > 0) {
				results.push({
					text: cmd.cmd,
					description: cmd.desc,
					type: "git",
					relevance: score,
				})
			}
		}
		// Add branch suggestions for checkout/merge
		if (branch && (input.includes("checkout") || input.includes("merge") || input.includes("branch"))) {
			results.push({
				text: `git checkout ${branch}`,
				description: `Switch to current branch (${branch})`,
				type: "git",
				relevance: 0.85,
			})
		}
	}

	if (context === "docker") {
		for (const cmd of DOCKER_COMMANDS) {
			const score = fuzzyScore(input, cmd.cmd)
			if (score > 0) {
				results.push({
					text: cmd.cmd,
					description: cmd.desc,
					type: "docker",
					relevance: score,
				})
			}
		}
	}

	if (context === "npm") {
		for (const cmd of NPM_COMMANDS) {
			const score = fuzzyScore(input, cmd.cmd)
			if (score > 0) {
				results.push({
					text: cmd.cmd,
					description: cmd.desc,
					type: "npm",
					relevance: score,
				})
			}
		}
	}

	if (context === "agent") {
		for (const cmd of AGENT_COMMANDS) {
			const score = fuzzyScore(input, cmd.cmd)
			if (score > 0) {
				results.push({
					text: cmd.cmd,
					description: cmd.desc,
					type: "agent",
					relevance: score,
				})
			}
		}
	}

	if (context === "file") {
		// Suggest file paths for cat/less/head/tail
		for (const file of workspaceFiles) {
			const score = fuzzyScore(input.split(" ").pop() || "", file.path)
			if (score > 0) {
				results.push({
					text: file.path,
					description: `File: ${file.name}`,
					type: "file",
					relevance: score,
				})
			}
		}
	}

	// ── Shell commands (for any context) ────────────────────────────────
	if (context === "shell" || context === "unknown") {
		for (const cmd of SHELL_COMMANDS) {
			const score = fuzzyScore(input, cmd.cmd)
			if (score > 0) {
				results.push({
					text: cmd.cmd,
					description: cmd.desc,
					type: "shell",
					relevance: score,
				})
			}
		}
	}

	// ── Recent command history ──────────────────────────────────────────
	for (const cmd of recentCommands) {
		const score = fuzzyScore(input, cmd)
		if (score > 0.3) {
			// Only include reasonable matches
			results.push({
				text: cmd,
				description: "Recent command",
				type: "history",
				relevance: score * 0.8, // Slightly discount history
			})
		}
	}

	// ── Sort by relevance, then alphabetically ──────────────────────────
	results.sort((a, b) => {
		if (b.relevance !== a.relevance) return b.relevance - a.relevance
		return a.text.localeCompare(b.text)
	})

	// Deduplicate by text
	const seen = new Set<string>()
	const deduped = results.filter((r) => {
		const key = r.text.toLowerCase()
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})

	return deduped.slice(0, maxResults)
}

/**
 * Get a single "best" suggestion for quick-fill (Tab key).
 */
export function getBestSuggestion(
	input: string,
	options: {
		recentCommands?: string[]
		workspaceFiles?: { path: string; name: string }[]
		branch?: string
	} = {},
): AutocompleteMatch | null {
	const suggestions = getAutocompleteSuggestions(input, { ...options, maxResults: 5 })
	if (suggestions.length === 0) return null
	// Return the highest relevance suggestion that's not just a prefix of input
	const best = suggestions[0]
	if (best.relevance >= 0.9 && best.text !== input) return best
	return null
}
