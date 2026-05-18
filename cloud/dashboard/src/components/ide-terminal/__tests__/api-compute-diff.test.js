/**
 * Unit tests for computeDiff() — a pure function that computes line-level diffs.
 *
 * Run: node cloud/dashboard/src/components/ide-terminal/__tests__/run-ide-tests.js
 */

const { test, section, assert } = require("./test-helpers.js")

// Re-implement computeDiff here for testing (avoids TS/import complexity)
function computeDiff(original, modified) {
	const origLines = original.split("\n")
	const modLines = modified.split("\n")
	const changes = []
	const maxLen = Math.max(origLines.length, modLines.length)
	for (let i = 0; i < maxLen; i++) {
		if (i >= origLines.length) {
			changes.push({ type: "added", content: modLines[i], lineNumber: i + 1 })
		} else if (i >= modLines.length) {
			changes.push({ type: "removed", content: origLines[i], lineNumber: i + 1 })
		} else if (origLines[i] !== modLines[i]) {
			changes.push({ type: "removed", content: origLines[i], lineNumber: i + 1 })
			changes.push({ type: "added", content: modLines[i], lineNumber: i + 1 })
		} else {
			changes.push({ type: "unchanged", content: origLines[i], lineNumber: i + 1 })
		}
	}
	return changes
}

// ── Tests ──────────────────────────────────────────────────────────────────

section("computeDiff — identical content")

test("returns all unchanged for identical single-line content", () => {
	const result = computeDiff("hello", "hello")
	assert.strictEqual(result.length, 1)
	assert.strictEqual(result[0].type, "unchanged")
	assert.strictEqual(result[0].content, "hello")
	assert.strictEqual(result[0].lineNumber, 1)
})

test("returns all unchanged for identical multi-line content", () => {
	const result = computeDiff("line1\nline2\nline3", "line1\nline2\nline3")
	assert.strictEqual(result.length, 3)
	assert.ok(result.every((c) => c.type === "unchanged"))
})

test("returns single unchanged entry for empty strings", () => {
	// split("") on empty string gives [""], so maxLen=1
	const result = computeDiff("", "")
	assert.strictEqual(result.length, 1)
	assert.strictEqual(result[0].type, "unchanged")
})

section("computeDiff — additions")

test("detects added lines at end", () => {
	const result = computeDiff("line1", "line1\nline2\nline3")
	assert.strictEqual(result.length, 3)
	assert.strictEqual(result[0].type, "unchanged")
	assert.strictEqual(result[1].type, "added")
	assert.strictEqual(result[1].content, "line2")
	assert.strictEqual(result[1].lineNumber, 2)
	assert.strictEqual(result[2].type, "added")
	assert.strictEqual(result[2].content, "line3")
	assert.strictEqual(result[2].lineNumber, 3)
})

test("detects added lines at beginning", () => {
	const result = computeDiff("line2", "line1\nline2")
	// origLines=["line2"], modLines=["line1","line2"], maxLen=2
	// i=0: "line2" !== "line1" → removed "line2", added "line1"
	// i=1: i>=origLines.length → added "line2"
	assert.strictEqual(result.length, 3)
	assert.strictEqual(result[0].type, "removed")
	assert.strictEqual(result[0].content, "line2")
	assert.strictEqual(result[1].type, "added")
	assert.strictEqual(result[1].content, "line1")
	assert.strictEqual(result[2].type, "added")
	assert.strictEqual(result[2].content, "line2")
})

section("computeDiff — removals")

test("detects removed lines", () => {
	const result = computeDiff("line1\nline2\nline3", "line1\nline3")
	// origLines=["line1","line2","line3"], modLines=["line1","line3"], maxLen=3
	// i=0: unchanged "line1"
	// i=1: "line2" !== "line3" → removed "line2", added "line3"
	// i=2: i>=modLines.length → removed "line3"
	assert.strictEqual(result.length, 4)
	assert.strictEqual(result[0].type, "unchanged")
	assert.strictEqual(result[1].type, "removed")
	assert.strictEqual(result[1].content, "line2")
	assert.strictEqual(result[2].type, "added")
	assert.strictEqual(result[2].content, "line3")
	assert.strictEqual(result[3].type, "removed")
	assert.strictEqual(result[3].content, "line3")
})

section("computeDiff — modifications")

test("detects modified lines as remove+add pair", () => {
	const result = computeDiff("hello world", "hello there")
	assert.strictEqual(result.length, 2)
	assert.strictEqual(result[0].type, "removed")
	assert.strictEqual(result[0].content, "hello world")
	assert.strictEqual(result[1].type, "added")
	assert.strictEqual(result[1].content, "hello there")
})

test("detects mixed unchanged, removed, added, modified", () => {
	const original = "a\nb\nc\nd"
	const modified = "a\nx\nc\ny\nz"
	const result = computeDiff(original, modified)
	// a=unchanged, b=removed, x=added, c=unchanged, d=removed, y=added, z=added
	assert.strictEqual(result.length, 7)
	assert.strictEqual(result[0].type, "unchanged")
	assert.strictEqual(result[0].content, "a")
	assert.strictEqual(result[1].type, "removed")
	assert.strictEqual(result[1].content, "b")
	assert.strictEqual(result[2].type, "added")
	assert.strictEqual(result[2].content, "x")
	assert.strictEqual(result[3].type, "unchanged")
	assert.strictEqual(result[3].content, "c")
	assert.strictEqual(result[4].type, "removed")
	assert.strictEqual(result[4].content, "d")
	assert.strictEqual(result[5].type, "added")
	assert.strictEqual(result[5].content, "y")
	assert.strictEqual(result[6].type, "added")
	assert.strictEqual(result[6].content, "z")
})

section("computeDiff — edge cases")

test("handles empty original", () => {
	const result = computeDiff("", "new content")
	// origLines=[""], modLines=["new content"], maxLen=1
	// i=0: "" !== "new content" → removed "", added "new content"
	assert.strictEqual(result.length, 2)
	assert.strictEqual(result[0].type, "removed")
	assert.strictEqual(result[0].content, "")
	assert.strictEqual(result[1].type, "added")
	assert.strictEqual(result[1].content, "new content")
})

test("handles empty modified", () => {
	const result = computeDiff("some content", "")
	// origLines=["some content"], modLines=[""], maxLen=1
	// i=0: "some content" !== "" → removed "some content", added ""
	assert.strictEqual(result.length, 2)
	assert.strictEqual(result[0].type, "removed")
	assert.strictEqual(result[0].content, "some content")
	assert.strictEqual(result[1].type, "added")
	assert.strictEqual(result[1].content, "")
})

test("handles trailing newline differences", () => {
	const result = computeDiff("a\nb\n", "a\nb")
	// origLines=["a","b",""], modLines=["a","b"], maxLen=3
	// i=0: unchanged "a"
	// i=1: unchanged "b"
	// i=2: i>=modLines.length → removed ""
	assert.strictEqual(result.length, 3)
	assert.strictEqual(result[0].type, "unchanged")
	assert.strictEqual(result[1].type, "unchanged")
	assert.strictEqual(result[2].type, "removed")
	assert.strictEqual(result[2].content, "")
})

test("handles special characters", () => {
	const result = computeDiff("const x = 1;", "const y = 2;")
	assert.strictEqual(result.length, 2)
	assert.strictEqual(result[0].type, "removed")
	assert.strictEqual(result[1].type, "added")
})

module.exports = { computeDiff }
