import { test } from "node:test"
import assert from "node:assert/strict"
import { orderTasks, toTodo } from "../src/sections/todos/sources/claude.js"
import { newestPlan } from "../src/sections/todos/sources/grok.js"
import { todosBlock, todoItems, todosHead } from "../src/sections/todos/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"
import type { Todo, TodoSnapshot } from "../src/sections/todos/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

// Captured from ~/.claude/tasks on 2026-09-01, including the fields we deliberately ignore.
const TASK = {
  id: "51",
  subject: "三波形 tDCS/tACS/tPCS 落地",
  description: "全部落地并提交",
  activeForm: "落地三波形",
  status: "completed",
  blocks: "[]",
  blockedBy: "[]",
}

test("tasks are read in the agent's own numeric order, not the directory's", () => {
  // "10.json" sorts before "9.json" as a string, which would silently reorder the list.
  assert.deepEqual(orderTasks(["10.json", "9.json", "1.json"]), ["1.json", "9.json", "10.json"])
})

test("files that are not tasks are ignored", () => {
  assert.deepEqual(orderTasks(["1.json", "notes.md", ".DS_Store", "2.json"]), ["1.json", "2.json"])
})

test("a task keeps its subject and status, and nothing is invented from the rest", () => {
  assert.deepEqual(toTodo(TASK), { text: "三波形 tDCS/tACS/tPCS 落地", status: "completed" })
})

test("a task with an unrecognised status is dropped rather than guessed at", () => {
  assert.equal(toTodo({ ...TASK, status: "wat" }), null)
  assert.equal(toTodo({ ...TASK, status: undefined }), null)
  assert.equal(toTodo({ subject: "x" }), null)
})

const planLine = (entries: unknown[]) =>
  JSON.stringify({ params: { update: { sessionUpdate: "plan", entries } } })

test("Grok's newest plan wins, because it re-emits the whole list on every change", () => {
  const lines = [
    planLine([{ content: "old", status: "pending" }]),
    planLine([{ content: "new", status: "in_progress" }, { content: "next", status: "pending" }]),
  ]
  assert.deepEqual(newestPlan(lines), [
    { text: "new", status: "in_progress" },
    { text: "next", status: "pending" },
  ])
})

test("Grok entries keep their order and drop only what they cannot state", () => {
  const lines = [planLine([
    { content: "a", status: "completed" },
    { content: "b", status: "nonsense" },
    { content: "c", status: "failed" },
  ])]
  assert.deepEqual(newestPlan(lines), [
    { text: "a", status: "completed" },
    { text: "c", status: "failed" },
  ])
})

test("no plan in the window is null, not an empty list", () => {
  assert.equal(newestPlan([]), null)
  assert.equal(newestPlan(['{"params":{"update":{"sessionUpdate":"tool_call"}}}']), null)
})

const todos: Todo[] = [
  { text: "Detach stdin", status: "completed" },
  { text: "Wire the MCP cache", status: "in_progress" },
  { text: "Add the todos section", status: "pending" },
  { text: "Probe the leader socket", status: "failed" },
]
const snap: TodoSnapshot = { agent: "claude", todos, observedAt: Date.now() }

test("the heading counts completed over total", () => {
  const [head] = todosHead(todos, 30, PLAIN)
  assert.ok(head.startsWith("TODOS"))
  assert.ok(head.endsWith("1/4"), head)
})

test("each state gets its own glyph, and the order is untouched", () => {
  const items = todoItems(todos, 30, PLAIN).map(strip)
  assert.ok(items[0].startsWith("✓ Detach stdin"))
  assert.ok(items[1].startsWith("● Wire the MCP cache"))
  assert.ok(items[2].startsWith("○ Add the todos section"))
  assert.ok(items[3].startsWith("✗ Probe the leader socket"))
})

test("only work underway is lit; pending and failed are not achievements", () => {
  const items = todoItems(todos, 30, TERMINAL)
  assert.match(items[1], /\x1b\[38;5;41m●/, "in progress is lit")
  assert.ok(!/\x1b\[38;5;41m/.test(items[2]), "pending is not")
  assert.ok(!/\x1b\[38;5;41m/.test(items[3]), "failed is not")
})

test("no todos at all is a dash, never an empty list reading as finished", () => {
  const [head] = todosHead(null, 30, PLAIN)
  assert.ok(head.endsWith("—"), head)
  assert.deepEqual(todoItems(null, 30, PLAIN), [])
})

test("every row fits its column budget, including CJK subjects", () => {
  const cjk: Todo[] = [{ text: "三波形 tDCS/tACS/tPCS 落地（spec 2026-08-25）", status: "completed" }]
  for (const width of [20, 30, 34]) {
    for (const line of todosBlock({ agent: "claude", todos: cjk, observedAt: 0 }, width, PLAIN)) {
      if (!line) continue
      assert.ok(displayWidth(strip(line)) <= width,
        `width ${width}: ${displayWidth(strip(line))} in ${JSON.stringify(line)}`)
    }
  }
})

test("styling never changes a row's width", () => {
  const plain = todosBlock(snap, 30, PLAIN)
  const styled = todosBlock(snap, 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
})
