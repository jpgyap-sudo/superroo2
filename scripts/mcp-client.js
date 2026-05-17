#!/usr/bin/env node
/**
 * MCP Client Bridge for Kimi Code CLI
 * Permanently connects to local SuperRoo MCP Central Brain (port 3419)
 */

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:3419/mcp"

async function mcpCall(method, params = {}) {
	const res = await fetch(MCP_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method,
			params,
		}),
	})
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	const data = await res.json()
	if (data.error) throw new Error(data.error.message)
	return data.result
}

async function callTool(name, args = {}) {
	return mcpCall("tools/call", { name, arguments: args })
}

async function main() {
	const [cmd, ...rest] = process.argv.slice(2)

	if (!cmd || cmd === "--help" || cmd === "-h") {
		console.log(`Usage: node mcp-client.js <command> [args]

Commands:
  tools                List available MCP tools
  call <tool> [json]   Call an MCP tool with JSON arguments
  query <text>         Shortcut: query_memory
  projects             Shortcut: list_projects
  bugs [limit]         Shortcut: get_recent_bugs
  tasks                Shortcut: get_active_task
  hermes <query>       Shortcut: hermes_recall
  status [limit]       Shortcut: commit_deploy_status

Examples:
  node mcp-client.js query "auth module"
  node mcp-client.js call search_code '{"query":"tailwind","filePattern":"*.tsx"}'
  node mcp-client.js hermes "docker deployment"
`)
		return
	}

	try {
		switch (cmd) {
			case "tools": {
				const { tools } = await mcpCall("tools/list")
				console.log(JSON.stringify(tools, null, 2))
				break
			}
			case "call": {
				const [toolName, jsonArgs = "{}"] = rest
				const args = JSON.parse(jsonArgs)
				const result = await callTool(toolName, args)
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "query": {
				const result = await callTool("query_memory", { query: rest.join(" ") })
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "projects": {
				const result = await callTool("list_projects", {})
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "bugs": {
				const limit = Number(rest[0] || 10)
				const result = await callTool("get_recent_bugs", { limit })
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "tasks": {
				const result = await callTool("get_active_task", {})
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "hermes": {
				const result = await callTool("hermes_recall", { query: rest.join(" ") })
				console.log(JSON.stringify(result, null, 2))
				break
			}
			case "status": {
				const limit = Number(rest[0] || 5)
				const result = await callTool("commit_deploy_status", { limit })
				console.log(JSON.stringify(result, null, 2))
				break
			}
			default:
				console.error(`Unknown command: ${cmd}`)
				process.exit(1)
		}
	} catch (err) {
		console.error("Error:", err.message)
		process.exit(1)
	}
}

main()
