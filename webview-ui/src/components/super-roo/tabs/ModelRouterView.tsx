import { useEffect, useState } from "react"
import { RefreshCw, TestTube2 } from "lucide-react"
import { modelRouterApi, type ModelRoute, type ProviderMetadata, type UsageSummaryEntry } from "../lib/modelRouterApi"
import { ProviderStatusStrip } from "./model-router/ProviderStatusStrip"
import { RouteTable } from "./model-router/RouteTable"
import { CostOptimizer } from "./model-router/CostOptimizer"
import { PerformanceMonitor } from "./model-router/PerformanceMonitor"
import { FallbackRules } from "./model-router/FallbackRules"
import { AgentSync } from "./model-router/AgentSync"
import { SafetyRules } from "./model-router/SafetyRules"

export function ModelRouterView() {
	const [providers, setProviders] = useState<ProviderMetadata[]>([])
	const [routes, setRoutes] = useState<ModelRoute[]>([])
	const [usage, setUsage] = useState<UsageSummaryEntry[]>([])
	const [loading, setLoading] = useState(true)

	async function load() {
		setLoading(true)
		try {
			const [p, r, u] = await Promise.all([
				modelRouterApi.providers(),
				modelRouterApi.routes(),
				modelRouterApi.usage(),
			])
			setProviders(p.providers)
			setRoutes(r.routes)
			setUsage(u.usage)
		} catch (err) {
			console.error("[ModelRouter] Failed to load data:", err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		load()
	}, [])

	async function syncApiKeys() {
		try {
			const result = await modelRouterApi.syncApiKeys()
			setProviders(result.providers)
		} catch (err) {
			console.error("[ModelRouter] Failed to sync API keys:", err)
		}
	}

	async function testAllRoutes() {
		try {
			await Promise.all(routes.map((r) => modelRouterApi.testRoute(r.taskType)))
			await load()
		} catch (err) {
			console.error("[ModelRouter] Failed to test routes:", err)
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full p-6 text-vscode-descriptionForeground">
				Loading AI Model Router...
			</div>
		)
	}

	return (
		<div className="min-h-full p-6 text-vscode-foreground">
			<div className="mx-auto max-w-7xl space-y-5">
				{/* Header */}
				<header className="flex items-start justify-between">
					<div>
						<h1 className="text-2xl font-bold text-vscode-foreground">AI Model Router</h1>
						<p className="mt-1 text-sm text-vscode-descriptionForeground">
							Intelligent routing of tasks to the best AI models.
						</p>
					</div>
					<div className="flex gap-3">
						<button
							onClick={syncApiKeys}
							className="inline-flex items-center gap-2 rounded-lg border border-vscode-panel-border px-4 py-2 text-sm text-vscode-foreground hover:bg-vscode-sideBar-background">
							<RefreshCw size={16} /> Sync API Keys
						</button>
						<button
							onClick={testAllRoutes}
							className="inline-flex items-center gap-2 rounded-lg bg-vscode-button-background px-4 py-2 text-sm font-medium text-vscode-button-foreground hover:opacity-90">
							<TestTube2 size={16} /> Test All Routes
						</button>
					</div>
				</header>

				{/* Provider Status */}
				<ProviderStatusStrip providers={providers} />

				{/* Routing Matrix */}
				<RouteTable routes={routes} providers={providers} />

				{/* Grid panels */}
				<div className="grid gap-5 xl:grid-cols-2">
					<CostOptimizer />
					<PerformanceMonitor usage={usage} />
					<FallbackRules />
					<AgentSync />
				</div>

				{/* Safety Rules */}
				<SafetyRules />

				{/* Footer */}
				<footer className="flex justify-between text-xs text-vscode-descriptionForeground">
					<span>All routing configurations are automatically saved and synced.</span>
					<span>Last saved 1m ago ✓</span>
				</footer>
			</div>
		</div>
	)
}
