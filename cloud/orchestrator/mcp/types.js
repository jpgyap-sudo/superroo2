/**
 * MCP Server Manager — Type definitions
 *
 * Mirrors Theia's MCPServerDescription and related types.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-mcp/src/common/mcp-server-manager.ts
 */

/**
 * @typedef {Object} MCPServerDescription
 * @property {string} name — Unique server name
 * @property {string} [description] — Human-readable description
 * @property {string} [command] — Shell command to start the server
 * @property {string[]} [args] — Arguments for the command
 * @property {Object<string,string>} [env] — Environment variables
 * @property {string} [url] — URL for remote MCP servers (alternative to command+args)
 * @property {'stdio'|'sse'|'streamable-http'} [transport] — Transport type (default: stdio)
 * @property {'stopped'|'starting'|'running'|'error'} [status] — Current server status
 * @property {string} [error] — Last error message if status is 'error'
 * @property {MCPServerTool[]} [tools] — Available tools (populated after start)
 * @property {Object} [metadata] — Arbitrary metadata
 */

/**
 * @typedef {Object} MCPServerTool
 * @property {string} name — Tool name
 * @property {string} [description] — Tool description
 * @property {Object} [inputSchema] — JSON Schema for tool input
 */

/**
 * @typedef {Object} MCPCallToolResult
 * @property {boolean} success — Whether the tool call succeeded
 * @property {string} [content] — Text content result
 * @property {Object[]} [contentParts] — Multi-part content (text, image, resource)
 * @property {boolean} [isError] — Whether the result is an error
 * @property {string} [error] — Error message if failed
 */

/**
 * @typedef {Object} MCPResourceContent
 * @property {string} uri — Resource URI
 * @property {string} mimeType — MIME type
 * @property {string} text — Text content
 */

/**
 * @typedef {Object} MCPServerConfig
 * @property {string} name
 * @property {string} [description]
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {Object<string,string>} [env]
 * @property {string} [url]
 * @property {'stdio'|'sse'|'streamable-http'} [transport]
 * @property {Object} [metadata]
 */

/**
 * @typedef {'stopped'|'starting'|'running'|'error'} ServerStatus
 */

/**
 * @typedef {Object} MCPListChangedNotification
 * @property {'added'|'removed'|'status_changed'} type
 * @property {string} serverName
 * @property {ServerStatus} [status]
 */

export default {}

// JSDoc type exports for IDE intellisense
export const MCPServerDescription = {}
export const MCPServerTool = {}
export const MCPCallToolResult = {}
export const MCPResourceContent = {}
export const MCPServerConfig = {}
