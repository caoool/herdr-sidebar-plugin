import type { QuotaSnapshot, QuotaWindow } from "./types.js"
import type { ProviderKind } from "../../types.js"
import type { Style } from "../../ansi.js"
import { displayWidth } from "../../width.js"

/** A window of a day or more is reported in days remaining rather than a clock time. */
const MULTI_DAY_MINUTES = 1440

/** Local wall clock, 24h, hours and minutes only. */
export const hhmm = (unix: number): string => {
  const d = new Date(unix * 1000)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * A reset renders one of two ways — `0D` or `HH:MM` — chosen by how long the window is,
 * not by what it is called.
 *
 * A multi-day window always reads as whole days remaining, down to and including `0D` on
 * the final day. A short window reads as a clock time, which is the useful fact when the
 * reset lands today. The choice comes from the reported duration because Codex changes
 * that duration server-side without notice — it was 10080 minutes three weeks ago and
 * 43200 today — so keying off a label like "7d" would silently mis-format the day it moves.
 */
export function resetText(win: QuotaWindow, now: number = Date.now()): string {
  if (win.resetsAt === null) return ""
  const multiDay = win.windowMinutes !== null && win.windowMinutes >= MULTI_DAY_MINUTES
  if (!multiDay) return hhmm(win.resetsAt)
  const days = Math.max(0, Math.floor((win.resetsAt * 1000 - now) / 86_400_000))
  return `${days}D`
}

/**
 * One window, one row: label and percentage on the left, reset right-aligned.
 *
 *   5h   12%              00:10
 *   7d   11%                 6D
 *
 * No gauge — at sidebar widths a bar carries less information than the number beside it.
 * A null percentage renders as an em dash rather than 0: a confident zero is worse than an
 * honest blank, and Grok's unified-billing accounts report no percentage at all.
 */
/**
 * Whether a reset is computed rather than reported.
 *
 * At zero usage Codex returns `resets_at` as exactly now + one window, which drifts with the
 * wall clock and means nothing. Grok also sits at 0% on an unmetered subscription, but its
 * period end is a real date — its own `/usage` prints "Weekly limit: 0%" and "Next reset"
 * together — so suppressing on the percentage alone hides a fact worth showing.
 *
 * The tell is the distance: a fabricated reset lands a full window away almost to the second,
 * which a genuine one effectively never does.
 */
export function isDerivedReset(win: QuotaWindow, now: number = Date.now()): boolean {
  if (win.percent !== 0 || win.resetsAt === null || !win.windowMinutes) return false
  const secondsAway = win.resetsAt - Math.floor(now / 1000)
  return Math.abs(secondsAway - win.windowMinutes * 60) < 90
}

export function row(
  win: QuotaWindow,
  width: number,
  now: number = Date.now(),
  paint: (text: string, percent: number | null) => string = (t) => t,
): string {
  // Right-align the figure in a fixed field so percentages line up on the % across
  // providers — "4%" under "15%" reads as a column only if the digits agree.
  const pct = (win.percent === null ? "—" : `${Math.round(win.percent)}%`).padStart(4)
  const label = win.label.padEnd(3)
  const right = isDerivedReset(win, now) ? "" : resetText(win, now)
  // Padding is computed from PLAIN widths. Escape sequences occupy no columns, so measuring
  // the painted string would push every coloured row out of alignment.
  const gap = Math.max(1, width - displayWidth(label) - 1 - displayWidth(pct) - displayWidth(right))
  const line = `${label} ${paint(pct, win.percent)}` + " ".repeat(gap) + right
  return right ? line : line.trimEnd()
}

const DISPLAY: Record<ProviderKind, string> = { claude: "CLAUDE", codex: "CODEX", grok: "GROK" }

/**
 * One provider's block: a name, then a row per reported window.
 *
 * Quota belongs to an account rather than to a pane, so every provider is shown in every
 * sidebar — the Codex number is the same whether you are looking at it from a Codex pane or
 * a Claude one.
 *
 * A provider with no reading collapses to a single "NAME  —" line rather than vanishing.
 * Disappearing would be ambiguous: it could mean "not installed", "never used", or "the
 * collector is not running", and the last of those is the one worth noticing.
 */
export function block(
  agent: ProviderKind,
  snap: QuotaSnapshot | null,
  width: number,
  now = Date.now(),
  style: Style = { bold: (s) => s, paint: (t) => t },
): string[] {
  const name = DISPLAY[agent]
  const finish = style.line ?? ((s: string) => s)
  // The provider name says which figures these are; the figures are what is being read.
  const heading = (style.label ?? style.bold)(name)
  if (!snap || snap.windows.length === 0) {
    // Gap measured from the plain name, for the same reason as in row().
    const empty = heading + " ".repeat(Math.max(1, width - displayWidth(name) - 1)) + "\u2014"
    return [finish(empty)]
  }
  return [
    finish(heading),
    ...snap.windows.map((w) => finish(row(w, width, now, style.paint))),
  ]
}

