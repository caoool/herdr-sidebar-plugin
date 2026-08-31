import { test } from "node:test"
import assert from "node:assert/strict"
import { namesIn, shortenTool, tally } from "../src/sections/tools/sources/calls.js"

const claudeLine = (names: string[]) =>
  JSON.stringify({ message: { content: names.map((name) => ({ type: "tool_use", name })) } })

test("Claude tool calls come from tool_use blocks", () => {
  assert.deepEqual(namesIn("claude", claudeLine(["Bash", "Read"])), ["Bash", "Read"])
})

test("a Claude line with no tool blocks yields nothing", () => {
  assert.deepEqual(namesIn("claude", JSON.stringify({ message: { content: "plain text" } })), [])
})

test("Codex counts every call shape it emits", () => {
  const line = (type: string, name: string) => JSON.stringify({ payload: { type, name } })
  assert.deepEqual(namesIn("codex", line("custom_tool_call", "exec")), ["exec"])
  assert.deepEqual(namesIn("codex", line("function_call", "wait")), ["wait"])
  assert.deepEqual(namesIn("codex", line("local_shell_call", "shell")), ["shell"])
  assert.deepEqual(namesIn("codex", line("custom_tool_call_output", "exec")), [], "outputs are not calls")
})

test("Grok takes the tool name from _meta, never the rendered title", () => {
  // title is display text — "Read `/Users/lu/...`" — and would splinter one tool into many rows.
  const line = JSON.stringify({
    params: { update: {
      sessionUpdate: "tool_call",
      title: "Read `/Users/lu/dotfiles/x`",
      _meta: { "x.ai/tool": { name: "read_file" } },
    } },
  })
  assert.deepEqual(namesIn("grok", line), ["read_file"])
})

test("Grok's tool_call_update records are status changes, not new calls", () => {
  // There are ~2.5 updates per call; counting them would inflate every figure.
  const line = JSON.stringify({
    params: { update: { sessionUpdate: "tool_call_update", _meta: { "x.ai/tool": { name: "read_file" } } } },
  })
  assert.deepEqual(namesIn("grok", line), [])
})

test("MCP tool names collapse to server:tool", () => {
  assert.equal(shortenTool("mcp__github__search_code"), "github:search_code")
  assert.equal(shortenTool("mcp__plugin_cloudflare_cloudflare-docs__search"), "cloudflare-docs:search")
  assert.equal(shortenTool("Bash"), "Bash")
})

test("tally sorts by count, breaking ties alphabetically so the order is stable", () => {
  const lines = [claudeLine(["Bash", "Bash", "Read"]), claudeLine(["Edit", "Bash"])]
  assert.deepEqual(tally("claude", lines), [
    { name: "Bash", count: 3 },
    { name: "Edit", count: 1 },
    { name: "Read", count: 1 },
  ])
})

test("a malformed line is skipped rather than throwing", () => {
  assert.deepEqual(namesIn("claude", "{not json"), [])
  assert.deepEqual(tally("claude", ["{not json", claudeLine(["Bash"])]), [{ name: "Bash", count: 1 }])
})
