private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		// The Vite build currently emits hashed JS chunks under webview-ui/build/assets.
		// The repository build output does not include predictable index.js/index.css, so
		// we must load the real entry bundle + the generated CSS.
		//
		// Build entry bundle is present in src/webview-ui/build/index.html as:
		//   <script type="module" crossorigin src="/assets/index.js"></script>
		// In our monorepo output, the actual file names are hashed, but are referenced by
		// the build's index.html (and by Vite's asset manifest). To keep things robust
		// across builds, we load index.html from the built output and extract the entry URIs.
		//
		// Log the extension path for debugging
		this.log(`[getHtmlContent] extensionPath: ${this.contextProxy.extensionPath}`)
		this.log(`[getHtmlContent] extensionUri.fsPath: ${this.contextProxy.extensionUri.fsPath}`)

		// Try multiple possible paths for the webview build
		// (including dist/webview-ui/build/ for packaged .vsix installs)
		const possiblePaths = [
			path.join(this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath, "webview-ui", "build", "index.html"),
			path.join(this.contextProxy.extensionUri.fsPath, "..", "webview-ui", "build", "index.html"),
			path.join(this.contextProxy.extensionUri.fsPath, "webview-ui", "build", "index.html"),
			// Fallback: check dist/webview-ui/build/ for packaged .vsix installs
			path.join(this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath, "dist", "webview-ui", "build", "index.html"),
			path.join(this.contextProxy.extensionUri.fsPath, "dist", "webview-ui", "build", "index.html"),
		]

		let buildIndexHtmlPath = possiblePaths[0]
		let foundPath = false

		for (const tryPath of possiblePaths) {
			this.log(`[getHtmlContent] Trying path: ${tryPath}`)
			if (fsSync.existsSync(tryPath)) {
				buildIndexHtmlPath = tryPath
				foundPath = true
				this.log(`[getHtmlContent] Found index.html at: ${tryPath}`)
				break
			}
		}

		if (!foundPath) {
			this.log(`[getHtmlContent] WARNING: index.html not found in any expected location!`)
		}

		// Dynamically compute the build base path relative to extensionUri.fsPath
		// so asset resolution works regardless of whether index.html is at
		// webview-ui/build/ (F5 dev mode) or dist/webview-ui/build/ (packaged .vsix)
		let buildBasePathParts: string[] = ["webview-ui", "build"]
		if (foundPath) {
			const indexPathDir = path.dirname(buildIndexHtmlPath)
			const relativeDir = path.relative(this.contextProxy.extensionUri.fsPath, indexPathDir)
			if (relativeDir.length > 0) {
				buildBasePathParts = relativeDir.split(path.sep).filter((p) => p.length > 0)
			}
		}

		let extractedScriptRel: string | undefined
		let extractedCssRel: string | undefined

		try {
			const builtIndexHtml = await fsPromises.readFile(buildIndexHtmlPath, "utf8")
			const scriptMatch = builtIndexHtml.match(/src="\/assets\/([^\"]+\.js)"/)
			const cssMatch = builtIndexHtml.match(/href="\/assets\/([^\"]+\.css)"/)
			if (scriptMatch?.[1]) extractedScriptRel = `assets/${scriptMatch[1]}`
			if (cssMatch?.[1]) extractedCssRel = `assets/${cssMatch[1]}`
		} catch {
			// Ignore and fall back to default entry asset names.
		}

		if (!extractedScriptRel) {
			extractedScriptRel = "assets/index.js"
		}
		if (!extractedCssRel) {
			extractedCssRel = "assets/index.css"
		}

		const extractedScriptAbsPath = path.join(
			this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath,
			...buildBasePathParts,
			extractedScriptRel,
		)

		const extractedCssAbsPath = path.join(
			this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath,
			...buildBasePathParts,
			extractedCssRel,
		)

		this.log(`[getHtmlContent] Script path: ${extractedScriptAbsPath}`)
		this.log(`[getHtmlContent] CSS path: ${extractedCssAbsPath}`)

const scriptExists = await fsPromises.stat(extractedScriptAbsPath).then(() => true).catch(() => false)
		const cssExists = await fsPromises.stat(extractedCssAbsPath).then(() => true).catch(() => false)

		if (!scriptExists || !cssExists) {
			throw new Error(
				`[getHtmlContent] Built webview assets not found on disk (scriptExists=${scriptExists}, cssExists=${cssExists}).`,
			)
		}


		const bundledStylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(
			this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath,
			...buildBasePathParts,
			extractedCssRel ? extractedCssRel : "assets/index.css",
		)))

		const bundledScriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(
			this.contextProxy.extensionPath ?? this.contextProxy.extensionUri.fsPath,
			...buildBasePathParts,
			extractedScriptRel ? extractedScriptRel : "assets/index.js",
		)))

		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		// Use a nonce to only allow a specific script to be run.
		/*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
		const nonce = getNonce()

		this.log(`[getHtmlContent] scriptUri=${scriptUri}, stylesUri=${stylesUri}, cspSource=${webview.cspSource}`)

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data: blob:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}'; connect-src ${webview.cspSource} ${openRouterDomain} https://api.requesty.ai https://ph.superroo.com wss: ws:;">
            <link rel="stylesheet" type="text/css" href="${bundledStylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
			</script>
            <title>SuperRoo</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${bundledScriptUri}"></script>
          </body>
        </html>
      `
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	