"use client"

import { useState, useEffect, useCallback } from "react"
import { StatCard, Card } from "@/components/ui/card"

import {
	BrainCircuit,
	Activity,
	CheckCircle2,
	XCircle,
	Zap,
	RefreshCw,
	Loader2,
	AlertTriangle,
	Play,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface MLModelStats {
	modelType: string
	loopsRun: number
	observationsCollected: number
	predictionsMade: number
	actionsTaken: number
}

interface LearnerStatus {
	code: { samples: number; lastTrained: string }
	debug: { samples: number; lastTrained: string }
	test: { samples: number; lastTrained: string }
}

interface ImprovementStats {
	cyclesRun: number
	lessonsExtracted: number
	skillsCreated: number
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function MLEngineView() {
	const [model, setModel] = useState<MLModelStats | null>(null)
	const [learners, setLearners] = useState<LearnerStatus | null>(null)
	const [improvement, setImprovement] = useState<ImprovementStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [training, setTraining] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchAll = useCallback(async () => {
		try {
			const [modelRes, learnersRes, improvementRes] = await Promise.all([
				fetch("/api/orchestrator/ml/model").then((r) => r.json()),
				fetch("/api/orchestrator/ml/learners").then((r) => r.json()),
				fetch("/api/orchestrator/improvement/stats").then((r) => r.json()),
			])

			// Model stats — API returns {modelType, loopsRun, ...} directly
			setModel(modelRes)

			// Learners — API returns {learners: [{name, status, samples}, ...]}
			// Transform to {code: {samples}, debug: {samples}, test: {samples}}
			const learnersMap: any = {
				code: { samples: 0, lastTrained: "" },
				debug: { samples: 0, lastTrained: "" },
				test: { samples: 0, lastTrained: "" },
			}
			if (learnersRes.learners) {
				learnersRes.learners.forEach((l: any) => {
					learnersMap[l.name] = { samples: l.samples, lastTrained: l.lastTrained || "" }
				})
			}
			setLearners(learnersMap)

			// Improvement stats — API returns {success: true, stats: {loopsRun, ...}}
			// Transform to {cyclesRun, lessonsExtracted, skillsCreated}
			const stats = improvementRes.stats || improvementRes
			setImprovement({
				cyclesRun: stats.loopsRun || 0,
				lessonsExtracted: stats.observationsCollected || 0,
				skillsCreated: stats.predictionsMade || 0,
			})

			setError(null)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to fetch ML stats")
		} finally {
			setLoading(false)
		}
	}, [])

	const triggerTraining = async () => {
		setTraining(true)
		try {
			await fetch("/api/orchestrator/ml/train", { method: "POST" })
			await new Promise((r) => setTimeout(r, 2000))
			await fetchAll()
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Training failed")
		} finally {
			setTraining(false)
		}
	}

	useEffect(() => {
		fetchAll()
		const iv = setInterval(fetchAll, 15000)
		return () => clearInterval(iv)
	}, [fetchAll])

	if (loading && !model) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-violet-400" />
			</div>
		)
	}

	if (error && !model) {
		return (
			<Card className="border-red-800/40 bg-red-950/20 p-6">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-5 w-5 text-red-400" />
					<p className="text-red-300">Failed to load ML Engine stats: {error}</p>
				</div>
				<button
					onClick={fetchAll}
					className="mt-4 rounded-lg bg-red-800/30 px-4 py-2 text-sm text-red-300 hover:bg-red-800/50">
					Retry
				</button>
			</Card>
		)
	}

	const m = model || { modelType: "—", loopsRun: 0, observationsCollected: 0, predictionsMade: 0, actionsTaken: 0 }
	const l = learners || { code: { samples: 0 }, debug: { samples: 0 }, test: { samples: 0 } }
	const i = improvement || { cyclesRun: 0, lessonsExtracted: 0, skillsCreated: 0 }

	return (
		<div className="space-y-6 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold text-slate-100">ML Engine</h2>
					<p className="text-sm text-slate-400">
						Neural network training, learners, and infinite improvement loop
					</p>
				</div>
				<button
					onClick={triggerTraining}
					disabled={training}
					className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed">
					{training ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
					{training ? "Training..." : "Train Cycle"}
				</button>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Model Type" value={m.modelType} sub="Active NN" />
				<StatCard label="Loops Run" value={m.loopsRun.toLocaleString()} sub="Training cycles" />
				<StatCard label="Observations" value={m.observationsCollected.toLocaleString()} sub="Data points" />
				<StatCard label="Predictions" value={m.predictionsMade.toLocaleString()} sub="Model outputs" />
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Card className="border-slate-800/40 bg-slate-900/40 p-5">
					<h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">
						Learner Status
					</h3>
					<div className="space-y-3">
						{[
							{ name: "CodeLearner", data: l.code },
							{ name: "DebugLearner", data: l.debug },
							{ name: "TestLearner", data: l.test },
						].map((learner) => (
							<div
								key={learner.name}
								className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-4 py-3">
								<div className="flex items-center gap-3">
									<BrainCircuit className="h-4 w-4 text-violet-400" />
									<span className="text-sm text-slate-200">{learner.name}</span>
								</div>
								<span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide border border-slate-700 text-slate-300">
									{(learner.data as any).samples || 0} samples
								</span>
							</div>
						))}
					</div>
				</Card>

				<Card className="border-slate-800/40 bg-slate-900/40 p-5">
					<h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">
						Infinite Improvement Loop
					</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-4 py-3">
							<span className="text-sm text-slate-300">Cycles Run</span>
							<span className="text-sm font-medium text-slate-100">{i.cyclesRun}</span>
						</div>
						<div className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-4 py-3">
							<span className="text-sm text-slate-300">Lessons Extracted</span>
							<span className="text-sm font-medium text-slate-100">{i.lessonsExtracted}</span>
						</div>
						<div className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-950/50 px-4 py-3">
							<span className="text-sm text-slate-300">Skills Created</span>
							<span className="text-sm font-medium text-slate-100">{i.skillsCreated}</span>
						</div>
					</div>
				</Card>
			</div>
		</div>
	)
}
