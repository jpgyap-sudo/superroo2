"use client"

import { X, Check, XCircle } from "lucide-react"
import type { DiffData } from "./types"

interface DiffViewModalProps {
	diffData: DiffData
	onClose: () => void
	onApply?: () => void
	onDiscard?: () => void
}

export default function DiffViewModal({ diffData, onClose, onApply, onDiscard }: DiffViewModalProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}>
			<div className="bg-[#0f1117] border border-[#1e2535] rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2535] shrink-0">
					<div>
						<h2 className="text-[13px] font-medium text-[#e6edf3]">Review Changes</h2>
						<p className="text-[11px] text-[#8b949e] font-mono">{diffData.filePath}</p>
					</div>
					<button
						className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
						onClick={onClose}>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Diff content */}
				<div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
					{diffData.changes.length === 0 ? (
						<div className="text-center py-8 text-[#484f58] text-[12px]">No changes detected</div>
					) : (
						<table className="w-full border-collapse">
							<tbody>
								{diffData.changes.map((change, i) => (
									<tr
										key={i}
										className={
											change.type === "added"
												? "bg-[#3fb95011]"
												: change.type === "removed"
													? "bg-[#f8514911]"
													: ""
										}>
										<td className="w-10 text-right pr-2 text-[#484f58] select-none border-r border-[#1e2535]">
											{change.lineNumber}
										</td>
										<td className="w-6 text-center border-r border-[#1e2535]">
											{change.type === "added" ? (
												<span className="text-[#3fb950]">+</span>
											) : change.type === "removed" ? (
												<span className="text-[#f85149]">-</span>
											) : (
												<span className="text-[#484f58]"> </span>
											)}
										</td>
										<td
											className={`px-2 whitespace-pre-wrap ${
												change.type === "added"
													? "text-[#3fb950]"
													: change.type === "removed"
														? "text-[#f85149]"
														: "text-[#8b949e]"
											}`}>
											{change.content}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>

				{/* Actions */}
				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e2535] shrink-0">
					{onDiscard && (
						<button
							className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[#f85149] border border-[#f8514933] rounded hover:bg-[#f8514911] transition-colors"
							onClick={onDiscard}>
							<XCircle className="w-3.5 h-3.5" />
							Discard
						</button>
					)}
					{onApply && (
						<button
							className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[#238636] text-white rounded hover:bg-[#2ea043] transition-colors"
							onClick={onApply}>
							<Check className="w-3.5 h-3.5" />
							Apply Changes
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
