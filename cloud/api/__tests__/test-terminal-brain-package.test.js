/**
 * Runtime smoke test for the built terminal-core package consumed by cloud API code.
 *
 * Run with: node cloud/api/__tests__/test-terminal-brain-package.test.js
 */

const assert = require("assert")
const { loadTerminalCore } = require("../lib/terminalCore")
const { TerminalBrain } = loadTerminalCore()

const brain = new TerminalBrain({
	workspaceRoot: process.cwd(),
	sessionId: "terminal-brain-smoke",
})

assert.strictEqual(typeof TerminalBrain, "function")
assert.ok(brain)
assert.strictEqual(typeof brain.process, "function")

console.log("terminal-core package smoke test passed")
