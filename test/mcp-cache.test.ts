import { test } from "node:test"
import assert from "node:assert/strict"
import { isFresh, TTL } from "../src/sections/tools/cache.js"
import type { McpSnapshot } from "../src/sections/tools/types.js"

const snap = (at: number): McpSnapshot => ({ agent: "claude", servers: [], observedAt: at })
const NOW = 1_800_000_000_000

test("Claude's reading is trusted for fifteen minutes", () => {
  assert.equal(TTL.claude, 15 * 60_000)
  assert.ok(isFresh(snap(NOW - 14 * 60_000), NOW, "claude"))
  assert.ok(!isFresh(snap(NOW - 16 * 60_000), NOW, "claude"))
})

test("the cheap agents are re-read every minute", () => {
  assert.equal(TTL.codex, 60_000)
  assert.equal(TTL.grok, 60_000)
  assert.ok(!isFresh(snap(NOW - 61_000), NOW, "codex"))
})

test("an expired reading is not fresh — it must render as a dash, never as current", () => {
  // The whole point of the section is that a wrong status is worse than no status.
  assert.ok(!isFresh(snap(NOW - 60 * 60_000), NOW, "claude"))
})

test("a missing reading is not fresh", () => {
  assert.ok(!isFresh(null, NOW, "claude"))
})

test("a reading from the future is not trusted", () => {
  // Clock changes happen; a timestamp ahead of now means the arithmetic cannot be relied on.
  assert.ok(!isFresh(snap(NOW + 60_000), NOW, "claude"))
})
