import { test } from "node:test"
import assert from "node:assert/strict"
import { autoDismiss } from "../src/dismiss.js"

const GRACE = 12_000
const T = 1_000_000

test("closes once the agent has been gone for the grace period", () => {
  const d = autoDismiss(true, GRACE)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(!d.ready(T + 1000))
  assert.ok(!d.ready(T + 1000 + GRACE - 1))
  assert.ok(d.ready(T + 1000 + GRACE))
})

test("a momentary detection drop does not close it", () => {
  // Detection is screen-based and can lose an agent during a redraw or a model switch.
  const d = autoDismiss(true, GRACE)
  d.note(true, T)
  d.note(false, T + 1000)
  d.note(true, T + 3000)
  assert.ok(!d.ready(T + 100_000))
})

test("the clock measures from the first empty poll, not the latest", () => {
  const d = autoDismiss(true, GRACE)
  d.note(true, T)
  d.note(false, T + 1000)
  d.note(false, T + 5000)
  d.note(false, T + 9000)
  assert.ok(d.ready(T + 1000 + GRACE))
})

test("a sidebar opened by hand where no agent has ever run stays put", () => {
  const d = autoDismiss(true, GRACE)
  d.note(false, T)
  d.note(false, T + 100_000)
  assert.ok(!d.ready(T + 200_000))
})

test("HERDR_SIDEBAR_AUTO_CLOSE=0 disables it entirely", () => {
  const d = autoDismiss(false, GRACE)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(!d.ready(T + 100_000))
})

test("an agent returning after the grace period resets the decision", () => {
  const d = autoDismiss(true, GRACE)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(d.ready(T + 20_000))
  d.note(true, T + 21_000)
  assert.ok(!d.ready(T + 22_000))
})
