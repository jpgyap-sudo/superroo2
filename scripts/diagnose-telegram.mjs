#!/usr/bin/env node
/**
 * Telegram Bot Diagnostic Script
 * Run on the VPS to diagnose why the Telegram bot is not responding.
 */
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const RESET = "\x1b[0m"

function ok(msg) {
	console.log(`${GREEN}✓${RESET} ${msg}`)
}
function fail(msg) {
	console.log(`${RED}✗${RESET} ${msg}`)
}
function warn(msg) {
	console.log(`${YELLOW}⚠${RESET} ${msg}`)
}
function info(msg) {
	console.log(`${CYAN}ℹ${RESET} ${msg}`)
}

function run(cmd, opts = {}) {
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "pipe", ...opts }).trim()
	} catch (e) {
		return opts.fallback ?? null
	}
}

async function fetchJson(url, opts = {}) {
	try {
		const res = await fetch(url, opts)
		return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
	} catch (e) {
		return { ok: false, error: e.message }
	}
}

console.log("═══════════════════════════════════════════════════════════════")
console.log("   Telegram Bot Diagnostic")
console.log("═══════════════════════════════════════════════════════════════\n")

// ─── 1. Environment ─────────────────────────────────────────────────────────
const envFile = "/opt/superroo2/cloud/.env"
let env = {}
try {
	const raw = fs.readFileSync(envFile, "utf-8")
	raw.split("\n").forEach((line) => {
		const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
		if (m) env[m[1]] = m[2]
	})
	ok(`.env loaded from ${envFile}`)
} catch {
	fail(`.env not found at ${envFile}`)
}

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const REDIS_URL = env.REDIS_URL || process.env.REDIS_URL || "redis://127.0.0.1:6379"
const WEBHOOK_URL = env.TELEGRAM_WEBHOOK_URL || "https://dev.abcx124.xyz/api/telegram/webhook"

if (!BOT_TOKEN) {
	fail("TELEGRAM_BOT_TOKEN is not set!")
	process.exit(1)
}
if (BOT_TOKEN.length < 20) {
	warn("TELEGRAM_BOT_TOKEN looks suspiciously short")
}

// ─── 2. PM2 Status ──────────────────────────────────────────────────────────
info("\n─── PM2 Process Status ───")
const pm2List = run("pm2 list", { silent: true })
if (pm2List) {
	const apiLine = pm2List.split("\n").find((l) => l.includes("superroo-api"))
	if (apiLine) {
		if (apiLine.includes("online")) {
			ok("superroo-api is online in PM2")
		} else if (apiLine.includes("errored")) {
			fail("superroo-api is in ERRORED state")
		} else if (apiLine.includes("stopped")) {
			fail("superroo-api is STOPPED")
		} else {
			warn(`superroo-api status: ${apiLine.trim()}`)
		}
	} else {
		fail("superroo-api not found in PM2 list")
	}
	// Show last 20 restart times
	const pm2Log = run("pm2 logs superroo-api --lines 20 --nostream", { silent: true, fallback: "" })
	if (pm2Log) info("Last PM2 log lines:\n" + pm2Log.split("\n").map((l) => "    " + l).join("\n"))
} else {
	fail("PM2 not available or no processes found")
}

// ─── 3. Telegram API: Token Validity ────────────────────────────────────────
info("\n─── Telegram API Checks ───")
const getMe = await fetchJson(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)
if (getMe.ok && getMe.data?.ok) {
	ok(`Bot token is valid (@${getMe.data.result.username})`)
} else {
	fail(`Bot token invalid: ${getMe.data?.description || getMe.error || "unknown error"}`)
}

// ─── 4. Telegram API: Webhook Info ──────────────────────────────────────────
const whInfo = await fetchJson(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`)
if (whInfo.ok && whInfo.data?.ok) {
	const result = whInfo.data.result
	if (result.url) {
		if (result.url === WEBHOOK_URL || result.url === WEBHOOK_URL.replace("/api/telegram/webhook", "/telegram/webhook")) {
			ok(`Webhook is set: ${result.url}`)
		} else {
			warn(`Webhook URL mismatch!\n      Configured: ${result.url}\n      Expected:   ${WEBHOOK_URL}`)
		}
	} else {
		fail("Webhook is NOT set (empty URL)")
	}
	if (result.last_error_date) {
		fail(`Last webhook error: ${result.last_error_message} (${new Date(result.last_error_date * 1000).toISOString()})`)
	}
	if (result.pending_update_count > 0) {
		warn(`Pending updates: ${result.pending_update_count} (bot may be behind)`)
	}
	if (result.max_connections) {
		info(`Max connections: ${result.max_connections}`)
	}
} else {
	fail(`Could not fetch webhook info: ${whInfo.error || whInfo.status}`)
}

// ─── 5. Redis Connectivity ──────────────────────────────────────────────────
info("\n─── Redis Connectivity ───")
const redisPing = run(`redis-cli -u ${REDIS_URL} ping 2>/dev/null || echo "FAIL"`, { silent: true })
if (redisPing === "PONG") {
	ok("Redis is reachable")
} else {
	fail("Redis is NOT reachable")
	const redisService = run("systemctl is-active redis-server 2>/dev/null || echo 'unknown'", { silent: true })
	info(`Redis service status: ${redisService}`)
}

// ─── 6. Nginx Configuration ─────────────────────────────────────────────────
info("\n─── Nginx / Webhook Route ───")
const nginxTest = run("nginx -t 2>&1", { silent: true })
if (nginxTest && nginxTest.includes("successful")) {
	ok("Nginx configuration is valid")
} else {
	fail("Nginx configuration test failed")
	if (nginxTest) info(nginxTest)
}

const nginxConf = run("grep -r 'telegram/webhook' /etc/nginx/ 2>/dev/null || true", { silent: true })
if (nginxConf) {
	ok("Nginx has telegram/webhook route configured")
} else {
	warn("No telegram/webhook route found in /etc/nginx")
}

// ─── 7. Recent API Logs ─────────────────────────────────────────────────────
info("\n─── Recent API Logs ───")
const logDir = "/opt/superroo2/cloud/logs"
const today = new Date().toISOString().slice(0, 10)
const todayLog = path.join(logDir, `superroo-${today}.jsonl`)
const pm2ApiLog = path.join(logDir, "superroo-api-combined.log")

if (fs.existsSync(todayLog)) {
	const stats = fs.statSync(todayLog)
	const ageMin = Math.round((Date.now() - stats.mtimeMs) / 60000)
	ok(`Today's structured log exists: superroo-${today}.jsonl (last modified ${ageMin}m ago)`)
	const tail = run(`tail -n 5 ${todayLog}`, { silent: true })
	if (tail) info("Last 5 log entries:\n" + tail.split("\n").map((l) => "    " + l.slice(0, 200)).join("\n"))
} else {
	fail(`Today's structured log MISSING: superroo-${today}.jsonl`)
}

if (fs.existsSync(pm2ApiLog)) {
	const stats = fs.statSync(pm2ApiLog)
	const ageMin = Math.round((Date.now() - stats.mtimeMs) / 60000)
	ok(`PM2 API log exists (last modified ${ageMin}m ago)`)
	const tail = run(`tail -n 10 ${pm2ApiLog}`, { silent: true })
	if (tail) info("Last 10 PM2 log lines:\n" + tail.split("\n").map((l) => "    " + l.slice(0, 200)).join("\n"))
} else {
	warn(`PM2 API log not found: ${pm2ApiLog}`)
}

// ─── 8. Local API Health Check ──────────────────────────────────────────────
info("\n─── Local API Health ───")
const health = await fetchJson("http://127.0.0.1:8787/health", { fallback: null })
if (health && health.ok) {
	ok("API health endpoint responded OK")
} else {
	fail(`API health endpoint failed: ${health?.error || health?.status || "no response"}`)
}

// ─── 9. IP Whitelist Check ──────────────────────────────────────────────────
info("\n─── IP Whitelist ───")
const whitelistEnabled = env.TELEGRAM_IP_WHITELIST_ENABLED !== "false"
if (whitelistEnabled) {
	warn("IP whitelist is ENABLED — ensure nginx sets X-Forwarded-For correctly")
} else {
	ok("IP whitelist is disabled")
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════")
console.log("   Diagnostic Complete")
console.log("═══════════════════════════════════════════════════════════════")
