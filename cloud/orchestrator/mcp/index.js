/**
 * MCP Server Manager — Barrel exports
 *
 * Provides a production-grade MCP server lifecycle management system
 * inspired by Eclipse Theia's ai-mcp package.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-mcp/
 */

const { MCPServer } = require("./MCPServer")
const { MCPServerManager } = require("./MCPServerManager")

module.exports = {
	MCPServer,
	MCPServerManager,
}
