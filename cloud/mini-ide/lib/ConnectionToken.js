/**
 * Connection Token Auth — adapted from openvscode-server/src/vs/server/node/serverConnectionToken.ts
 *
 * Provides secure token-based access to the Mini IDE.
 * Replaces the basic Telegram-only auth with a dual-layer system:
 *   1. Connection token validates the session
 *   2. Telegram initData (or dashboard bearer token) validates the user
 */

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const TOKEN_REGEX = /^[0-9A-Za-z_-]+$/
const COOKIE_NAME = "superroo-connection-token"
const QUERY_NAME = "tkn"

class NoneConnectionToken {
	constructor() {
		this.type = "none"
	}
	validate() {
		return true
	}
}

class MandatoryConnectionToken {
	constructor(value) {
		this.type = "mandatory"
		this.value = value
	}
	validate(token) {
		return token === this.value
	}
}

function generateToken() {
	return crypto.randomBytes(32).toString("base64url")
}

async function loadOrCreateToken(storageDir) {
	const storagePath = path.join(storageDir, ".mini-ide-token")
	try {
		const raw = fs.readFileSync(storagePath, "utf8").replace(/\r?\n$/, "")
		if (TOKEN_REGEX.test(raw)) return raw
	} catch {}
	const token = generateToken()
	try {
		fs.mkdirSync(storageDir, { recursive: true })
		fs.writeFileSync(storagePath, token, { mode: 0o600 })
	} catch {}
	return token
}

function parseConnectionToken(args) {
	const withoutToken = args["without-connection-token"]
	const token = args["connection-token"]
	const tokenFile = args["connection-token-file"]

	if (withoutToken) {
		if (token || tokenFile) {
			throw new Error("Cannot use --connection-token with --without-connection-token")
		}
		return new NoneConnectionToken()
	}

	if (tokenFile) {
		const raw = fs.readFileSync(tokenFile, "utf8").replace(/\r?\n$/, "")
		if (!TOKEN_REGEX.test(raw)) {
			throw new Error("Connection token must be alphanumeric + _ -")
		}
		return new MandatoryConnectionToken(raw)
	}

	if (token) {
		if (!TOKEN_REGEX.test(token)) {
			throw new Error("Connection token must be alphanumeric + _ -")
		}
		return new MandatoryConnectionToken(token)
	}

	return null // Will be auto-generated
}

function extractToken(req, parsedUrl) {
	// 1. Query param
	if (parsedUrl && parsedUrl.query && parsedUrl.query[QUERY_NAME]) {
		return parsedUrl.query[QUERY_NAME]
	}
	// 2. Cookie
	const cookieHeader = req.headers.cookie
	if (cookieHeader) {
		const cookies = cookieHeader.split(";").reduce((acc, c) => {
			const [k, v] = c.trim().split("=")
			acc[k] = v
			return acc
		}, {})
		if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME]
	}
	// 3. Header
	const headerToken = req.headers["x-connection-token"]
	if (headerToken) return headerToken
	return null
}

function requestHasValidConnectionToken(connectionToken, req, parsedUrl) {
	if (connectionToken.type === "none") return true
	const token = extractToken(req, parsedUrl)
	return connectionToken.validate(token)
}

function setConnectionTokenCookie(res, token) {
	res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`)
}

module.exports = {
	NoneConnectionToken,
	MandatoryConnectionToken,
	loadOrCreateToken,
	parseConnectionToken,
	extractToken,
	requestHasValidConnectionToken,
	setConnectionTokenCookie,
	generateToken,
}
