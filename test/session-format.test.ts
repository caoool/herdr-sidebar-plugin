import { test } from "node:test"
import assert from "node:assert/strict"
import { abbreviate, gauge, pair, contextRow, speedRow, sessionBlock } from "../src/sections/session/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import type { SessionInfo } from "../src/sections/session/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

test("token counts abbreviate without noise", () => {
  assert.equal(abbreviate(258400), "258K")
  assert.equal(abbreviate(1_000_000), "1M")
  assert.equal(abbreviate(500_000), "500K")
  assert.equal(abbreviate(1_500_000), "1.5M")
  assert.equal(abbreviate(940), "940")
})

test("the gauge fills proportionally and stays within its width", () => {
  assert.equal(gauge(0, 10), "░".repeat(10))
  assert.equal(gauge(100, 10), "█".repeat(10))
  assert.equal(gauge(50, 10).length, 10)
  assert.equal(gauge(50, 10), "█████░░░░░")
})

test("a small non-zero reading still shows one filled cell", () => {
  // Flooring would render 1% as completely empty, which reads as "nothing used".
  assert.ok(gauge(1, 20).startsWith("█"))
})

test("an unknown percentage is a dash, never an empty bar", () => {
  assert.ok(!gauge(null, 16).includes("░"))
  assert.match(gauge(null, 16), /^—+ +$/)
})

test("the gauge always occupies its full track, known or not", () => {
  // A short gauge shifted the right-hand label and broke the row's alignment.
  for (const p of [null, 0, 1, 50, 100]) assert.equal(gauge(p, 20).length, 20, `width wrong at ${p}`)
})

test("a context row with an unknown percentage still fills its width", () => {
  assert.equal(contextRow(null, 258_400, 30).length, 30)
})

test("paired values sit flush left and flush right", () => {
  const line = pair("Opus 5", "high", 30)
  assert.ok(line.startsWith("Opus 5"))
  assert.ok(line.endsWith("high"))
  assert.equal(line.length, 30)
})

test("a missing half of a pair keeps the row's shape", () => {
  const line = pair("plan", null, 30)
  assert.ok(line.endsWith("—"))
  assert.equal(line.length, 30)
})

test("the context row carries the window size beside the percentage", () => {
  // 70% of 258K and 70% of 1M leave very different amounts of room.
  const line = contextRow(70, 258_400, 30)
  assert.ok(line.endsWith(" 70% 258K"), line)
  assert.equal(line.length, 30)
  assert.ok(line.includes("█"))
})

test("the context row survives an unknown window", () => {
  const line = contextRow(42, null, 30)
  assert.ok(line.trimEnd().endsWith("42%"))
  assert.equal(line.length, 30)
})

test("speed is right-aligned and dashes when unmeasured", () => {
  assert.equal(speedRow(42.4, 30), "42 t/s".padStart(30))
  assert.equal(speedRow(null, 30), "— t/s".padStart(30))
})

const info: SessionInfo = {
  agent: "codex", sessionId: "s", model: "gpt-5.6-sol", effort: "high",
  permissionMode: "on-request", permissionModeIsGlobal: false, sandbox: "workspace",
  context: { usedPercent: 70, windowSize: 258_400 }, outputPerSecond: 41, observedAt: Date.now(),
}

test("the block is exactly the four specified rows under a heading", () => {
  const lines = sessionBlock(info, 30, PLAIN)
  assert.equal(lines.length, 5)
  assert.equal(lines[0], "SESSION")
  assert.ok(lines[1].startsWith("gpt-5.6-sol") && lines[1].endsWith("high"))
  assert.ok(lines[2].startsWith("on-request") && lines[2].endsWith("workspace"))
  assert.ok(lines[3].includes("█") && lines[3].endsWith("258K"))
  assert.ok(lines[4].endsWith("41 t/s"))
})

test("no session means no block at all, not a block of dashes", () => {
  assert.deepEqual(sessionBlock(null, 30, PLAIN), [])
})

test("styling leaves every row the same width", () => {
  const plain = sessionBlock(info, 30, PLAIN)
  const styled = sessionBlock(info, 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
})
