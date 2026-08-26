import type { Style } from "../../ansi.js"
import type { SessionInfo } from "./types.js"

const DASH = "—"
const SEP = " | "

/** Lit and unlit sandbox indicators. The glyph differs as well as the colour, so the state */
/** survives a terminal with colour disabled, where two coloured dots would look identical. */
const ON = "●"
const OFF = "○"

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
 * Token counts are read at a glance, not audited, so they are abbreviated. 258400 -> "258K",
 * 1000000 -> "1M": a trailing ".0" carries no information and costs a column.
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
 * A piece of a row's value. `paint` is applied for display only — every width is measured from
 * `text`, because escape sequences occupy no columns and measuring the painted string would
 * push each row out of alignment.
 */
export type Segment = { text: string; paint?: (s: string) => string }

/** A fixed label on the left, the value flush right. */
export function labelled(
  label: string,
  segments: Segment[],
  width: number,
  paintLabel: (s: string) => string = (s) => s,
): string {
  const plain = segments.map((s) => s.text).join("")
  const gap = Math.max(1, width - label.length - plain.length)
  const painted = segments.map((s) => (s.paint ? s.paint(s.text) : s.text)).join("")
  return paintLabel(label) + " ".repeat(gap) + painted
}

/** Joins the halves of a two-part value, collapsing to a dash when neither half is known. */
function twoPart(left: string | null, right: string | null, paintLeft?: (s: string) => string): Segment[] {
  if (left === null && right === null) return [{ text: DASH }]
  if (right === null) return [{ text: left!, paint: paintLeft }]
  if (left === null) return [{ text: DASH, paint: paintLeft }, { text: SEP }, { text: right }]
  return [{ text: left, paint: paintLeft }, { text: SEP }, { text: right }]
}

/**
 * The section: a labelled row per fact, no gauge.
 *
 * The context percentage carries the same colour ramp as quota — both answer "how much of a
 * budget is gone", so a reader who has learned the ramp in one place reads it in the other
 * without relearning.
 */
export function sessionBlock(info: SessionInfo | null, width: number, style: Style): string[] {
  if (!info) return []
  const finish = style.line ?? ((s: string) => s)
  const mark = style.mark ?? ((t: string) => t)
  const asLabel = style.label ?? ((t: string) => t)

  const context = info.context
  const percent = context?.usedPercent ?? null
  const contextSegments = twoPart(
    percent === null ? null : `${Math.round(percent)}%`,
    context?.windowSize == null ? null : abbreviate(context.windowSize),
    (t) => (style.paintContext ?? style.paint)(t, percent),
  )

  // The sandbox state is a lit or unlit dot rather than a policy name: the policies differ per
  // agent — a Codex sandbox_policy, a Grok profile, a Claude boolean — and only the on/off
  // distinction is common to all three and meaningful at this width.
  const sandbox: Segment =
    info.sandboxEnabled === null
      ? { text: DASH }
      : { text: info.sandboxEnabled ? ON : OFF, paint: (t) => mark(t, info.sandboxEnabled === true) }

  return [
    finish(style.bold("SESSION")),
    "",
    finish(labelled("MODEL", twoPart(info.model, info.effort), width, asLabel)),
    finish(labelled("MODE", [sandbox, { text: " " }, { text: info.permissionMode ?? DASH }], width, asLabel)),
    finish(labelled("CONTEXT", contextSegments, width, asLabel)),
    finish(labelled("SPEED", [{ text: info.outputPerSecond === null ? `${DASH} t/s` : `${Math.round(info.outputPerSecond)} t/s` }], width, asLabel)),
  ]
}
