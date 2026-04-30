export function logHeader(message: string): void {
	console.log(`\n========== ${message} ==========\n`)
}

export function logStep(message: string): void {
	console.log(`\n[superroo] ${message}`)
}

export function logWarn(message: string): void {
	console.warn(`\n[superroo:warn] ${message}`)
}
