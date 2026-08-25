import { test } from "node:test"
import assert from "node:assert/strict"
import { percentStyle, paintPercent, bold } from "../src/ansi.js"
import { row, block, TERMINAL_STYLE } from "../src/format.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/types.js"

const GREEN = "38;5;41"
const BLUE = "38;5;39"
const ORANGE = "38;5;208"
const RED = "38;5;203"

test("utilisation ramp, including the band edges", () => {
  assert.equal(percentStyle(0), GREEN)
  assert.equal(percentStyle(30), GREEN)
  assert.equal(percentStyle(30.1), BLUE)
  assert.equal(percentStyle(60), BLUE)
  assert.equal(percentStyle(60.5), ORANGE)
  assert.equal(percentStyle(80), ORANGE)
  assert.equal(percentStyle(80.1), RED)
  assert.equal(percentStyle(100), RED)
})

test("bands are contiguous — no fractional value goes unstyled", () => {
  // Codex reports 4.0 and Claude 22.5, so a gap between bands would silently drop styling.
  for (let p = 0; p <= 100; p += 0.5) {
    assert.ok([GREEN, BLUE, ORANGE, RED].includes(percentStyle(p)), `unstyled at ${p}`)
  }
})

test("a missing reading is dimmed, not coloured green", () => {
  // Absence of a figure is not a low figure; green would read as "plenty left".
  assert.equal(percentStyle(null), "2")
})

const win = (over: Partial<QuotaWindow> = {}): QuotaWindow =>
  ({ id: "x", label: "5h", percent: 15, resetsAt: null, windowMinutes: 300, active: true, ...over })

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

test("styling never changes column widths", () => {
  // Escape sequences occupy no columns; measuring the painted string would misalign rows.
  for (const percent of [null, 0, 4, 15, 55, 75, 99]) {
    const plain = row(win({ percent, resetsAt: 1_800_000_000 }), 30)
    const painted = row(win({ percent, resetsAt: 1_800_000_000 }), 30, Date.now(), paintPercent)
    assert.equal(strip(painted), plain, `mismatch at ${percent}`)
  }
})

test("provider names render bold, and the heading width is unaffected", () => {
  const snap: QuotaSnapshot = {
    agent: "claude", sessionId: null, plan: null, windows: [win()],
    credits: null, observedAt: Date.now(), source: "statusline",
  }
  const [heading] = block("claude", snap, 30, Date.now(), TERMINAL_STYLE)
  assert.equal(strip(heading), "CLAUDE")
  assert.notEqual(heading, "CLAUDE")
  assert.equal(strip(bold("CODEX")), "CODEX")
})

test("an empty provider line keeps its width once styling is stripped", () => {
  const [line] = block("codex", null, 30, Date.now(), TERMINAL_STYLE)
  assert.equal(strip(line).length, 30)
})
