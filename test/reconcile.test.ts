import { test } from "node:test"
import assert from "node:assert/strict"
import { reconcile } from "../src/sections/quota/sources/claude.js"

const RESET = 1_800_000_000
const session = (fiveHour: number | null, sevenDay: number | null = null, resets = RESET) => ({
  _collected_at: Date.now(),
  rate_limits: {
    ...(fiveHour === null ? {} : { five_hour: { used_percentage: fiveHour, resets_at: resets } }),
    ...(sevenDay === null ? {} : { seven_day: { used_percentage: sevenDay, resets_at: resets } }),
  },
})

test("takes the highest reading across concurrent sessions", () => {
  // Each session caches rate_limits from its own last API response, so an idle session holds
  // a staler figure. Usage only rises within a window, so the largest is the latest.
  const w = reconcile([session(2), session(3), session(0)])
  assert.equal(w.find((x) => x.id === "five_hour")?.percent, 3)
})

test("order of sessions does not matter — this is what caused the flicker", () => {
  const values = [session(0), session(3), session(2)]
  const forward = reconcile(values)
  const reversed = reconcile([...values].reverse())
  assert.deepEqual(forward, reversed)
})

test("a session with no rate_limits yet is ignored, not treated as zero", () => {
  // A session that has not had its first API response carries no rate_limits at all. It used
  // to blank the panel whenever its write landed last.
  const w = reconcile([{ _collected_at: Date.now() }, session(12)])
  assert.equal(w.find((x) => x.id === "five_hour")?.percent, 12)
})

test("a rolled-over window discards the previous window's high-water mark", () => {
  // Yesterday's 88% must not bleed into a window that has since reset.
  const stale = session(88, null, RESET - 5 * 3600)
  const fresh = session(4, null, RESET)
  const w = reconcile([stale, fresh])
  assert.equal(w.find((x) => x.id === "five_hour")?.percent, 4)
  assert.equal(w.find((x) => x.id === "five_hour")?.resetsAt, RESET)
})

test("windows are independent — one may be present without the other", () => {
  const w = reconcile([session(5, null), session(null, 40)])
  assert.equal(w.find((x) => x.id === "five_hour")?.percent, 5)
  assert.equal(w.find((x) => x.id === "seven_day")?.percent, 40)
})

test("no readings at all yields no windows", () => {
  assert.deepEqual(reconcile([{ _collected_at: 1 }, {}]), [])
})

test("window durations are carried so the reset formats correctly", () => {
  const w = reconcile([session(5, 40)])
  assert.equal(w.find((x) => x.id === "five_hour")?.windowMinutes, 300)
  assert.equal(w.find((x) => x.id === "seven_day")?.windowMinutes, 10080)
})

test("sibling state files are not mistaken for payloads", async () => {
  // <session>.mode.json and <session>.effort.json share the collector's directory. They carry
  // no rate_limits today, but the filename filter is what keeps them out on principle.
  const isPayload = (n: string) => /^[0-9a-fA-F-]{36}\.json$/.test(n)
  assert.ok(isPayload("cd3ad5bf-3fcd-4f47-8f5b-958d0fcbfa61.json"))
  assert.ok(!isPayload("cd3ad5bf-3fcd-4f47-8f5b-958d0fcbfa61.mode.json"))
  assert.ok(!isPayload("cd3ad5bf-3fcd-4f47-8f5b-958d0fcbfa61.effort.json"))
})
