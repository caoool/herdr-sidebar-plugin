import { test } from "node:test"
import assert from "node:assert/strict"
import { sanitize, isExpired } from "../src/sections/quota/freshness.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/sections/quota/types.js"

const NOW = 1_800_000_000_000
const at = (offsetSeconds: number) => Math.floor(NOW / 1000) + offsetSeconds

const win = (id: string, resetsAt: number | null): QuotaWindow =>
  ({ id, label: "7d", percent: 4, resetsAt, windowMinutes: 10080, active: true })

const snap = (windows: QuotaWindow[]): QuotaSnapshot => ({
  agent: "codex", sessionId: null, plan: null, windows,
  credits: null, observedAt: NOW, source: "rollout",
})

test("drops only the expired window, keeping its siblings", () => {
  const out = sanitize(snap([win("primary", at(-1)), win("secondary", at(86400))]), NOW)
  assert.equal(out?.windows.length, 1)
  assert.equal(out?.windows[0].id, "secondary")
})

test("a snapshot whose every window has expired becomes no reading at all", () => {
  assert.equal(sanitize(snap([win("primary", at(-1))]), NOW), null)
})

test("an old but still-open window is kept", () => {
  // Usage only rises, so an in-window figure understates rather than fabricates.
  const out = sanitize(snap([win("primary", at(3600))]), NOW)
  assert.equal(out?.windows.length, 1)
})

test("a window with no reset time is kept — nothing is known against it", () => {
  assert.equal(sanitize(snap([win("primary", null)]), NOW)?.windows.length, 1)
  assert.ok(!isExpired(win("primary", null), NOW))
})

test("the snapshot object is returned untouched when nothing is dropped", () => {
  const s = snap([win("primary", at(600))])
  assert.equal(sanitize(s, NOW), s)
})

test("null in, null out", () => {
  assert.equal(sanitize(null, NOW), null)
})
