import { test } from "node:test"
import assert from "node:assert/strict"
import { keepBest } from "../src/sections/quota/index.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/sections/quota/types.js"

const NOW = 1_800_000_000_000
const at = (s: number) => Math.floor(NOW / 1000) + s

const snap = (percent: number, resetsAt: number | null): QuotaSnapshot => ({
  agent: "codex", sessionId: null, plan: null,
  windows: [{ id: "primary", label: "7d", percent, resetsAt, windowMinutes: 10080, active: true }],
  credits: null, observedAt: NOW, source: "rollout",
})

test("a momentary read failure does not blank a good reading", () => {
  const good = snap(12, at(86400))
  assert.equal(keepBest(good, null, NOW), good)
})

test("stickiness must not resurrect a reading whose window has closed", () => {
  // The regression this guards: expiry correctly discards a stale reading, and remembering
  // would hand it straight back — showing a closed window's figure as current.
  const stale = snap(4, at(-6 * 86400))
  assert.equal(keepBest(stale, null, NOW), null)
})

test("a fresh reading replaces a remembered one", () => {
  const older = snap(4, at(86400))
  const newer = snap(9, at(86400))
  assert.equal(keepBest(older, newer, NOW), newer)
})

test("an expired fresh reading is not preferred over a valid remembered one", () => {
  const good = snap(12, at(86400))
  const expiredNext = snap(99, at(-1))
  assert.equal(keepBest(good, expiredNext, NOW), good)
})

test("nothing anywhere yields nothing", () => {
  assert.equal(keepBest(null, null, NOW), null)
  assert.equal(keepBest(snap(4, at(-1)), snap(5, at(-1)), NOW), null)
})
