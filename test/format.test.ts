import { test } from "node:test"
import assert from "node:assert/strict"
import { row, hhmm, resetText, block } from "../src/format.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/types.js"

const at = (h: number, m: number): number => {
  const d = new Date(); d.setHours(h, m, 0, 0); return Math.floor(d.getTime() / 1000)
}
const DAY = 86_400_000
const now = Date.now()

const fiveHour = (over: Partial<QuotaWindow> = {}): QuotaWindow =>
  ({ id: "five_hour", label: "5h", percent: 12, resetsAt: at(0, 10), windowMinutes: 300, active: true, ...over })
const sevenDay = (over: Partial<QuotaWindow> = {}): QuotaWindow =>
  ({ id: "seven_day", label: "7d", percent: 11, resetsAt: Math.floor((now + 6.4 * DAY) / 1000), windowMinutes: 10080, active: true, ...over })

test("24h HH:MM, zero padded", () => {
  assert.equal(hhmm(at(0, 10)), "00:10")
  assert.equal(hhmm(at(21, 5)), "21:05")
})

test("short window shows a clock time", () => {
  assert.equal(resetText(fiveHour(), now), "00:10")
})

test("multi-day window shows whole days remaining", () => {
  assert.equal(resetText(sevenDay(), now), "6D")
})

test("multi-day window reads 0D on its final day, never a clock time", () => {
  const win = sevenDay({ resetsAt: Math.floor((now + 5 * 3600_000) / 1000) })
  assert.equal(resetText(win, now), "0D")
})

test("a reset already past clamps to 0D rather than going negative", () => {
  const win = sevenDay({ resetsAt: Math.floor((now - 2 * DAY) / 1000) })
  assert.equal(resetText(win, now), "0D")
})

test("duration decides the format, not the label", () => {
  // Codex changes window_minutes server-side without notice; a label-keyed formatter would
  // silently mis-render the day it does.
  const relabelled = sevenDay({ label: "primary" })
  assert.equal(resetText(relabelled, now), "6D")
  const shortWindow = fiveHour({ label: "7d", windowMinutes: 300 })
  assert.equal(resetText(shortWindow, now), "00:10")
})

test("no icon, no gauge — reset is bare and right-aligned", () => {
  const line = row(sevenDay(), 30, now)
  assert.ok(line.endsWith("6D"), line)
  assert.doesNotMatch(line, /:/)
  assert.equal(line.length, 30)
  assert.doesNotMatch(line, /[█░🔄]/)
})

test("null percent renders as a dash, never 0%", () => {
  const line = row(fiveHour({ percent: null }), 30, now)
  assert.match(line, /^5h {5}—/)
  assert.doesNotMatch(line, /0%/)
})

test("percentages align on the % regardless of digit count", () => {
  const wide = row(fiveHour({ percent: 100 }), 30, now)
  const mid = row(fiveHour({ percent: 15 }), 30, now)
  const narrow = row(fiveHour({ percent: 4 }), 30, now)
  assert.equal(wide.indexOf("%"), mid.indexOf("%"))
  assert.equal(mid.indexOf("%"), narrow.indexOf("%"))
})

test("suppresses the reset when percent is 0 and leaves no trailing space", () => {
  const line = row(fiveHour({ percent: 0 }), 30, now)
  assert.equal(line, "5h    0%")
})

test("keeps at least one space when the row is cramped", () => {
  assert.ok(row(sevenDay(), 8, now).includes(" "))
})

const snap = (windows: QuotaWindow[]): QuotaSnapshot => ({
  agent: "codex", sessionId: null, plan: null, windows, credits: null,
  observedAt: now, source: "rollout",
})

test("a provider block is its name then one row per window", () => {
  const lines = block("claude", snap([fiveHour(), sevenDay()]), 30, now)
  assert.equal(lines[0], "CLAUDE")
  assert.equal(lines.length, 3)
  assert.ok(lines[1].startsWith("5h"))
  assert.ok(lines[2].endsWith("6D"))
})

test("a provider with no reading collapses to one line, not to nothing", () => {
  // Vanishing would be ambiguous — "not installed" and "collector stopped" would look alike.
  const lines = block("codex", null, 30, now)
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith("CODEX"))
  assert.ok(lines[0].endsWith("\u2014"))
  assert.equal(lines[0].length, 30)
})

test("a reading with zero windows also collapses", () => {
  const lines = block("grok", snap([]), 30, now)
  assert.equal(lines.length, 1)
})
