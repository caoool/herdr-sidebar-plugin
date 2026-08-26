import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeIntervals, collectRequests, speedFrom } from "../src/sections/session/sources/claude-speed.js"

const T = Date.parse("2026-08-26T12:00:00.000Z")
const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString()
const user = (offsetMs: number) => JSON.stringify({ type: "user", timestamp: iso(offsetMs) })
const assistant = (offsetMs: number, outputTokens: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: iso(offsetMs), message: { usage: { output_tokens: outputTokens } }, ...extra })

test("overlapping intervals are counted once", () => {
  const merged = mergeIntervals([
    { startMs: 0, endMs: 100 },
    { startMs: 50, endMs: 150 },
    { startMs: 400, endMs: 500 },
  ])
  assert.deepEqual(merged, [{ startMs: 0, endMs: 150 }, { startMs: 400, endMs: 500 }])
})

test("touching intervals merge rather than double-count the boundary", () => {
  assert.deepEqual(
    mergeIntervals([{ startMs: 0, endMs: 100 }, { startMs: 100, endMs: 200 }]),
    [{ startMs: 0, endMs: 200 }],
  )
})

test("each assistant message is paired with the entry that prompted it", () => {
  const { requests } = collectRequests([user(0), assistant(1000, 500)])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].outputTokens, 500)
  assert.deepEqual(requests[0].interval, { startMs: T, endMs: T + 1000 })
})

test("idle time between turns never enters the denominator", () => {
  // Two 500-token responses of one second each, ten minutes apart: 1000 tokens over the 2s
  // actually spent generating them. Measuring against the wall clock instead would span 601s
  // and report 1.7 t/s, which describes how long the user took to type, not the model's rate.
  const lines = [user(0), assistant(1000, 500), user(600_000), assistant(601_000, 500)]
  const { requests, latestMs } = collectRequests(lines)
  assert.equal(speedFrom(requests, latestMs, 3600), 500)
})

test("subagent and error entries are excluded", () => {
  const lines = [
    user(0),
    assistant(1000, 500),
    assistant(1500, 9999, { isSidechain: true }),
    assistant(1800, 9999, { isApiErrorMessage: true }),
  ]
  const { requests } = collectRequests(lines)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].outputTokens, 500)
})

test("duplicate records for one response inflate tokens but not time", () => {
  // Streaming updates repeat a message's usage; merging intervals keeps the wall time honest.
  const lines = [user(0), assistant(1000, 500), assistant(1000, 500)]
  const { requests, latestMs } = collectRequests(lines)
  assert.equal(speedFrom(requests, latestMs, 3600), 1000)
})

test("only requests inside the window count", () => {
  const lines = [user(0), assistant(1000, 100_000), user(300_000), assistant(301_000, 500)]
  const { requests, latestMs } = collectRequests(lines)
  // Window ends at the latest entry, so the old huge response falls outside it.
  assert.equal(speedFrom(requests, latestMs, 120), 500)
})

test("the window ends at the transcript, not the wall clock", () => {
  // An idle session keeps reporting the rate of the work it last did.
  const lines = [user(0), assistant(1000, 500)]
  const { requests, latestMs } = collectRequests(lines)
  assert.equal(speedFrom(requests, latestMs, 120), 500)
})

test("no measurable work yields null rather than zero", () => {
  assert.equal(speedFrom([], null), null)
  const { requests, latestMs } = collectRequests([user(0)])
  assert.equal(speedFrom(requests, latestMs), null)
})

test("an assistant message with no preceding user entry contributes no interval", () => {
  const { requests, latestMs } = collectRequests([assistant(1000, 500)])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].interval, null)
  assert.equal(speedFrom(requests, latestMs), null)
})
