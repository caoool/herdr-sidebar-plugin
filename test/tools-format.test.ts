import { test } from "node:test"
import assert from "node:assert/strict"
import { toolsBlock } from "../src/sections/tools/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import type { McpSnapshot, ToolCall } from "../src/sections/tools/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")
const row = (lines: string[], label: string): string =>
  lines.find((l) => strip(l).startsWith(label + " ")) ?? ""

const calls: ToolCall[] = [
  { name: "Bash", count: 21 },
  { name: "Read", count: 12 },
  { name: "github:search_code", count: 6 },
]
const mcp: McpSnapshot = {
  agent: "claude",
  observedAt: Date.now(),
  servers: [
    { name: "context7", status: "connected" },
    { name: "huggingface", status: "needs-auth" },
    { name: "playwright", status: "failed" },
  ],
}

test("the header counts total calls, not distinct tools", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.ok(lines[0].startsWith("TOOLS"))
  assert.ok(lines[0].endsWith("39 calls"), lines[0])
})

test("every tool is listed — there is no top-N cut", () => {
  const many: ToolCall[] = Array.from({ length: 24 }, (_, i) => ({ name: `t${i}`, count: 24 - i }))
  const lines = toolsBlock(many, mcp, "claude", 30, PLAIN)
  for (let i = 0; i < 24; i++) assert.ok(row(lines, `t${i}`), `t${i} is missing`)
})

test("the MCP header counts healthy servers over the total", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  const header = lines.find((l) => l.startsWith("MCP")) ?? ""
  assert.ok(header.endsWith("1/3"), header)
})

test("each status gets its own glyph", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.ok(row(lines, "context7").endsWith("●"))
  assert.ok(row(lines, "huggingface").endsWith("◐"))
  assert.ok(row(lines, "playwright").endsWith("✗"))
})

test("Codex renders enabled and disabled, and never a connected glyph", () => {
  const codex: McpSnapshot = {
    agent: "codex", observedAt: Date.now(),
    servers: [{ name: "node_repl", status: "enabled" }, { name: "codex_app", status: "disabled" }],
  }
  const lines = toolsBlock([], codex, "codex", 30, PLAIN)
  assert.ok(row(lines, "node_repl").endsWith("●"))
  assert.ok(row(lines, "codex_app").endsWith("○"))
})

test("no tool calls yet is a dash, not an empty block", () => {
  const lines = toolsBlock([], mcp, "claude", 30, PLAIN)
  assert.ok(lines[0].endsWith("—"), lines[0])
})

test("no MCP reading at all is a dash", () => {
  const lines = toolsBlock(calls, null, "grok", 30, PLAIN)
  const header = lines.find((l) => l.startsWith("MCP")) ?? ""
  assert.ok(header.endsWith("—"), header)
})

test("a dash is dimmed wherever it stands in for a value", () => {
  const lines = toolsBlock([], null, "grok", 30, TERMINAL)
  for (const line of lines.filter((l) => strip(l).includes("—"))) {
    assert.match(line, /\x1b\[2m—/)
  }
})

test("styling never changes a row's width", () => {
  const plain = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  const styled = toolsBlock(calls, mcp, "claude", 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
  for (const line of plain) if (line) assert.equal(line.length, 30)
})

test("the blank-row-after-title convention matches the other sections", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.equal(lines[1], "")
})

// A name long enough to fill the row on its own — both from real output. `labelled`'s gap
// floors at 1, so an untruncated label this long would push the row past `width`.
const LONG_TOOL = "playwright:browser_take_screenshot"
const LONG_SERVER = "plugin:chrome-devtools-mcp:chrome-devtools"

test("a tool name long enough to fill the row on its own still yields an exactly-width row", () => {
  const longCall: ToolCall[] = [{ name: LONG_TOOL, count: 3 }]
  const plain = toolsBlock(longCall, null, "claude", 30, PLAIN)
  const styled = toolsBlock(longCall, null, "claude", 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
  const toolRow = plain[2] // TOOLS header, blank, then the one call row
  assert.ok(toolRow.length > 0, "the call row is missing")
  assert.equal(toolRow.length, 30)
})

test("an MCP server name long enough to fill the row on its own still yields an exactly-width row", () => {
  const longMcp: McpSnapshot = {
    agent: "claude", observedAt: Date.now(),
    servers: [{ name: LONG_SERVER, status: "connected" }],
  }
  const plain = toolsBlock([], longMcp, "claude", 30, PLAIN)
  const styled = toolsBlock([], longMcp, "claude", 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
  // TOOLS dash(0), blank(1), blank before MCP(2), MCP header(3), blank(4), the one server row(5)
  const serverRow = plain[5]
  assert.ok(serverRow.length > 0, "the server row is missing")
  assert.equal(serverRow.length, 30)
})

test("a name that exactly fills the row is not needlessly truncated", () => {
  // width 30, a single-digit count leaves a value of 1 char and a minimum 1-column gap, so
  // the label budget is exactly 28 — a name of that length should survive whole, no ellipsis.
  const name = "x".repeat(28)
  const lines = toolsBlock([{ name, count: 7 }], null, "claude", 30, PLAIN)
  const toolRow = lines[2]
  assert.equal(toolRow.length, 30)
  assert.ok(toolRow.startsWith(name), toolRow)
  assert.ok(!toolRow.includes("…"), toolRow)
})
