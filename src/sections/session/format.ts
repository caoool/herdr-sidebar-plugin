import type { Style } from "../../ansi.js"
import type { ProjectInfo, SessionInfo } from "./types.js"

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
 * Names run long — "Herdr sidebar plugin validation" is 31 characters against a value column of
 * about 25 — so they are cut with an ellipsis rather than wrapped or allowed to shove the label
 * off the row. The tail is dropped because session titles put their distinguishing words first.
 */
export function truncate(text: string, max: number): string {
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…"
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
function twoPart(
  left: string | null,
  right: string | null,
  paintLeft?: (s: string) => string,
  muted: (s: string) => string = (s) => s,
): Segment[] {
  if (left === null && right === null) return [{ text: DASH, paint: muted }]
  if (right === null) return [{ text: left!, paint: paintLeft }]
  if (left === null) return [{ text: DASH, paint: paintLeft ?? muted }, { text: SEP }, { text: right }]
  return [{ text: left, paint: paintLeft }, { text: SEP }, { text: right }]
}

/**
 * Ahead and behind, in herdr's own shape.
 *
 * Zero counts are omitted rather than shown as "↑0": a branch level with its upstream has
 * nothing to report, and printing zeros would make the common case the loudest one. A branch
 * with no upstream has no divergence to describe at all.
 */
export function divergence(ahead: number | null, behind: number | null): string {
  const parts: string[] = []
  if (ahead) parts.push(`↑${ahead}`)
  if (behind) parts.push(`↓${behind}`)
  return parts.join(" ")
}

/**
 * The section: a labelled row per fact, no gauge.
 *
 * The context percentage carries the same colour ramp as quota — both answer "how much of a
 * budget is gone", so a reader who has learned the ramp in one place reads it in the other
 * without relearning.
 */
export function sessionBlock(
  info: SessionInfo | null,
  project: ProjectInfo | null,
  width: number,
  style: Style,
): string[] {
  if (!info && !project) return []
  const finish = style.line ?? ((s: string) => s)
  const mark = style.mark ?? ((t: string) => t)
  const asLabel = style.label ?? ((t: string) => t)
  const asMuted = style.muted ?? ((t: string) => t)

  const rowFor = (label: string, segments: Segment[]) =>
    finish(labelled(label, segments, width, asLabel))
  /** A value column of roughly this much, once the label and its gap are taken. */
  const valueWidth = Math.max(8, width - 10)
  const text = (v: string | null): Segment[] =>
    v ? [{ text: truncate(v, valueWidth) }] : [{ text: DASH, paint: asMuted }]

  const rows: string[] = []

  if (info) {
    rows.push(rowFor("MODEL", twoPart(info.model, info.effort, undefined, asMuted)))

    // The sandbox state is a lit or unlit dot rather than a policy name: the policies differ
    // per agent — a Codex sandbox_policy, a Grok profile, a Claude boolean — and only the
    // on/off distinction is common to all three and meaningful at this width.
    const sandbox: Segment =
      info.sandboxEnabled === null
        ? { text: DASH, paint: asMuted }
        : { text: info.sandboxEnabled ? ON : OFF, paint: (t) => mark(t, info.sandboxEnabled === true) }
    rows.push(rowFor("MODE", [
      sandbox,
      { text: " " },
      info.permissionMode ? { text: info.permissionMode } : { text: DASH, paint: asMuted },
    ]))

    const percent = info.context?.usedPercent ?? null
    rows.push(rowFor("CONTEXT", twoPart(
      percent === null ? null : `${Math.round(percent)}%`,
      info.context?.windowSize == null ? null : abbreviate(info.context.windowSize),
      (t) => (style.paintContext ?? style.paint)(t, percent),
      asMuted,
    )))

    rows.push(rowFor("SPEED", info.outputPerSecond === null
      ? [{ text: DASH, paint: asMuted }, { text: " t/s" }]
      : [{ text: `${Math.round(info.outputPerSecond)} t/s` }]))
  }

  if (project) {
    // A blank line rather than a second heading: these describe the same pane, and a reader
    // scanning labels does not need to be told the list continues.
    if (rows.length) rows.push("")
    rows.push(rowFor("WORKSPACE", text(project.workspace)))
    rows.push(rowFor("BRANCH", text(project.branch)))
    rows.push(rowFor("WORKTREE", text(project.worktree)))
    rows.push(rowFor("DIFF", text(project.diff || null)))
  }

  // The session's name rides the heading rather than taking a row of its own: it names the
  // block, which is what a heading is for, and the rows below are all facts about it.
  const heading = info?.name
    ? labelled("SESSION", [{ text: truncate(info.name, Math.max(8, width - 9)), paint: asLabel }],
        width, style.bold)
    : style.bold("SESSION")

  return [finish(heading), "", ...rows]
}
