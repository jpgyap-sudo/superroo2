/**
 * UnifiedBuilder — Multi-type build system with Docker, Next.js, TypeScript, and Static site builders.
 *
 * Features:
 * 1. Docker builder — Build and tag Docker images
 * 2. Next.js builder — Build Next.js applications
 * 3. TypeScript builder — Compile TypeScript projects
 * 4. Static site builder — Build static sites
 * 5. Agent-aware logging — Record which AI agent initiated the build
 * 6. Integration with BuildQueue — Enqueue builds and track status
 * 7. Integration with EventLog — Emit build events
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Constants ────────────────────────────────────────────────────────────────

const BUILD_TYPES = Object.freeze({
	DOCKER: "docker",
	NEXTJS: "nextjs",
	TYPESCRIPT: "typescript",
	STATIC: "static",
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function now() {
	return Date.now();
}

// ── UnifiedBuilder ───────────────────────────────────────────────────────────

class UnifiedBuilder {
	/**
	 * @param {object} opts
	 * @param {object} opts.buildQueue - BuildQueue instance
	 * @param {object} opts.eventLog - EventLog instance
	 * @param {string} [opts.projectName] - Default project name
	 * @param {string} [opts.workDir] - Working directory for builds
	 */
	constructor(opts) {
		this.buildQueue = opts.buildQueue;
		this.eventLog = opts.eventLog;
		this.projectName = opts.projectName || "superroo";
		this.workDir = opts.workDir || process.cwd();
	}

	// ── Event logging ─────────────────────────────────────────────────────

	async _emitEvent(type, payload, severity = "info") {
		if (!this.eventLog) return;
		try {
			await this.eventLog.record({
				type,
				source: "unified-builder",
				payload,
				severity,
			});
		} catch (err) {
			console.error("[UnifiedBuilder] EventLog error:", err.message);
		}
	}

	// ── Command execution ─────────────────────────────────────────────────

	_runCommand(command, args, opts = {}) {
		const cwd = opts.cwd || this.workDir;
		const timeout = opts.timeout || 300000; // 5 min default

		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
				timeout,
				shell: true,
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (d) => { stdout += d.toString(); });
			child.stderr.on("data", (d) => { stderr += d.toString(); });

			child.on("close", (code) => {
				const output = stdout.trim();
				const errorOutput = stderr.trim();

				if (code === 0) {
					resolve({ success: true, output, stderr: errorOutput });
				} else {
					reject({
						success: false,
						output,
						error: errorOutput || `Exit code: ${code}`,
						exitCode: code,
					});
				}
			});

			child.on("error", (err) => {
				reject({ success: false, error: err.message });
			});
		});
	}

	// ── Docker builder ────────────────────────────────────────────────────

	/**
	 * Build a Docker image.
	 * @param {object} opts
	 * @param {string} opts.imageTag - Docker image tag (e.g. "superroo:latest")
	 * @param {string} [opts.dockerfile] - Path to Dockerfile (default: "./Dockerfile")
	 * @param {string} [opts.context] - Build context directory (default: ".")
	 * @param {string} [opts.commitSha] - Commit SHA for tagging
	 * @param {string} [opts.agent] - AI agent name
	 * @param {object} [opts.buildArgs] - Docker build arguments
	 * @param {string} [opts.cwd] - Working directory
	 * @returns {Promise<{success: boolean, buildId?: string, output?: string, error?: string, skipped?: boolean}>}
	 */
	async buildDocker(opts) {
		const {
			imageTag,
			dockerfile = "./Dockerfile",
			context = ".",
			commitSha,
			agent = "unknown",
			buildArgs = {},
			cwd,
		} = opts;

		// Enqueue build
		const queueResult = await this.buildQueue.enqueueBuild({
			projectName: this.projectName,
			buildType: BUILD_TYPES.DOCKER,
			imageTag,
			commitSha,
			agent,
		});

		if (queueResult.skipped) {
			await this._emitEvent("build.docker.skipped", {
				project: this.projectName,
				imageTag,
				commitSha,
				reason: queueResult.reason,
			}, "info");

			return { success: true, buildId: queueResult.buildId, skipped: true, output: "Skipped (cached or duplicate)" };
		}

		const buildId = queueResult.buildId;

		try {
			await this._emitEvent("build.docker.started", {
				project: this.projectName,
				imageTag,
				commitSha,
				agent,
				buildId,
			}, "info");

			// Build arguments
			const args = ["build"];
			for (const [key, value] of Object.entries(buildArgs)) {
				args.push("--build-arg", `${key}=${value}`);
			}
			args.push("-t", imageTag);
			args.push("-f", dockerfile);
			args.push(context);

			const result = await this._runCommand("docker", args, { cwd });

			// Also tag with commit SHA if provided
			if (commitSha && result.success) {
				try {
					await this._runCommand("docker", ["tag", imageTag, `${imageTag.split(":")[0]}:${commitSha.substring(0, 8)}`], { cwd });
				} catch {}
			}

			// Complete build as success
			await this.buildQueue.completeBuild(buildId, {
				status: "success",
				output: result.output,
			});

			await this._emitEvent("build.docker.completed", {
				project: this.projectName,
				imageTag,
				commitSha,
				buildId,
			}, "info");

			return { success: true, buildId, output: result.output };
		} catch (err) {
			const errorMsg = err.error || err.message || "Unknown error";

			await this.buildQueue.completeBuild(buildId, {
				status: "failed",
				error: errorMsg,
			});

			await this._emitEvent("build.docker.failed", {
				project: this.projectName,
				imageTag,
				commitSha,
				buildId,
				error: errorMsg,
			}, "error");

			return { success: false, buildId, error: errorMsg };
		}
	}

	// ── Next.js builder ───────────────────────────────────────────────────

	/**
	 * Build a Next.js application.
	 * @param {object} opts
	 * @param {string} [opts.projectDir] - Next.js project directory (default: ".")
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @param {string} [opts.cwd] - Working directory
	 * @returns {Promise<{success: boolean, buildId?: string, output?: string, error?: string}>}
	 */
	async buildNextJs(opts) {
		const {
			projectDir = ".",
			commitSha,
			agent = "unknown",
			cwd,
		} = opts;

		const buildCwd = cwd || (projectDir !== "." ? path.resolve(this.workDir, projectDir) : this.workDir);

		// Enqueue build
		const queueResult = await this.buildQueue.enqueueBuild({
			projectName: this.projectName,
			buildType: BUILD_TYPES.NEXTJS,
			commitSha,
			agent,
		});

		if (queueResult.skipped) {
			return { success: true, buildId: queueResult.buildId, skipped: true, output: "Skipped (cached)" };
		}

		const buildId = queueResult.buildId;

		try {
			await this._emitEvent("build.nextjs.started", {
				project: this.projectName,
				commitSha,
				agent,
				buildId,
			}, "info");

			// Run npm install if needed
			const hasNodeModules = fs.existsSync(path.join(buildCwd, "node_modules"));
			if (!hasNodeModules) {
				await this._runCommand("npm", ["install", "--no-audit", "--no-fund"], { cwd: buildCwd });
			}

			// Run next build
			const result = await this._runCommand("npx", ["next", "build"], { cwd: buildCwd });

			await this.buildQueue.completeBuild(buildId, {
				status: "success",
				output: result.output,
			});

			await this._emitEvent("build.nextjs.completed", {
				project: this.projectName,
				commitSha,
				buildId,
			}, "info");

			return { success: true, buildId, output: result.output };
		} catch (err) {
			const errorMsg = err.error || err.message || "Unknown error";

			await this.buildQueue.completeBuild(buildId, {
				status: "failed",
				error: errorMsg,
			});

			await this._emitEvent("build.nextjs.failed", {
				project: this.projectName,
				commitSha,
				buildId,
				error: errorMsg,
			}, "error");

			return { success: false, buildId, error: errorMsg };
		}
	}

	// ── TypeScript builder ────────────────────────────────────────────────

	/**
	 * Compile a TypeScript project.
	 * @param {object} opts
	 * @param {string} [opts.projectDir] - TypeScript project directory (default: ".")
	 * @param {string} [opts.tsconfig] - Path to tsconfig.json (default: "tsconfig.json")
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @param {string} [opts.cwd] - Working directory
	 * @returns {Promise<{success: boolean, buildId?: string, output?: string, error?: string}>}
	 */
	async buildTypeScript(opts) {
		const {
			projectDir = ".",
			tsconfig = "tsconfig.json",
			commitSha,
			agent = "unknown",
			cwd,
		} = opts;

		const buildCwd = cwd || (projectDir !== "." ? path.resolve(this.workDir, projectDir) : this.workDir);

		// Enqueue build
		const queueResult = await this.buildQueue.enqueueBuild({
			projectName: this.projectName,
			buildType: BUILD_TYPES.TYPESCRIPT,
			commitSha,
			agent,
		});

		if (queueResult.skipped) {
			return { success: true, buildId: queueResult.buildId, skipped: true, output: "Skipped (cached)" };
		}

		const buildId = queueResult.buildId;

		try {
			await this._emitEvent("build.typescript.started", {
				project: this.projectName,
				commitSha,
				agent,
				buildId,
			}, "info");

			// Run npm install if needed
			const hasNodeModules = fs.existsSync(path.join(buildCwd, "node_modules"));
			if (!hasNodeModules) {
				await this._runCommand("npm", ["install", "--no-audit", "--no-fund"], { cwd: buildCwd });
			}

			// Run tsc
			const result = await this._runCommand("npx", ["tsc", "--project", tsconfig], { cwd: buildCwd });

			await this.buildQueue.completeBuild(buildId, {
				status: "success",
				output: result.output,
			});

			await this._emitEvent("build.typescript.completed", {
				project: this.projectName,
				commitSha,
				buildId,
			}, "info");

			return { success: true, buildId, output: result.output };
		} catch (err) {
			const errorMsg = err.error || err.message || "Unknown error";

			await this.buildQueue.completeBuild(buildId, {
				status: "failed",
				error: errorMsg,
			});

			await this._emitEvent("build.typescript.failed", {
				project: this.projectName,
				commitSha,
				buildId,
				error: errorMsg,
			}, "error");

			return { success: false, buildId, error: errorMsg };
		}
	}

	// ── Static site builder ───────────────────────────────────────────────

	/**
	 * Build a static site.
	 * @param {object} opts
	 * @param {string} [opts.projectDir] - Static site project directory (default: ".")
	 * @param {string} [opts.buildCommand] - Build command (default: "npm run build")
	 * @param {string} [opts.outputDir] - Output directory (default: "dist")
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @param {string} [opts.cwd] - Working directory
	 * @returns {Promise<{success: boolean, buildId?: string, output?: string, error?: string}>}
	 */
	async buildStatic(opts) {
		const {
			projectDir = ".",
			buildCommand = "npm run build",
			outputDir = "dist",
			commitSha,
			agent = "unknown",
			cwd,
		} = opts;

		const buildCwd = cwd || (projectDir !== "." ? path.resolve(this.workDir, projectDir) : this.workDir);

		// Enqueue build
		const queueResult = await this.buildQueue.enqueueBuild({
			projectName: this.projectName,
			buildType: BUILD_TYPES.STATIC,
			commitSha,
			agent,
		});

		if (queueResult.skipped) {
			return { success: true, buildId: queueResult.buildId, skipped: true, output: "Skipped (cached)" };
		}

		const buildId = queueResult.buildId;

		try {
			await this._emitEvent("build.static.started", {
				project: this.projectName,
				commitSha,
				agent,
				buildId,
			}, "info");

			// Run npm install if needed
			const hasNodeModules = fs.existsSync(path.join(buildCwd, "node_modules"));
			if (!hasNodeModules) {
				await this._runCommand("npm", ["install", "--no-audit", "--no-fund"], { cwd: buildCwd });
			}

			// Run build command
			const result = await this._runCommand(buildCommand, [], { cwd: buildCwd });

			// Verify output directory exists
			const outputPath = path.join(buildCwd, outputDir);
			const outputExists = fs.existsSync(outputPath);

			await this.buildQueue.completeBuild(buildId, {
				status: "success",
				output: result.output,
				metadata: { outputDir, outputExists },
			});

			await this._emitEvent("build.static.completed", {
				project: this.projectName,
				commitSha,
				buildId,
				outputDir,
				outputExists,
			}, "info");

			return { success: true, buildId, output: result.output, outputDir, outputExists };
		} catch (err) {
			const errorMsg = err.error || err.message || "Unknown error";

			await this.buildQueue.completeBuild(buildId, {
				status: "failed",
				error: errorMsg,
			});

			await this._emitEvent("build.static.failed", {
				project: this.projectName,
				commitSha,
				buildId,
				error: errorMsg,
			}, "error");

			return { success: false, buildId, error: errorMsg };
		}
	}

	// ── Auto-detect and build ─────────────────────────────────────────────

	/**
	 * Auto-detect the project type and build accordingly.
	 * @param {object} opts
	 * @param {string} [opts.projectDir] - Project directory
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @param {string} [opts.cwd] - Working directory
	 * @returns {Promise<{success: boolean, buildType?: string, buildId?: string, output?: string, error?: string}>}
	 */
	async build(opts) {
		const { projectDir = ".", commitSha, agent = "unknown", cwd } = opts;
		const buildCwd = cwd || (projectDir !== "." ? path.resolve(this.workDir, projectDir) : this.workDir);

		// Detect project type
		const hasDockerfile = fs.existsSync(path.join(buildCwd, "Dockerfile"));
		const hasNextConfig = fs.existsSync(path.join(buildCwd, "next.config.js")) ||
			fs.existsSync(path.join(buildCwd, "next.config.mjs")) ||
			fs.existsSync(path.join(buildCwd, "next.config.ts"));
		const hasTsConfig = fs.existsSync(path.join(buildCwd, "tsconfig.json"));
		const hasPackageJson = fs.existsSync(path.join(buildCwd, "package.json"));

		if (hasDockerfile) {
			const imageTag = `${this.projectName}:${commitSha ? commitSha.substring(0, 8) : "latest"}`;
			return this.buildDocker({
				imageTag,
				dockerfile: path.join(buildCwd, "Dockerfile"),
				context: buildCwd,
				commitSha,
				agent,
				cwd: buildCwd,
			});
		}

		if (hasNextConfig) {
			return this.buildNextJs({ projectDir, commitSha, agent, cwd: buildCwd });
		}

		if (hasTsConfig && hasPackageJson) {
			// Check if it's a static site (has build script)
			const pkg = JSON.parse(fs.readFileSync(path.join(buildCwd, "package.json"), "utf-8"));
			if (pkg.scripts && pkg.scripts.build) {
				return this.buildStatic({ projectDir, buildCommand: "npm run build", commitSha, agent, cwd: buildCwd });
			}
			return this.buildTypeScript({ projectDir, commitSha, agent, cwd: buildCwd });
		}

		if (hasPackageJson) {
			const pkg = JSON.parse(fs.readFileSync(path.join(buildCwd, "package.json"), "utf-8"));
			if (pkg.scripts && pkg.scripts.build) {
				return this.buildStatic({ projectDir, buildCommand: "npm run build", commitSha, agent, cwd: buildCwd });
			}
		}

		return { success: false, error: "Could not detect project type. No Dockerfile, next.config, tsconfig.json, or package.json found." };
	}
}

module.exports = { UnifiedBuilder, BUILD_TYPES };
