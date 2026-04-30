// Add this inside your main extension activation file, usually src/extension.ts:
//
// import { registerSuperRooCommands } from "./super-roo-host/registerSuperRooCommands"
//
// export async function activate(context: vscode.ExtensionContext) {
//   ...existing Roo activation code...
//   registerSuperRooCommands(context)
// }
//
// Also add commands to package.json contributes.commands.
