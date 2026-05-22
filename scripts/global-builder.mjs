#!/usr/bin/env node
/**
 * Global Builder CLI — Submit build tasks from any coding agent (Claude Code, Codex, SuperRoo)
 * to the GlobalBuildOrchestrator, which queues Docker image builds on the VPS
 * with VPS-aware throttling to prevent crashes.
 *
 * Usage:
 *   node scripts/global-builder.mjs submit <project> [options]
 *   node scripts/global-builder.mjs status [options]
 *   node scripts/global-builder.mjs active
 *   node scripts/global-builder.mjs queued
 *   node scripts/global-builder.mjs stats
 *   node scripts/global-builder.mjs cancel <buildId>
 *   node scripts/global-builder.mjs retry <buildId>
 *   node scripts/global-builder.mjs history <project>
 *
 * Options for submit:
 *   --image-tag <tag>       Docker image tag (default: <project>:latest)
 *   --commit-sha <sha>      Commit SHA for tagging
 *   --agent <name>          Agent name (default: auto-detected)
 *   --source <source>       Agent source: claude | codex | superroo | api | webhook
 *   --description <text>    Human-readable task description
 *   --build-args <json>     Docker build arguments as JSON
 *   --dockerfile <path>     Path to Dockerfile
 *   --context <path>        Build context directory
 *   --project-dir <dir>     Project directory (for non-Docker builds)
 *   --build-type <type>     Build type: docker | nextjs | typescript | static
 *   --skip-cache            Force rebuild even if cached
 *
 * Options for status:
 *   --project <name>        Filter by project
 *   --status <status>       Filter by status (queued, running, success, failed, cancelled)
 *   --source <source>       Filter by agent source
 *   --limit <n>             Max results (default: 50)
 *
 * Environment:
 *   API_URL                 SuperRoo API URL (default: http://100.64.175.88:3419)
 *
 * Examples:
 *   # Submit a Docker build from Claude
 *   node scripts/global-builder.mjs submit my-project --image-tag my-project:latest --source claude --description "Build after feature X"
 *
 *   # Submit a build with commit SHA from Codex
 *   node scripts/global-builder.mjs submit my-project --commit-sha abc123 --source codex --skip-cache
 *
 *   # Check build status
 *   node scripts/global-builder.mjs status --project my-project --limit 10
 *
 *   # Get build statistics
 *   node scripts/global-builder.mjs stats
 */

const API_URL = process.env.API_URL || "http://100.64.175.88:3419";

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
	console.log(`
Global Builder CLI — Submit build tasks from any coding agent to the VPS build queue

Usage:
  node scripts/global-builder.mjs <command> [options]

Commands:
  submit <project>    Submit a build task
  status              Get build status (with optional filters)
  active              Get active (running) builds
  queued              Get queued builds
  stats               Get build statistics
  cancel <buildId>    Cancel a queued or running build
  retry <buildId>     Retry a failed build
  history <project>   Get build history for a project
  help                Show this help message

Options for submit:
  --image-tag <tag>       Docker image tag (default: <project>:latest)
  --commit-sha <sha>      Commit SHA for tagging
  --agent <name>          Agent name (auto-detected: CLAUDE_CODE, CODEX, SUPERROO)
  --source <source>       Agent source: claude | codex | superroo | api | webhook
  --description <text>    Human-readable task description
  --build-args <json>     Docker build arguments as JSON string
  --dockerfile <path>     Path to Dockerfile
  --context <path>        Build context directory
  --project-dir <dir>     Project directory (for non-Docker builds)
  --build-type <type>     Build type: docker | nextjs | typescript | static
  --skip-cache            Force rebuild even if cached

Options for status:
  --project <name>        Filter by project name
  --status <status>       Filter by status (queued, running, success, failed, cancelled)
  --source <source>       Filter by agent source
  --limit <n>             Max results (default: 50)

Environment:
  API_URL   SuperRoo API URL (default: http://100.64.175.88:3419)

Examples:
  node scripts/global-builder.mjs submit my-project --source claude --description "Build after feature X"
  node scripts/global-builder.mjs submit my-project --commit-sha abc123 --source codex --skip-cache
  node scripts/global-builder.mjs status --project my-project --limit 10
  node scripts/global-builder.mjs stats
  node scripts/global-builder.mjs cancel <buildId>
`);
}

// ── Argument parser ───────────────────────────────────────────────────────────

function parseArgs(args) {
	const result = { positional: [], named: {} };
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].slice(2).replace(/-/g, "_");
			const val = args[i + 1];
			if (val !== undefined && !val.startsWith("--")) {
				result.named[key] = val;
				i++;
			} else {
				result.named[key] = true;
			}
		} else {
			result.positional.push(args[i]);
		}
	}
	return result;
}

// ── Agent auto-detection ──────────────────────────────────────────────────────

function detectAgent() {
	// Detect which agent is running this script
	if (process.env.CLAUDE_CODE) return { name: "claude-code", source: "claude" };
	if (process.env.CODEX_API_KEY || process.env.CODEX_TOKEN) return { name: "codex", source: "codex" };
	if (process.env.SUPERROO_AGENT) return { name: process.env.SUPERROO_AGENT, source: "superroo" };

	// Check parent process name
	const ppid = process.ppid?.toString() || "";
	if (ppid.includes("claude")) return { name: "claude-code", source: "claude" };
	if (ppid.includes("codex")) return { name: "codex", source: "codex" };

	return { name: "cli-user", source: "api" };
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(endpoint, body) {
	const url = `${API_URL}${endpoint}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`API error (${res.status}): ${text}`);
	}

	return res.json();
}

async function apiGet(endpoint) {
	const url = `${API_URL}${endpoint}`;
	const res = await fetch(url);

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`API error (${res.status}): ${text}`);
	}

	return res.json();
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatTimestamp(ts) {
	if (!ts) return "-";
	const d = new Date(ts);
	return d.toISOString().replace("T", " ").substring(0, 19);
}

function formatDuration(start, end) {
	if (!start) return "-";
	const s = new Date(start).getTime();
	const e = end ? new Date(end).getTime() : Date.now();
	const ms = e - s;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60000);
	const sec = Math.floor((ms % 60000) / 1000);
	return `${m}m ${sec}s`;
}

function statusColor(status) {
	switch (status) {
		case "success": return "\x1b[32m"; // green
		case "failed": return "\x1b[31m"; // red
		case "running": return "\x1b[34m"; // blue
		case "queued": return "\x1b[33m"; // yellow
		case "cancelled": return "\x1b[90m"; // grey
		case "skipped": return "\x1b[36m"; // cyan
		default: return "\x1b[0m";
	}
}

function printBuildTable(builds) {
	if (!builds || builds.length === 0) {
		console.log("  No builds found.");
		return;
	}

	console.log("");
	console.log(
		"  " +
		"ID".padEnd(10) +
		"Project".padEnd(16) +
		"Type".padEnd(10) +
		"Status".padEnd(12) +
		"Agent".padEnd(14) +
		"Source".padEnd(10) +
		"Started".padEnd(20) +
		"Duration"
	);
	console.log("  " + "-".repeat(92));

	for (const b of builds) {
		const id = (b.id || "").substring(0, 8);
		const project = (b.projectName || "").substring(0, 14);
		const type = (b.buildType || "").substring(0, 8);
		const status = (b.status || "").substring(0, 10);
		const agent = (b.agent || "").substring(0, 12);
		const source = (b.agentSource || "").substring(0, 8);
		const started = formatTimestamp(b.startedAt || b.createdAt);
		const duration = formatDuration(b.startedAt, b.completedAt);

		const color = statusColor(status);
		const reset = "\x1b[0m";

		console.log(
			`  ${color}${id}${reset} ` +
			`${project.padEnd(16)}` +
			`${type.padEnd(10)}` +
			`${color}${status.padEnd(12)}${reset}` +
			`${agent.padEnd(14)}` +
			`${source.padEnd(10)}` +
			`${started.padEnd(20)}` +
			`${duration}`
		);
	}
	console.log("");
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdSubmit(args) {
	const projectName = args.positional[0];
	if (!projectName) {
		console.error("Error: project name is required");
		console.error("Usage: node scripts/global-builder.mjs submit <project> [options]");
		process.exit(1);
	}

	const agent = detectAgent();
	const named = args.named;

	const body = {
		projectName,
		buildType: named.build_type || "docker",
		imageTag: named.image_tag || `${projectName}:latest`,
		commitSha: named.commit_sha || undefined,
		agent: named.agent || agent.name,
		agentSource: named.source || agent.source,
		taskDescription: named.description || `Build from ${agent.name}`,
		buildArgs: named.build_args ? JSON.parse(named.build_args) : {},
		dockerfile: named.dockerfile || undefined,
		context: named.context || undefined,
		projectDir: named.project_dir || undefined,
		skipCache: !!named.skip_cache,
	};

	console.log(`\n  Submitting build for project: ${projectName}`);
	console.log(`  Agent: ${body.agent} (source: ${body.agentSource})`);
	console.log(`  Image tag: ${body.imageTag}`);
	if (body.commitSha) console.log(`  Commit SHA: ${body.commitSha}`);
	if (body.taskDescription) console.log(`  Description: ${body.taskDescription}`);
	console.log("");

	const result = await apiPost("/api/build/submit", body);

	if (result.success) {
		const build = result.build;
		if (build.queued) {
			console.log(`  \x1b[33m⚠ Build queued\x1b[0m — ${build.error || "VPS resources busy"}`);
		} else if (build.status === "success") {
			console.log(`  \x1b[32m✓ Build completed successfully\x1b[0m`);
		} else if (build.status === "running") {
			console.log(`  \x1b[34m▶ Build started\x1b[0m`);
		} else if (build.status === "failed") {
			console.log(`  \x1b[31m✗ Build failed\x1b[0m — ${build.error || "Unknown error"}`);
		}
		console.log(`  Build ID: ${build.buildId}`);
		console.log(`  Status: ${build.status}`);
	} else {
		console.error(`  \x1b[31m✗ Failed to submit build: ${result.error}\x1b[0m`);
		process.exit(1);
	}
}

async function cmdStatus(args) {
	const named = args.named;
	const params = new URLSearchParams();

	if (named.project) params.set("project", named.project);
	if (named.status) params.set("status", named.status);
	if (named.source) params.set("source", named.source);
	params.set("limit", named.limit || "50");

	const query = params.toString();
	const result = await apiGet(`/api/build/status${query ? "?" + query : ""}`);

	if (result.success) {
		printBuildTable(result.builds);
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdActive() {
	const result = await apiGet("/api/build/active");

	if (result.success) {
		if (result.builds.length === 0) {
			console.log("\n  No active builds.\n");
		} else {
			console.log(`\n  Active builds (${result.builds.length}):`);
			printBuildTable(result.builds);
		}
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdQueued() {
	const result = await apiGet("/api/build/queued");

	if (result.success) {
		if (result.builds.length === 0) {
			console.log("\n  No queued builds.\n");
		} else {
			console.log(`\n  Queued builds (${result.builds.length}):`);
			printBuildTable(result.builds);
		}
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdStats() {
	const result = await apiGet("/api/build/stats");

	if (result.success) {
		const stats = result.stats;
		console.log("\n  ── Global Build Statistics ──");
		console.log(`  Total builds:     ${stats.totalBuilds}`);
		console.log(`  Active builds:    ${stats.activeBuilds} / ${stats.maxConcurrentBuilds} max`);
		console.log(`  RAM limit:        ${stats.maxRamPercent}%`);
		console.log("");

		if (stats.byStatus && Object.keys(stats.byStatus).length > 0) {
			console.log("  By Status:");
			for (const [status, count] of Object.entries(stats.byStatus)) {
				const color = statusColor(status);
				console.log(`    ${color}${status.padEnd(12)}${count}${"\x1b[0m"}`);
			}
			console.log("");
		}

		if (stats.bySource && Object.keys(stats.bySource).length > 0) {
			console.log("  By Agent Source:");
			for (const [source, count] of Object.entries(stats.bySource)) {
				console.log(`    ${source.padEnd(12)}${count}`);
			}
			console.log("");
		}

		if (stats.byProject && Object.keys(stats.byProject).length > 0) {
			console.log("  By Project:");
			for (const [project, count] of Object.entries(stats.byProject)) {
				console.log(`    ${project.padEnd(20)}${count}`);
			}
			console.log("");
		}
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdCancel(args) {
	const buildId = args.positional[0];
	if (!buildId) {
		console.error("Error: buildId is required");
		console.error("Usage: node scripts/global-builder.mjs cancel <buildId>");
		process.exit(1);
	}

	const result = await apiPost("/api/build/cancel", { buildId });

	if (result.success) {
		if (result.cancel.success) {
			console.log(`\n  \x1b[33m✓ Build cancelled\x1b[0m: ${buildId}\n`);
		} else {
			console.error(`\n  \x1b[31m✗ ${result.cancel.error}\x1b[0m\n`);
		}
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdRetry(args) {
	const buildId = args.positional[0];
	if (!buildId) {
		console.error("Error: buildId is required");
		console.error("Usage: node scripts/global-builder.mjs retry <buildId>");
		process.exit(1);
	}

	const result = await apiPost("/api/build/retry", { buildId });

	if (result.success) {
		const retry = result.retry;
		if (retry.success) {
			console.log(`\n  \x1b[34m▶ Retry submitted\x1b[0m — new build ID: ${retry.buildId}\n`);
		} else {
			console.error(`\n  \x1b[31m✗ ${retry.error}\x1b[0m\n`);
		}
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

async function cmdHistory(args) {
	const projectName = args.positional[0];
	if (!projectName) {
		console.error("Error: project name is required");
		console.error("Usage: node scripts/global-builder.mjs history <project>");
		process.exit(1);
	}

	const named = args.named;
	const limit = named.limit || "20";

	const result = await apiGet(`/api/build/history/${encodeURIComponent(projectName)}?limit=${limit}`);

	if (result.success) {
		console.log(`\n  Build history for: ${projectName}`);
		printBuildTable(result.builds);
	} else {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const command = args.positional[0];

	if (!command || command === "help") {
		printHelp();
		return;
	}

	try {
		switch (command) {
			case "submit":
				await cmdSubmit(args);
				break;
			case "status":
				await cmdStatus(args);
				break;
			case "active":
				await cmdActive();
				break;
			case "queued":
				await cmdQueued();
				break;
			case "stats":
				await cmdStats();
				break;
			case "cancel":
				await cmdCancel(args);
				break;
			case "retry":
				await cmdRetry(args);
				break;
			case "history":
				await cmdHistory(args);
				break;
			default:
				console.error(`Unknown command: ${command}`);
				printHelp();
				process.exit(1);
		}
	} catch (err) {
		console.error(`\n  \x1b[31mError: ${err.message}\x1b[0m\n`);
		process.exit(1);
	}
}

main();
