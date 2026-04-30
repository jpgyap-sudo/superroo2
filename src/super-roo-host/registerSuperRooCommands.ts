import * as vscode from "vscode"
import { SuperRooOrchestrator } from "../super-roo/core/SuperRooOrchestrator"
import { createDefaultRuntime } from "../super-roo/core/createDefaultRuntime"

export function registerSuperRooCommands(context: vscode.ExtensionContext) {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
	const runtime = createDefaultRuntime({ source: "vscode", workspaceRoot })
	const orchestrator = new SuperRooOrchestrator(runtime)

	context.subscriptions.push(
		vscode.commands.registerCommand("superroo.status", async () => {
			await orchestrator.status()
			vscode.window.showInformationMessage("SuperRoo status printed to extension host console.")
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("superroo.autonomousSafe", async () => {
			await orchestrator.runAutonomous({ safeMode: true })
			vscode.window.showInformationMessage("SuperRoo autonomous safe-mode completed.")
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("superroo.checkVps", async () => {
			const url = await vscode.window.showInputBox({
				prompt: "Enter deployed app URL to check",
				placeHolder: "https://bot.example.com",
			})
			await orchestrator.checkVps({ args: url ? ["--url", url] : [] })
			vscode.window.showInformationMessage("SuperRoo VPS check completed.")
		}),
	)
}
