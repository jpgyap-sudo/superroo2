import {
  TelemetryEvent,
  TelemetryEventName,
  TelemetryClient,
  TelemetryEventSubscription,
  TelemetryPropertiesProvider,
} from "@superroo/types"

/**
 * BrowserTelemetryClient - A lightweight telemetry client for the webview context.
 * Uses simple HTTP requests instead of PostHog Node.js client.
 */
export class BrowserTelemetryClient implements TelemetryClient {
  protected providerRef: WeakRef<TelemetryPropertiesProvider> | null = null
  protected telemetryEnabled: boolean = false
  private readonly apiUrl: string

  constructor(
    public readonly subscription?: TelemetryEventSubscription,
    debug = false,
  ) {
    this.apiUrl = process.env.TELEMETRY_API_URL || "https://ph.superroo.com"
  }

  protected isEventCapturable(eventName: TelemetryEventName): boolean {
    if (!this.subscription) {
      return true
    }

    return this.subscription.type === "include"
      ? this.subscription.events.includes(eventName)
      : !this.subscription.events.includes(eventName)
  }

  public async capture(event: TelemetryEvent): Promise<void> {
    if (!this.isTelemetryEnabled() || !this.isEventCapturable(event.event)) {
      return
    }

    // Send via simple HTTP POST - no PostHog client needed
    try {
      await fetch(`${this.apiUrl}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.POSTHOG_API_KEY || "",
          event,
        }),
      })
    } catch (error) {
      // Silently fail - telemetry should never break the extension
      console.debug("[BrowserTelemetryClient] Failed to send event:", error)
    }
  }

  public async captureException(
    error: Error,
    additionalProperties?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isTelemetryEnabled()) {
      return
    }

    await this.capture({
      event: TelemetryEventName.SCHEMA_VALIDATION_ERROR,
      properties: {
        error: error.message,
        ...additionalProperties,
      },
    })
  }

  public setProvider(provider: TelemetryPropertiesProvider): void {
    this.providerRef = new WeakRef(provider)
  }

  public updateTelemetryState(didUserOptIn: boolean): void {
    this.telemetryEnabled = didUserOptIn
  }

  public isTelemetryEnabled(): boolean {
    return this.telemetryEnabled
  }

  public async shutdown(): Promise<void> {
    // No-op for browser client
  }
}