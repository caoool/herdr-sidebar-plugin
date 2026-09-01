import { test } from "node:test"
import assert from "node:assert/strict"
import { agentRow, hhmm, resetText, longestWindow, isDerivedReset } from "../src/sections/quota/format.js"
import type { QuotaSnapshot, QuotaWindow } from "../src/sections/quota/types.js"

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

const snap = (windows: QuotaWindow[]): QuotaSnapshot => ({
  agent: "codex", sessionId: null, plan: null, windows, credits: null,
  observedAt: now, source: "rollout",
})
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

test("the longest window is chosen by duration, never by label", () => {
  // Codex has already moved its long window from 10080 to 43200 minutes server-side; a
  // label-keyed choice would silently pick the wrong row the day it moves again.
  const short = fiveHour()
  const long = sevenDay({ label: "primary" })
  assert.equal(longestWindow([short, long])?.id, "seven_day")
  assert.equal(longestWindow([long, short])?.id, "seven_day")
  assert.equal(longestWindow([]), null)
})

test("an agent with one window uses it, whatever its duration", () => {
  assert.equal(longestWindow([fiveHour()])?.id, "five_hour")
})

test("one row per agent: name, utilisation, reset", () => {
  const line = strip(agentRow("claude", snap([fiveHour(), sevenDay()]), 30, now))
  assert.ok(line.startsWith("CLAUDE"), line)
  assert.ok(line.endsWith("6D"), "the long window's reset, not the short one's")
  assert.match(line, /11%/, "the long window's percentage")
  assert.doesNotMatch(line, /12%/, "the short window is not shown")
  assert.equal(line.length, 30)
})

test("no icon, no gauge", () => {
  const line = strip(agentRow("claude", snap([sevenDay()]), 30, now))
  assert.doesNotMatch(line, /[█░🔄]/)
})

test("null percent renders as a dash, never 0%", () => {
  const line = strip(agentRow("grok", snap([sevenDay({ percent: null })]), 30, now))
  assert.match(line, /—/)
  assert.doesNotMatch(line, /0%/)
})

test("an agent with no reading still takes its row", () => {
  // Vanishing would be ambiguous — "not installed" and "collector stopped" would look alike.
  const line = strip(agentRow("codex", null, 30, now))
  assert.ok(line.startsWith("CODEX"))
  assert.match(line, /—/)
  assert.equal(line.length, 30)
})

test("a reading with zero windows reads the same as no reading", () => {
  assert.equal(strip(agentRow("grok", snap([]), 30, now)), strip(agentRow("grok", null, 30, now)))
})

test("percentages and resets align in columns across agents", () => {
  const rows = [
    strip(agentRow("claude", snap([sevenDay({ percent: 100 })]), 30, now)),
    strip(agentRow("codex", snap([sevenDay({ percent: 4 })]), 30, now)),
    strip(agentRow("grok", snap([sevenDay({ percent: null })]), 30, now)),
  ]
  const figureEnds = rows.map((r) => r.search(/\S+\s+\S+$/) >= 0 ? r.length : -1)
  assert.ok(figureEnds.every((n) => n === 30), "every row is exactly the width")
  // The reset column is the last five, the percentage the four before the two-space gap.
  for (const r of rows) assert.equal(r.slice(-5), "   6D")
  assert.equal(rows[0].slice(-11, -7), "100%")
  assert.equal(rows[1].slice(-11, -7), "  4%")
  assert.equal(rows[2].slice(-11, -7), "   —")
})

test("suppresses a reset that is exactly one window away at 0% — Codex fabricates it", () => {
  const win = fiveHour({ percent: 0, resetsAt: Math.floor(now / 1000) + 300 * 60 })
  assert.ok(isDerivedReset(win, now))
  const line = strip(agentRow("codex", snap([win]), 30, now))
  assert.equal(line.trimEnd(), "CODEX" + " ".repeat(16) + "0%", "the figure stands, the reset does not")
  assert.equal(line.length, 30, "the row keeps its width, the reset column merely blank")
})

test("keeps a real reset at 0% — Grok is unmetered, not unknown", () => {
  // Grok's own /usage prints "Weekly limit: 0%" and "Next reset" together.
  const win = sevenDay({ percent: 0, resetsAt: Math.floor((now + 1.4 * DAY) / 1000) })
  assert.ok(!isDerivedReset(win, now))
  assert.ok(strip(agentRow("grok", snap([win]), 30, now)).endsWith("1D"))
})

test("keeps at least one space when the row is cramped", () => {
  assert.ok(strip(agentRow("claude", snap([sevenDay()]), 8, now)).includes(" "))
})
