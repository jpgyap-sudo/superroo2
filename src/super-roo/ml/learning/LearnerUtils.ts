/**
 * Super Roo ML — Shared learner utilities
 *
 * End-to-end training helper that back-propagates through both the head
 * and the shared encoder so the encoder is updated jointly.
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss, BCELoss, type LossFn } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"

export function getLossFn(type: "mse" | "crossentropy" | "bce"): LossFn {
	switch (type) {
		case "mse":
			return new MSELoss()
		case "crossentropy":
			return new CrossEntropyLoss()
		case "bce":
			return new BCELoss()
	}
}

/**
 * Train a head end-to-end, updating both the head and the encoder.
 *
 * @returns Per-epoch loss array.
 */
export function trainEndToEnd(
	encoder: NeuralNetwork,
	head: NeuralNetwork,
	X: Tensor,
	y: Tensor,
	lossFn: LossFn,
	epochs: number,
	batchSize: number,
	lr: number,
): number[] {
	const losses: number[] = []
	const N = X.rows

	for (let epoch = 0; epoch < epochs; epoch++) {
		let epochLoss = 0
		let batches = 0

		for (let i = 0; i < N; i += batchSize) {
			const end = Math.min(i + batchSize, N)
			const xBatch = X.sliceRows(i, end)
			const yBatch = y.sliceRows(i, end)

			// Forward through encoder then head
			const encoded = encoder.forwardTraining(xBatch)
			const out = head.forwardTraining(encoded)

			// Loss + initial gradient
			const { loss, grad } = lossFn.forward(out, yBatch)
			epochLoss += loss
			batches++

			// Backward through head, then encoder
			let dOut = head.backward(grad)
			encoder.backward(dOut)

			// Optimizer step for both networks
			head.step(lr)
			encoder.step(lr)

			// Reset gradients
			head.zeroGrad()
			encoder.zeroGrad()
		}

		losses.push(epochLoss / Math.max(batches, 1))
	}

	return losses
}
