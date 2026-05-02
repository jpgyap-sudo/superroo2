/**
 * Super Roo — CancellableSleep utility.
 *
 * Provides a Promise-based sleep that can be externally cancelled
 * via a `wake()` call. Used by long-running background loops
 * (InfiniteImprovementLoop, SelfHealingLoop, etc.).
 */

export class CancellableSleep {
	private wakeFn: (() => void) | null = null
	private running = false

	/**
	 * Start tracking. Must be called before `sleep()`.
	 */
	start(): void {
		this.running = true
	}

	/**
	 * Stop tracking and wake any pending sleep immediately.
	 */
	stop(): void {
		this.running = false
		this.wake()
	}

	/**
	 * Return a Promise that resolves after `ms` milliseconds,
	 * or immediately if `stop()` / `wake()` is called.
	 */
	sleep(ms: number): Promise<void> {
		if (!this.running) return Promise.resolve()

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				if (this.wakeFn === wake) {
					this.wakeFn = null
				}
				resolve()
			}, ms)

			const wake = () => {
				clearTimeout(timeout)
				if (this.wakeFn === wake) {
					this.wakeFn = null
				}
				resolve()
			}

			this.wakeFn = wake
		})
	}

	/**
	 * Wake a pending sleep early without stopping tracking.
	 */
	wake(): void {
		this.wakeFn?.()
		this.wakeFn = null
	}
}
