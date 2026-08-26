import type { Style } from "../../ansi.js"
import type { SessionInfo } from "./types.js"

const DASH = "—"

/** Widest the reset/size column may be, so the gauge gets everything left over. */
const GAUGE_MIN = 8

/**
 * Token counts are read at a glance, not audited, so they are abbreviated. 258400 -> "258K",
 * 1000000 -> "1M": a trailing ".0" carries no information and costs a column the gauge wants.
 */
export function abbreviate(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 || Number.isInteger(m) ? Math.round(m) : m.toFixed(1)}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

/**
 * Model names as the vendor labels them, minus the parenthetical asides.
 *
 * Claude reports "Opus 5 (1M context) (default)": the context variant and the default marker
 * describe the account's configuration rather than which model is answering, and at sidebar
 * widths they crowd out the name itself. Codex and Grok report bare ids, so this is a no-op
 * for them — it strips a shape, not a vendor-specific string.
 */
export function cleanModelName(name: string | null): string | null {
  if (!name) return null
  const stripped = name.replace(/\s*\([^)]*\)/g, "").trim()
  return stripped || name.trim()
}

/**
 * Solid-to-empty bar. Rounds rather than floors so a non-zero reading is never a blank bar.
 *
 * Always returns exactly `width` characters, including when the reading is unknown: the row's
 * right-hand label is positioned from this length, and a short gauge pulled the whole line out
 * of alignment. Unknown is drawn as a few dashes rather than an empty track, which would read
 * as zero.
 */
export function gauge(percent: number | null, width: number): string {
  if (percent === null) return DASH.repeat(Math.min(width, 3)).padEnd(width)
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.min(width, Math.max(clamped > 0 ? 1 : 0, Math.round((clamped / 100) * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/**
 * Two values on one line, one flush left and one flush right.
 *
 * Both may be missing, and an em dash is used rather than an empty cell so the row keeps its
 * shape and the reader can see that the field exists but is unknown.
 */
export function pair(left: string | null, right: string | null, width: number): string {
  const l = left ?? DASH
  const r = right ?? DASH
  const gap = Math.max(1, width - l.length - r.length)
  return l + " ".repeat(gap) + r
}

/**
 * The context row: a gauge, then the percentage and the window it is measured against.
 *
 *   ████████████░░░░  70% 258K
 *
 * The window size is worth the columns it costs: 70% of a 258K window and 70% of a 1M window
 * are very different amounts of remaining room, and the percentage alone hides that.
 */
export function contextRow(
  usedPercent: number | null,
  windowSize: number | null,
  width: number,
): string {
  const pct = usedPercent === null ? DASH : `${Math.round(usedPercent)}%`
  const size = windowSize === null ? "" : ` ${abbreviate(windowSize)}`
  const label = `${pct.padStart(4)}${size}`
  const bar = Math.max(GAUGE_MIN, width - label.length - 1)
  return `${gauge(usedPercent, bar)} ${label}`
}

/** Rate row, right-aligned to sit under the context label rather than float mid-line. */
export function speedRow(perSecond: number | null, width: number): string {
  const text = perSecond === null ? `${DASH} t/s` : `${Math.round(perSecond)} t/s`
  return text.padStart(width)
}

/**
 * The section. Renders only for the agent in this pane, so there is no dimmed variant — an
 * empty result means there is no session to describe and the pane omits the block entirely.
 */
export function sessionBlock(info: SessionInfo | null, width: number, style: Style): string[] {
  if (!info) return []
  const finish = style.line ?? ((s: string) => s)
  return [
    finish(style.bold("SESSION")),
    "",
    finish(pair(info.model, info.effort, width)),
    finish(pair(info.permissionMode, info.sandbox, width)),
    finish(contextRow(info.context?.usedPercent ?? null, info.context?.windowSize ?? null, width)),
    finish(speedRow(info.outputPerSecond, width)),
  ]
}
