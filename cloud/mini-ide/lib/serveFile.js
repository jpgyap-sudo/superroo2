/**
 * Secure Static File Serving — adapted from openvscode-server/src/vs/server/node/webClientServer.ts
 *
 * Replaces express.static() with a secure, cache-aware file server.
 * Adds: path traversal protection, ETag support, proper mime types.
 */

const fs = require("fs")
const path = require("path")
const { createReadStream, promises: fsPromises } = fs

const textMimeType = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".pdf": "application/pdf",
	".md": "text/markdown",
}

const CacheControl = {
	NO_CACHING: 0,
	ETAG: 1,
	NO_EXPIRY: 2,
}

function getMediaMime(filePath) {
	const ext = path.extname(filePath).toLowerCase()
	return textMimeType[ext]
}

/**
 * Serve a file securely with optional ETag caching.
 * @param {string} filePath - Absolute path to file
 * @param {number} cacheControl - CacheControl.ETAG | NO_EXPIRY | NO_CACHING
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Record<string,string>} extraHeaders
 * @param {string} rootPath - Root directory for traversal check
 */
async function serveFile(filePath, cacheControl, req, res, extraHeaders = {}, rootPath = null) {
	try {
		// Path traversal protection
		if (rootPath) {
			const resolved = path.resolve(filePath)
			const resolvedRoot = path.resolve(rootPath)
			const sep = path.sep
			if (!resolved.startsWith(resolvedRoot + sep) && resolved !== resolvedRoot) {
				res.writeHead(403, { "Content-Type": "text/plain" })
				return void res.end("Forbidden")
			}
		}

		const stat = await fsPromises.stat(filePath)
		if (!stat.isFile()) {
			throw new Error("Not a file")
		}

		const headers = { ...extraHeaders }

		if (cacheControl === CacheControl.ETAG) {
			const etag = `W/"${[stat.ino, stat.size, stat.mtime.getTime()].join("-")}"`
			if (req.headers["if-none-match"] === etag) {
				res.writeHead(304)
				return void res.end()
			}
			headers["Etag"] = etag
		} else if (cacheControl === CacheControl.NO_EXPIRY) {
			headers["Cache-Control"] = "public, max-age=31536000"
		} else if (cacheControl === CacheControl.NO_CACHING) {
			headers["Cache-Control"] = "no-store"
		}

		headers["Content-Type"] = getMediaMime(filePath) || "text/plain"

		res.writeHead(200, headers)
		createReadStream(filePath).pipe(res)
	} catch (error) {
		if (error.code !== "ENOENT") {
			console.error("[serveFile] Error:", error)
		}
		res.writeHead(404, { "Content-Type": "text/plain" })
		res.end("Not found")
	}
}

function serveError(req, res, statusCode, message) {
	res.writeHead(statusCode, { "Content-Type": "text/plain" })
	res.end(message)
}

module.exports = { serveFile, serveError, CacheControl, getMediaMime }
