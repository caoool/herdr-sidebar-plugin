import { test } from "node:test"
import assert from "node:assert/strict"
import { TERMINAL, TERMINAL_INACTIVE } from "../src/ansi.js"
import { block } from "../src/sections/quota/format.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/sections/quota/types.js"

const DIM = "\x1b[2m"
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

const win: QuotaWindow = {
  id: "five_hour", label: "5h", percent: 15,
  resetsAt: 1_800_000_000, windowMinutes: 300, active: true,
}
const snap: QuotaSnapshot = {
  agent: "codex", sessionId: null, plan: null, windows: [win, { ...win, id: "seven_day", label: "7d", percent: 44 }],
  credits: null, observedAt: Date.now(), source: "rollout",
}

test("an inactive block dims its title and every row", () => {
  const lines = block("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  assert.equal(lines.length, 3)
  for (const line of lines) assert.ok(line.startsWith(DIM), `not dimmed: ${JSON.stringify(line)}`)
})

test("an active block dims only its name, leaving the figures at full strength", () => {
  // The provider name says which figures these are; the figures are what is being read.
  const lines = block("claude", snap, 30, Date.now(), TERMINAL)
  assert.ok(lines[0].startsWith(DIM), "the provider name is naming text")
  for (const row of lines.slice(1)) assert.ok(!row.startsWith(DIM), `row dimmed: ${row}`)
})

test("dimming never changes the layout", () => {
  const active = block("codex", snap, 30, 1_700_000_000_000, TERMINAL).map(strip)
  const inactive = block("codex", snap, 30, 1_700_000_000_000, TERMINAL_INACTIVE).map(strip)
  assert.deepEqual(inactive, active)
})

test("an inactive percentage keeps its band hue at reduced intensity", () => {
  // 15% is green; dimmed it must still carry the green code, not fall back to plain dim.
  const [, row] = block("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  assert.match(row, /\x1b\[2;38;5;41m/)
})

test("dim survives past the painted percentage to the end of the row", () => {
  // A bare reset after the percentage would leave the reset time at full strength.
  const [, row] = block("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  const afterPercent = row.slice(row.indexOf("%"))
  assert.match(afterPercent, /\x1b\[0m\x1b\[2m/)
})

test("an inactive provider with no reading is dimmed too", () => {
  const [line] = block("grok", null, 30, Date.now(), TERMINAL_INACTIVE)
  assert.ok(line.startsWith(DIM))
  assert.equal(strip(line).length, 30)
})
