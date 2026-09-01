import { test } from "node:test"
import assert from "node:assert/strict"
import { mcpItems, mcpTally, toolItems, toolsTally } from "../src/sections/tools/format.js"
import type { Style } from "../src/ansi.js"

/** The two lists as the pane stacks them, minus the blank row it inserts between. */
const toolsBlock = (
  calls: ToolCall[], mcp: McpSnapshot | null, _agent: string, width: number, style: Style,
) => [
  ...(calls.length ? [toolsTally(calls, width, style)] : []),
  ...toolItems(calls, width, style),
  ...(mcp?.servers.length ? [mcpTally(mcp, width, style)] : []),
  ...mcpItems(mcp, width, style),
]
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

test("the total counts calls, not distinct tools", () => {
  const line = toolsTally(calls, 30, PLAIN)
  assert.ok(line.startsWith("tools"), line)
  assert.ok(line.endsWith("39"), line)
  assert.ok(!line.includes("calls"), "the bare figure, like MCP's")
})

test("every tool is listed — there is no top-N cut", () => {
  const many: ToolCall[] = Array.from({ length: 24 }, (_, i) => ({ name: `t${i}`, count: 24 - i }))
  const lines = toolsBlock(many, mcp, "claude", 30, PLAIN)
  for (let i = 0; i < 24; i++) assert.ok(row(lines, `t${i}`), `t${i} is missing`)
})

test("the MCP total counts healthy servers over the configured ones", () => {
  const line = mcpTally(mcp, 30, PLAIN)
  assert.ok(line.startsWith("mcp"), line)
  assert.ok(line.endsWith("1/3"), line)
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

test("no tool calls yet is a dash, not a confident zero", () => {
  assert.ok(toolsTally([], 30, PLAIN).endsWith("—"))
})

test("no MCP reading at all is a dash", () => {
  assert.ok(mcpTally(null, 30, PLAIN).endsWith("—"))
})

test("a dash is dimmed wherever it stands in for a value", () => {
  const lines = [toolsTally([], 30, TERMINAL), mcpTally(null, 30, TERMINAL)]
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

test("the total sits directly on its list, with no blank row between", () => {
  // It is part of the list rather than a heading over it, now that the headings are gone.
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.ok(lines[0].startsWith("tools"))
  assert.ok(strip(lines[1]).startsWith("Bash"), lines[1])
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
  const toolRow = plain[1] // the total, then the one call row
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
  // No calls yet, so the block is the MCP total then its one server row.
  const serverRow = plain[1]
  assert.ok(serverRow.length > 0, "the server row is missing")
  assert.equal(serverRow.length, 30)
})

test("an unverified server dashes rather than claiming a status glyph, but still counts toward the total, not the healthy count", () => {
  const withUnverified: McpSnapshot = {
    agent: "claude", observedAt: Date.now(),
    servers: [...mcp.servers, { name: "odd", status: "unverified" }],
  }
  const lines = toolsBlock(calls, withUnverified, "claude", 30, TERMINAL)
  // Still 1 healthy (context7) out of a total that now includes the unverified server.
  assert.ok(strip(mcpTally(withUnverified, 30, TERMINAL)).endsWith("1/4"))
  const oddRow = row(lines, "odd")
  assert.ok(strip(oddRow).endsWith("—"), oddRow)
  assert.match(oddRow, /\x1b\[2m—/, "the dash must be dimmed like every other unknown value")
})

test("a name that exactly fills the row is not needlessly truncated", () => {
  // width 30, a single-digit count leaves a value of 1 char and a minimum 1-column gap, so
  // the label budget is exactly 28 — a name of that length should survive whole, no ellipsis.
  const name = "x".repeat(28)
  const lines = toolsBlock([{ name, count: 7 }], null, "claude", 30, PLAIN)
  const toolRow = lines[1] // the total, then the one call row
  assert.equal(toolRow.length, 30)
  assert.ok(toolRow.startsWith(name), toolRow)
  assert.ok(!toolRow.includes("…"), toolRow)
})
