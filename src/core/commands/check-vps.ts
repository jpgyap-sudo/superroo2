import { logHeader, logStep, logWarn } from "../utils/logger"

interface CheckVpsOptions {
	url?: string
	retries?: string
}

export async function runCheckVpsCommand(options: CheckVpsOptions): Promise<void> {
	logHeader("SuperRoo VPS / Site Health Check")

	const url = options.url || process.env.SUPERROO_DEFAULT_HEALTH_URL
	const retries = Number(options.retries || "3")

	if (!url) {
		throw new Error("Missing --url or SUPERROO_DEFAULT_HEALTH_URL")
	}

	for (let attempt = 1; attempt <= retries; attempt += 1) {
		logStep(`Checking ${url}, attempt ${attempt}/${retries}`)
		try {
			const response = await fetch(url, { method: "GET" })
			console.log(`Status: ${response.status} ${response.statusText}`)

			if (response.ok) {
				logHeader("Health check passed")
				return
			}
		} catch (error) {
			logWarn(`Health check failed: ${(error as Error).message}`)
		}
	}

	throw new Error(`Health check failed after ${retries} attempts: ${url}`)
}
