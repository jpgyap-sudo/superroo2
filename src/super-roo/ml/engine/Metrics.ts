/**
 * Super Roo ML — Evaluation Metrics
 *
 * Classification: accuracy, precision, recall, F1, confusion matrix
 * Regression: MAE, RMSE, R²
 * ActionOutcomeTracker: did the ML action help?
 */

export interface ConfusionMatrix {
	truePositives: number
	falsePositives: number
	trueNegatives: number
	falseNegatives: number
}

export interface ClassificationMetrics {
	accuracy: number
	precision: number
	recall: number
	f1: number
	confusionMatrix: ConfusionMatrix
}

export interface RegressionMetrics {
	mae: number
	rmse: number
	r2: number
}

function safeDiv(a: number, b: number): number {
	return b === 0 ? 0 : a / b
}

export function computeConfusionMatrix(predicted: number[], actual: number[]): ConfusionMatrix {
	let tp = 0,
		fp = 0,
		tn = 0,
		fn = 0
	for (let i = 0; i < predicted.length; i++) {
		const p = predicted[i]
		const a = actual[i]
		if (p === 1 && a === 1) tp++
		else if (p === 1 && a === 0) fp++
		else if (p === 0 && a === 0) tn++
		else if (p === 0 && a === 1) fn++
	}
	return { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn }
}

export function classificationMetricsFromConfusionMatrix(cm: ConfusionMatrix): ClassificationMetrics {
	const { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn } = cm
	const total = tp + fp + tn + fn
	const accuracy = total === 0 ? NaN : safeDiv(tp + tn, total)
	const precision = safeDiv(tp, tp + fp)
	const recall = safeDiv(tp, tp + fn)
	const f1 = safeDiv(2 * precision * recall, precision + recall)
	return { accuracy, precision, recall, f1, confusionMatrix: cm }
}

export function computeClassificationMetrics(predicted: number[], actual: number[]): ClassificationMetrics {
	return classificationMetricsFromConfusionMatrix(computeConfusionMatrix(predicted, actual))
}

export function computeMultiClassConfusionMatrix(
	predicted: number[],
	actual: number[],
	numClasses: number,
): number[][] {
	const matrix: number[][] = Array.from({ length: numClasses }, () => Array(numClasses).fill(0))
	for (let i = 0; i < predicted.length; i++) {
		const p = Math.max(0, Math.min(numClasses - 1, predicted[i]))
		const a = Math.max(0, Math.min(numClasses - 1, actual[i]))
		matrix[a][p]++
	}
	return matrix
}

export function computeRegressionMetrics(predicted: number[], actual: number[]): RegressionMetrics {
	if (predicted.length === 0 || actual.length === 0 || predicted.length !== actual.length) {
		return { mae: NaN, rmse: NaN, r2: NaN }
	}
	let sumAbs = 0
	let sumSq = 0
	let sumActual = 0
	for (let i = 0; i < predicted.length; i++) {
		const diff = predicted[i] - actual[i]
		sumAbs += Math.abs(diff)
		sumSq += diff * diff
		sumActual += actual[i]
	}
	const n = predicted.length
	const mae = sumAbs / n
	const rmse = Math.sqrt(sumSq / n)
	const meanActual = sumActual / n
	let ssTot = 0
	let ssRes = 0
	for (let i = 0; i < n; i++) {
		ssTot += (actual[i] - meanActual) ** 2
		ssRes += (actual[i] - predicted[i]) ** 2
	}
	const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
	return { mae, rmse, r2 }
}

/** Tracks whether ML-predicted actions actually improved outcomes. */
export interface ActionOutcomeRecord {
	predictionId: string
	timestamp: number
	actionType: string
	predictionConfidence: number
	beforeScore: number
	afterScore: number
}

export class ActionOutcomeTracker {
	private records: ActionOutcomeRecord[] = []
	private readonly maxRecords: number

	constructor(maxRecords = 10000) {
		this.maxRecords = maxRecords
	}

	record(
		predictionId: string,
		actionType: string,
		predictionConfidence: number,
		beforeScore: number,
		afterScore: number,
	): void {
		this.records.push({
			predictionId,
			timestamp: Date.now(),
			actionType,
			predictionConfidence,
			beforeScore,
			afterScore,
		})
		// Prune oldest records when exceeding max to prevent memory leak
		if (this.records.length > this.maxRecords) {
			this.records = this.records.slice(-this.maxRecords)
		}
	}

	/** Fraction of actions that improved the score (>0). */
	helpRate(windowMs = Infinity): number {
		const cutoff = Date.now() - windowMs
		const recent = this.records.filter((r) => r.timestamp >= cutoff)
		if (recent.length === 0) return 0
		return recent.filter((r) => r.afterScore > r.beforeScore).length / recent.length
	}

	/** Average score delta per action. */
	avgDelta(windowMs = Infinity): number {
		const cutoff = Date.now() - windowMs
		const recent = this.records.filter((r) => r.timestamp >= cutoff)
		if (recent.length === 0) return 0
		return recent.reduce((s, r) => s + (r.afterScore - r.beforeScore), 0) / recent.length
	}

	/** Precision of the action trigger: how often high-confidence predictions help. */
	helpPrecision(confidenceThreshold: number, windowMs = Infinity): number {
		const cutoff = Date.now() - windowMs
		const recent = this.records.filter(
			(r) => r.timestamp >= cutoff && r.predictionConfidence >= confidenceThreshold,
		)
		if (recent.length === 0) return 0
		return recent.filter((r) => r.afterScore > r.beforeScore).length / recent.length
	}

	getRecords(): readonly ActionOutcomeRecord[] {
		return this.records
	}

	clear(): void {
		this.records = []
	}
}
