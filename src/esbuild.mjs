import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import process from "node:process"
import * as console from "node:console"

import { copyPaths, copyWasms, copyLocales, setupLocaleWatcher, copyDir, rmDir } from "@superroo/build"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function removeDirWithRetries(dirPath, retries = 5, retryDelayMs = 200) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await fs.promises.rm(dirPath, { recursive: true, force: true })
			return
		} catch (error) {
			const isRetryable = error?.code === "ENOTEMPTY" || error?.code === "EBUSY" || error?.code === "EPERM"
			const isLastAttempt = attempt === retries

			if (!isRetryable || isLastAttempt) {
				throw error
			}

			await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)))
		}
	}
}

async function main() {
	const name = "extension"
	const production = process.argv.includes("--production")
	const watch = process.argv.includes("--watch")
	const minify = production
	const sourcemap = true // Always generate source maps for error handling.

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const buildOptions = {
		bundle: true,
		minify,
		sourcemap,
		logLevel: "silent",
		format: "cjs",
		sourcesContent: false,
		platform: "node",
	}

	const srcDir = __dirname
	const buildDir = __dirname
	const distDir = path.join(buildDir, "dist")

	if (fs.existsSync(distDir)) {
		console.log(`[${name}] Cleaning dist directory: ${distDir}`)
		await removeDirWithRetries(distDir)
	}

	/**
	 * @type {import('esbuild').Plugin[]}
	 */
	const plugins = [
		{
			name: "copyFiles",
			setup(build) {
				build.onEnd(() => {
					copyPaths(
						[
							["../README.md", "dist/README.md"],
							["../CHANGELOG.md", "dist/CHANGELOG.md"],
							["../LICENSE", "dist/LICENSE"],
							["../.env", "dist/.env", { optional: true }],
							["super-roo/config", "dist/config"],
							["node_modules/vscode-material-icons/generated", "dist/assets/vscode-material-icons"],
							["assets/codicons", "dist/assets/codicons"],
							["assets/images", "dist/assets/images"],
							["../webview-ui/audio", "dist/webview-ui/audio"],
						],
						srcDir,
						buildDir,
					)

					const webviewBuildSrc = path.join(srcDir, "webview-ui", "build")
					const webviewBuildDst = path.join(distDir, "webview-ui", "build")

					if (fs.existsSync(webviewBuildSrc)) {
						console.log(`[copyFiles] Copying webview build from ${webviewBuildSrc} to ${webviewBuildDst}`)

						if (fs.existsSync(webviewBuildDst)) {
							rmDir(webviewBuildDst)
						}

						fs.mkdirSync(webviewBuildDst, { recursive: true })
						const count = copyDir(webviewBuildSrc, webviewBuildDst, 0)
						console.log(`[copyFiles] Copied ${count} webview build files`)
					} else {
						console.log(`[copyFiles] Optional webview build not found, skipping: ${webviewBuildSrc}`)
					}
				})
			},
		},
		{
			name: "copyWasms",
			setup(build) {
				build.onEnd(() => copyWasms(srcDir, distDir))
			},
		},
		{
			name: "copyLocales",
			setup(build) {
				build.onEnd(() => copyLocales(srcDir, distDir))
			},
		},
		{
			name: "esbuild-problem-matcher",
			setup(build) {
				build.onStart(() => console.log("[esbuild-problem-matcher#onStart]"))
				build.onEnd((result) => {
					result.errors.forEach(({ text, location }) => {
						console.error(`✘ [ERROR] ${text}`)
						if (location && location.file) {
							console.error(`    ${location.file}:${location.line}:${location.column}:`)
						}
					})

					console.log("[esbuild-problem-matcher#onEnd]")
				})
			},
		},
	]

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const extensionConfig = {
		...buildOptions,
		plugins,
		entryPoints: ["extension.ts"],
		outfile: "dist/extension.js",
		// global-agent must be external because it dynamically patches Node.js http/https modules
		// which breaks when bundled. It needs access to the actual Node.js module instances.
		// undici must be bundled because our VSIX is packaged with `--no-dependencies`.
		external: ["vscode", "esbuild", "global-agent"],
	}

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const workerConfig = {
		...buildOptions,
		entryPoints: ["workers/countTokens.ts"],
		outdir: "dist/workers",
	}

	const cliConfig = {
		...buildOptions,
		entryPoints: ["cli/index.ts"],
		outfile: "dist/cli/index.js",
		external: ["vscode", "esbuild", "global-agent"],
		banner: {
			js: "#!/usr/bin/env node",
		},
	}

	const daemonConfig = {
		...buildOptions,
		entryPoints: ["super-roo-daemon/index.ts"],
		outfile: "dist/super-roo-daemon/index.js",
		external: ["vscode", "esbuild", "global-agent", "better-sqlite3"],
	}

	const telegramConfig = {
		...buildOptions,
		entryPoints: ["telegram/bot.ts"],
		outfile: "dist/telegram/bot.js",
		external: ["vscode", "esbuild", "global-agent"],
	}

	const [extensionCtx, workerCtx, cliCtx, daemonCtx, telegramCtx] = await Promise.all([
		esbuild.context(extensionConfig),
		esbuild.context(workerConfig),
		esbuild.context(cliConfig),
		esbuild.context(daemonConfig),
		esbuild.context(telegramConfig),
	])

	if (watch) {
		await Promise.all([extensionCtx.watch(), workerCtx.watch(), cliCtx.watch(), daemonCtx.watch(), telegramCtx.watch()])
		copyLocales(srcDir, distDir)
		setupLocaleWatcher(srcDir, distDir)
	} else {
		await Promise.all([
			extensionCtx.rebuild(),
			workerCtx.rebuild(),
			cliCtx.rebuild(),
			daemonCtx.rebuild(),
			telegramCtx.rebuild(),
		])
		await Promise.all([extensionCtx.dispose(), workerCtx.dispose(), cliCtx.dispose(), daemonCtx.dispose(), telegramCtx.dispose()])
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
