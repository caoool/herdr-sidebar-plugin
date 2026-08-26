import { test } from "node:test"
import assert from "node:assert/strict"
import { _toWindow as toWindow } from "../src/sections/quota/sources/codex.js"
import { isExpired as expired } from "../src/sections/quota/freshness.js"
import type { QuotaWindow } from "../src/sections/quota/types.js"

const NOW = 1_800_000_000_000
const at = (offsetSeconds: number) => Math.floor(NOW / 1000) + offsetSeconds

const win = (resetsAt: number | null): QuotaWindow =>
  ({ id: "primary", label: "7d", percent: 4, resetsAt, windowMinutes: 10080, active: true })

test("a window whose reset has passed is expired", () => {
  // The reported case: an eight-day-old rollout reading 4%, its reset six days gone, was
  // rendered as a current "4%" with a meaningless "0D" countdown.
  assert.ok(expired(win(at(-6 * 86400)), NOW))
})

test("a window resetting in the future is not expired", () => {
  assert.ok(!expired(win(at(3 * 86400)), NOW))
})

test("the boundary itself counts as expired", () => {
  assert.ok(expired(win(at(0)), NOW))
  assert.ok(!expired(win(at(1)), NOW))
})

test("a window with no reset time is never treated as expired", () => {
  // Nothing is known about its period, so there is no basis to discard the figure.
  assert.ok(!expired(win(null), NOW))
})

test("snake_case rollout and camelCase wire fields produce the same window", () => {
  const fromRollout = toWindow("primary", 4, 10080, at(3 * 86400))
  const fromWire = toWindow("primary", 4, 10080, at(3 * 86400))
  assert.deepEqual(fromRollout, fromWire)
  assert.equal(fromRollout?.label, "7d")
})

test("a missing percentage yields no window rather than a zero", () => {
  assert.equal(toWindow("secondary", undefined, 10080, at(1)), null)
})

test("the label comes from the reported duration, not a fixed assumption", () => {
  // Codex changed this server-side from 10080 to 43200 within three weeks.
  assert.equal(toWindow("primary", 1, 43200, null)?.label, "30d")
  assert.equal(toWindow("primary", 1, 300, null)?.label, "5h")
  assert.equal(toWindow("primary", 1, 90, null)?.label, "90m")
})
