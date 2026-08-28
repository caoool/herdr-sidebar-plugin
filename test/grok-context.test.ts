import { test } from "node:test"
import assert from "node:assert/strict"
import { fromUpdates } from "../src/sections/session/sources/grok.js"

const chunk = (totalTokens: number) =>
  JSON.stringify({ params: { update: { sessionUpdate: "agent_message_chunk" }, _meta: { totalTokens } } })

const turnCompleted = (usage: Record<string, number>) =>
  JSON.stringify({ params: { update: { sessionUpdate: "turn_completed", usage } } })

test("context comes from the running context size, not cumulative spend", () => {
  // The bug: turn_completed.usage.totalTokens is spend for the whole session — 1,031,971 on a
  // real session against a 500,000-token window, most of it cached reads. Read as context it
  // gave 206%, clamped to a permanent 100%. _meta.totalTokens is the actual occupancy.
  const lines = [
    chunk(99_621),
    turnCompleted({ inputTokens: 1_024_783, outputTokens: 7_188, totalTokens: 1_031_971, apiDurationMs: 4_000 }),
  ]
  const { contextTokens } = fromUpdates(lines)
  assert.equal(contextTokens, 99_621)
})

test("the newest context reading wins", () => {
  assert.equal(fromUpdates([chunk(20_277), chunk(45_126)]).contextTokens, 45_126)
})

test("context may fall as well as rise, which is what makes it context", () => {
  // Observed in a real session: 46286 -> 45126 when the context was trimmed.
  assert.equal(fromUpdates([chunk(46_286), chunk(45_126)]).contextTokens, 45_126)
})

test("rate uses the duration that produced the tokens", () => {
  const { perSecond } = fromUpdates([turnCompleted({ outputTokens: 480, apiDurationMs: 4_000 })])
  assert.equal(perSecond, 120)
})

test("a turn with no usable duration yields no rate rather than a wrong one", () => {
  assert.equal(fromUpdates([turnCompleted({ outputTokens: 480, apiDurationMs: 0 })]).perSecond, null)
})

test("no records yields nothing", () => {
  assert.deepEqual(fromUpdates([]), { contextTokens: null, perSecond: null })
})
