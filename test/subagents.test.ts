import { test } from "node:test"
import assert from "node:assert/strict"
import { runningIn as grokRunning } from "../src/sections/subagents/sources/grok.js"
import { childOf, isFinished } from "../src/sections/subagents/sources/codex.js"
import { scan } from "../src/sections/subagents/sources/claude.js"
import { subagentsBlock, subagentItems, subagentsHead } from "../src/sections/subagents/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"
import type { Subagent } from "../src/sections/subagents/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

// --- Grok ------------------------------------------------------------------------------------
// Shapes captured from a live session that spawned two `explore` subagents.

const spawned = (id: string, description: string, type = "explore") =>
  JSON.stringify({ method: "_x.ai/session/update", params: { update: {
    sessionUpdate: "subagent_spawned", subagent_id: id, child_session_id: id,
    subagent_type: type, description, role: type, model: "grok-4.6",
  } } })

const done = (id: string) =>
  JSON.stringify({ method: "_x.ai/session/update", params: { update: {
    sessionUpdate: "subagent_finished", subagent_id: id, status: "completed", duration_ms: 14604,
  } } })

test("Grok: a spawned subagent with no finish is running", () => {
  assert.deepEqual(grokRunning([spawned("s1", "Count files in directory")]),
    [{ id: "s1", label: "Count files in directory", kind: "explore" }])
})

test("Grok: a finished subagent is gone", () => {
  assert.deepEqual(grokRunning([spawned("s1", "Count files"), done("s1")]), [])
})

test("Grok: the live two-subagent case resolves as observed", () => {
  const out = grokRunning([spawned("a", "one"), spawned("b", "two"), done("a")])
  assert.deepEqual(out.map((s) => s.label), ["two"])
})

// --- Codex -----------------------------------------------------------------------------------
// The child rollout's opening record, captured verbatim.

const META = {
  session_id: "01a05c2c", id: "01a05c2d",
  parent_thread_id: "01a05c2c", thread_source: "subagent",
  agent_nickname: "Zeno", agent_path: "/root/count_files",
  cwd: "/private/tmp/satest", multi_agent_version: "v2",
}

test("Codex: a rollout naming us as its parent is our subagent", () => {
  assert.deepEqual(childOf(META, "01a05c2c"),
    { id: "01a05c2d", label: "count_files", kind: "Zeno" })
})

test("Codex: another session's subagent is not ours", () => {
  assert.equal(childOf(META, "some-other-session"), null)
})

test("Codex: an ordinary session rollout is not a subagent", () => {
  const { thread_source, ...plain } = META
  assert.equal(childOf(plain, "01a05c2c"), null)
})

test("Codex: a rollout that recorded its completion is finished", () => {
  assert.equal(isFinished(['{"payload":{"type":"task_complete"}}']), true)
  assert.equal(isFinished(['{"payload":{"type":"task_started"}}']), false)
})

// --- Claude ----------------------------------------------------------------------------------

test("Claude: launches and completions are matched across wrapped notifications", () => {
  // A structured parse missed four of twenty-two on a real transcript, because notifications
  // arrive nested inside system reminders and tool results. Scanning the raw line finds them.
  const launched = new Set<string>()
  const completed = new Set<string>()
  scan('{"x":"...agentId: a1234abc (internal ID...)"}', launched, completed)
  scan('{"content":"<system-reminder>...<task-id>a1234abc</task-id>..."}', launched, completed)
  assert.deepEqual([...launched], ["a1234abc"])
  assert.deepEqual([...completed], ["a1234abc"])
})

test("Claude: several ids on one line are all seen", () => {
  const launched = new Set<string>()
  const completed = new Set<string>()
  scan("agentId: a963c4b7eb1 and agentId: a065d3b17b0", launched, completed)
  assert.equal(launched.size, 2)
})

test("Claude: a background task id is not a subagent", () => {
  // Agent ids begin with `a`; background shells and Monitor tasks get `b` ids. Both appear in
  // the same transcript, and counting a shell as a subagent would inflate the section.
  const launched = new Set<string>()
  const completed = new Set<string>()
  scan("backgroundTaskId: bixw97xhp started", launched, completed)
  assert.equal(launched.size, 0)
})

test("Claude: a line with neither marker contributes nothing", () => {
  const launched = new Set<string>()
  const completed = new Set<string>()
  scan('{"type":"text","text":"just a message"}', launched, completed)
  assert.equal(launched.size + completed.size, 0)
})

// --- Rendering -------------------------------------------------------------------------------

const running: Subagent[] = [
  { id: "1", label: "Count files in directory", kind: "explore" },
  { id: "2", label: "Review the diff", kind: "general-purpose" },
]

test("the heading counts what is in flight", () => {
  assert.ok(subagentsHead(running, 30, PLAIN)[0].endsWith("2"))
})

test("nothing in flight is a dash, not a zero", () => {
  assert.ok(subagentsHead(null, 30, PLAIN)[0].endsWith("—"))
  assert.ok(subagentsHead([], 30, PLAIN)[0].endsWith("—"))
})

test("a row shows what the subagent was asked to do", () => {
  const items = subagentItems(running, 30, PLAIN).map(strip)
  assert.ok(items[0].startsWith("◆ Count files"))
})

test("a subagent with no description at all shows a dash rather than a blank row", () => {
  const [row] = subagentItems([{ id: "1", label: "", kind: null }], 30, TERMINAL)
  assert.ok(strip(row).startsWith("◆ —"))
  assert.match(row, /\x1b\[2m—/)
})

test("a kind stands in when there is no description", () => {
  const [row] = subagentItems([{ id: "1", label: "", kind: "explore" }], 30, PLAIN)
  assert.ok(strip(row).startsWith("◆ explore"))
})

test("every row fits its column budget, including a very long description", () => {
  const long = [{ id: "1", label: "x".repeat(300), kind: null }]
  for (const width of [20, 30, 34]) {
    for (const line of subagentsBlock({ agent: "claude", running: long, observedAt: 0 }, width, PLAIN)) {
      if (!line) continue
      assert.ok(displayWidth(strip(line)) <= width, `width ${width}: ${JSON.stringify(line)}`)
    }
  }
})

test("styling never changes a row's width", () => {
  const snap = { agent: "grok" as const, running, observedAt: 0 }
  assert.deepEqual(subagentsBlock(snap, 30, TERMINAL).map(strip), subagentsBlock(snap, 30, PLAIN))
})
