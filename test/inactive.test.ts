import { test } from "node:test"
import assert from "node:assert/strict"
import { TERMINAL, TERMINAL_INACTIVE } from "../src/ansi.js"
import { agentRow } from "../src/sections/quota/format.js"
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

test("an inactive row is dimmed from its first character", () => {
  const line = agentRow("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  assert.ok(line.startsWith(DIM), `not dimmed: ${JSON.stringify(line)}`)
})

test("an active row dims only its name, leaving the figures at full strength", () => {
  // The provider name says which figures these are; the figures are what is being read.
  const line = agentRow("claude", snap, 30, Date.now(), TERMINAL)
  assert.match(line, /^\x1b\[38;5;250mCLAUDE/, "the provider name is naming text")
  assert.ok(!line.startsWith(DIM))
})

test("dimming never changes the layout", () => {
  const active = strip(agentRow("codex", snap, 30, 1_700_000_000_000, TERMINAL))
  const inactive = strip(agentRow("codex", snap, 30, 1_700_000_000_000, TERMINAL_INACTIVE))
  assert.equal(inactive, active)
})

test("an inactive percentage keeps its band hue at reduced intensity", () => {
  // 44% is blue; dimmed it must still carry the blue code, not fall back to plain dim.
  const line = agentRow("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  assert.match(line, /\x1b\[2;38;5;39m/)
})

test("dim survives past the painted percentage to the end of the row", () => {
  // A bare reset after the percentage would leave the reset time at full strength.
  const line = agentRow("codex", snap, 30, Date.now(), TERMINAL_INACTIVE)
  const afterPercent = line.slice(line.indexOf("%"))
  assert.match(afterPercent, /\x1b\[0m\x1b\[2m/)
})

test("an inactive provider with no reading is dimmed too", () => {
  const line = agentRow("grok", null, 30, Date.now(), TERMINAL_INACTIVE)
  assert.ok(line.startsWith(DIM))
  assert.equal(strip(line).length, 30)
})
