import { test } from "node:test"
import assert from "node:assert/strict"
import { autoDismiss } from "../src/dismiss.js"

const T = 1_000_000

test("closes on the same poll once the agent process is gone", () => {
  const d = autoDismiss(true, 0)
  d.note(true, T)
  assert.ok(!d.ready(T))
  d.note(false, T + 1000)
  assert.ok(d.ready(T + 1000))
})

test("a sidebar opened by hand where no agent has ever run stays put", () => {
  const d = autoDismiss(true, 0)
  d.note(false, T)
  d.note(false, T + 100_000)
  assert.ok(!d.ready(T + 200_000))
})

test("HERDR_SIDEBAR_AUTO_CLOSE=0 disables it entirely", () => {
  const d = autoDismiss(false, 0)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(!d.ready(T + 100_000))
})

test("an agent returning resets the decision", () => {
  const d = autoDismiss(true, 0)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(d.ready(T + 1000))
  d.note(true, T + 1001)
  assert.ok(!d.ready(T + 1001))
})

test("a non-zero grace still waits", () => {
  const d = autoDismiss(true, 12_000)
  d.note(true, T)
  d.note(false, T + 1000)
  assert.ok(!d.ready(T + 1000))
  assert.ok(!d.ready(T + 12_999))
  assert.ok(d.ready(T + 13_000))
})
