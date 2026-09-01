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

/**
 * One agent, one row: its name, its utilisation, and when that window resets.
 *
 *   CLAUDE              11%     6D
 *   CODEX                4%     0D
 *   GROK                  —     1D
 *
 * Three columns rather than a block per agent. Quota is account-wide, so all three are always
 * shown — an agent that vanished would be ambiguous between "not installed", "never used" and
 * "the reading failed", and the last is the one worth noticing.
 *
 * No gauge: at sidebar widths a bar carries less information than the number beside it. A null
 * percentage renders as an em dash rather than 0, because a confident zero is worse than an
 * honest blank — Grok's unified-billing accounts report no percentage at all.
 */
const PERCENT_COLUMNS = 4
const RESET_COLUMNS = 5
/** The percentage field, the gap after it, and the reset field. */
const VALUE_COLUMNS = PERCENT_COLUMNS + 2 + RESET_COLUMNS

/**
 * The window an agent is judged by, when it reports more than one.
 *
 * The longest, chosen by its reported duration and never by its label. Claude reports a 5h and a
 * 7d window, Codex a primary and a secondary — and Codex has already moved its secondary from
 * 10080 minutes to 43200 server-side without notice, so keying off the word "7d" would silently
 * pick the wrong row the day it moves again.
 */
export function longestWindow(windows: QuotaWindow[]): QuotaWindow | null {
  if (!windows.length) return null
  return windows.reduce((best, w) => ((w.windowMinutes ?? 0) >= (best.windowMinutes ?? 0) ? w : best))
}

const DISPLAY: Record<ProviderKind, string> = { claude: "CLAUDE", codex: "CODEX", grok: "GROK" }

export function agentRow(
  agent: ProviderKind,
  snap: QuotaSnapshot | null,
  width: number,
  now: number = Date.now(),
  style: Style = { bold: (s) => s, paint: (t) => t },
): string {
  const finish = style.line ?? ((s: string) => s)
  const asLabel = style.label ?? style.bold
  const name = DISPLAY[agent]

  const win = snap ? longestWindow(snap.windows) : null
  const percent = win?.percent ?? null
  const figure = (percent === null ? "\u2014" : `${Math.round(percent)}%`).padStart(PERCENT_COLUMNS)
  // A reset Codex fabricated at zero usage says nothing; it drifts with the wall clock.
  const reset = (win && !isDerivedReset(win, now) ? resetText(win, now) : "").padStart(RESET_COLUMNS)

  // Padding is computed from PLAIN widths. Escape sequences occupy no columns, so measuring the
  // painted string would push every coloured row out of alignment.
  const gap = Math.max(1, width - displayWidth(name) - VALUE_COLUMNS)
  return finish(asLabel(name) + " ".repeat(gap) + style.paint(figure, percent) + "  " + reset)
}
