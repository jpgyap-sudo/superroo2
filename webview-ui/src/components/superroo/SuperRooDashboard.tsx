import React from "react"

export function SuperRooDashboard() {
	return (
		<div className="p-4 space-y-4">
			<div>
				<h2 className="text-xl font-semibold">SuperRoo Dashboard</h2>
				<p className="text-sm opacity-80">Phase 3 control panel placeholder.</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				<StatusCard title="Autonomous Mode" value="Safe skeleton" />
				<StatusCard title="CLI" value="Enabled" />
				<StatusCard title="Deploy Checker" value="Skeleton" />
			</div>

			<div className="rounded-xl border p-3">
				<h3 className="font-medium">Next Wiring Tasks</h3>
				<ul className="list-disc pl-5 text-sm mt-2 space-y-1">
					<li>Connect dashboard buttons to VS Code webview messages.</li>
					<li>Show agent logs from SuperRooOrchestrator.</li>
					<li>Add bug registry and feature registry tables.</li>
					<li>Keep production deploy disabled until Phase 5 rollback exists.</li>
				</ul>
			</div>
		</div>
	)
}

function StatusCard(props: { title: string; value: string }) {
	return (
		<div className="rounded-xl border p-3 shadow-sm">
			<div className="text-sm opacity-70">{props.title}</div>
			<div className="text-lg font-semibold">{props.value}</div>
		</div>
	)
}
