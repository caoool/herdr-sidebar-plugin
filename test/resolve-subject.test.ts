import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveSubject } from "../src/herdr.js"
import type { PaneAgent } from "../src/types.js"

const agent = (paneId: string, over: Partial<PaneAgent> = {}): PaneAgent => ({
  paneId, tabId: "w1:t1", workspaceId: "w1", agent: "claude",
  sessionId: "s", status: "idle", focused: false, ...over,
})

test("ignores our own pane", () => {
  process.env.HERDR_PANE_ID = "w1:p2"
  assert.equal(resolveSubject([agent("w1:p2")], "w1:t1", null), null)
})

test("keeps the previous subject when focus moves off every agent", () => {
  // The self-focus trap: focusing the sidebar makes focused_pane_id our own pane. Identity
  // must not follow focus, or the panel blanks the moment anyone clicks it.
  process.env.HERDR_PANE_ID = "w1:p2"
  const prev = agent("w1:p1")
  assert.equal(resolveSubject([], "w1:t1", prev), prev)
})

test("stays inside our own tab", () => {
  process.env.HERDR_PANE_ID = "w1:p2"
  const other = agent("w9:p1", { tabId: "w9:t1" })
  assert.equal(resolveSubject([other], "w1:t1", null), null)
})

test("prefers the focused agent when a tab holds several", () => {
  process.env.HERDR_PANE_ID = "w1:p9"
  const a = agent("w1:p1")
  const b = agent("w1:p2", { focused: true })
  assert.equal(resolveSubject([a, b], "w1:t1", null), b)
})
