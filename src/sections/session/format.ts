import type { Style } from "../../ansi.js"
import { displayWidth, truncateToWidth } from "../../width.js"
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
  return truncateToWidth(text, max)
}

/**
 * A piece of a row's value. `paint` is applied for display only — every width is measured from
 * `text`, because escape sequences occupy no columns and measuring the painted string would
 * push each row out of alignment.
 */
export type Segment = { text: string; paint?: (s: string) => string }

/**
 * A fixed label on the left, the value flush right.
 *
 * The row is guaranteed to fit `width` columns. That guarantee lives here rather than at each
 * call site because a single row over budget wraps, and a wrapped row pushes the whole frame
 * past the pane's height — the terminal then scrolls, the sidebar appears to scroll as a whole,
 * and the previous frame's headings linger above the current one. Every caller inherits the fix.
 *
 * When the value cannot fit, the value gives way rather than the label: the label says what the
 * row is, and a row whose label has been eaten says nothing at all. Painting is preserved across
 * the cut, so a truncated value keeps the colour of the segment it came from.
 */
export function labelled(
  label: string,
  segments: Segment[],
  width: number,
  paintLabel: (s: string) => string = (s) => s,
): string {
  const room = Math.max(0, width - displayWidth(label) - 1)

  let budget = room
  const fitted: Segment[] = []
  for (const segment of segments) {
    if (budget <= 0) break
    const w = displayWidth(segment.text)
    if (w <= budget) {
      fitted.push(segment)
      budget -= w
      continue
    }
    const cut = truncateToWidth(segment.text, budget)
    if (cut) fitted.push({ ...segment, text: cut })
    budget = 0
  }

  const plain = fitted.map((s) => s.text).join("")
  const gap = Math.max(1, width - displayWidth(label) - displayWidth(plain))
  const painted = fitted.map((s) => (s.paint ? s.paint(s.text) : s.text)).join("")
  return paintLabel(label) + " ".repeat(gap) + painted
}

/**
 * The first candidate that fits whole, else the last one cut to size.
 *
 * A two-part value must not be cut mid-separator. Truncating "Opus 5 | ultracode" by column
 * leaves "Opus 5 | " — a separator joining nothing — which reads as a rendering bug rather than
 * as a value that did not fit. Dropping the second part outright is the honest cut: the row says
 * less instead of looking broken.
 */
export function best(candidates: Segment[][], budget: number): Segment[] {
  for (const candidate of candidates) {
    if (displayWidth(candidate.map((s) => s.text).join("")) <= budget) return candidate
  }
  return fitSegments(candidates[candidates.length - 1] ?? [], budget)
}

/** As much of `segments` as fits, cutting the segment that straddles the boundary. */
function fitSegments(segments: Segment[], budget: number): Segment[] {
  const fitted: Segment[] = []
  let left = budget
  for (const segment of segments) {
    if (left <= 0) break
    const w = displayWidth(segment.text)
    if (w <= left) { fitted.push(segment); left -= w; continue }
    const cut = truncateToWidth(segment.text, left)
    if (cut) fitted.push({ ...segment, text: cut })
    left = 0
  }
  return fitted
}

/**
 * Two values on one row, the second flush right.
 *
 * Unlike `labelled` neither side names the other: with the row labels gone, both halves are
 * figures, and what a row is saying comes from where it sits rather than from a word. The left
 * side degrades through `leftCandidates` when the row is cramped, the right side never does —
 * it is the shorter of the two and the one a reader scans down a column.
 */
export function spread(
  leftCandidates: Segment[][],
  right: Segment[],
  width: number,
): string {
  const rightPlain = right.map((s) => s.text).join("")
  const left = best(leftCandidates, Math.max(0, width - displayWidth(rightPlain) - 1))
  const leftPlain = left.map((s) => s.text).join("")
  const gap = Math.max(1, width - displayWidth(leftPlain) - displayWidth(rightPlain))
  const paint = (segments: Segment[]) =>
    segments.map((s) => (s.paint ? s.paint(s.text) : s.text)).join("")
  return paint(left) + " ".repeat(gap) + paint(right)
}

/**
 * A list's total, sitting directly on the list it counts.
 *
 * This is what survives of the section headings. It is kept only where the figure says something
 * the rows below do not — total calls, servers healthy of configured, todos done of planned —
 * and never on a list whose figure would just recount the visible rows. Dimmed throughout,
 * because it is context for the list rather than a reading in its own right, and with no blank
 * row under it so it reads as part of the list rather than as a heading over it.
 */
export function tally(name: string, value: string | null, width: number, style: Style): string {
  const dim = style.muted ?? ((s: string) => s)
  return labelled(name, [{ text: value ?? DASH, paint: dim }], width, dim)
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
 * The session's name, riding the very top of the pane.
 *
 * It named the block back when the block had a heading. With the headings gone it names the pane
 * instead, which is the one thing on screen that is not a figure — and the pane needs something
 * that says which session all these numbers belong to.
 */
export function sessionBanner(info: SessionInfo | null, width: number, style: Style): string[] {
  if (!info?.name) return []
  return [style.bold(truncate(info.name, width))]
}

/**
 * The model block: what is answering, how hard, under what rules, and how full it is.
 *
 *   Opus 5 | ultracode    ● on-request
 *   62% | 1M                    41 t/s
 *
 * No row labels. Every value here is self-describing — a percentage against a token count, a
 * rate with its unit — so a word naming the row would cost columns the figures can use. What a
 * row means comes from where it sits, which is why this block is pinned to the foot of the pane
 * and never moves.
 */
export function modelRows(info: SessionInfo | null, width: number, style: Style): string[] {
  if (!info) return []
  const finish = style.line ?? ((s: string) => s)
  const mark = style.mark ?? ((t: string) => t)
  const asMuted = style.muted ?? ((t: string) => t)

  // The sandbox state is a lit or unlit dot rather than a policy name: the policies differ per
  // agent — a Codex sandbox_policy, a Grok profile, a Claude boolean — and only the on/off
  // distinction is common to all three and meaningful at this width.
  const sandbox: Segment =
    info.sandboxEnabled === null
      ? { text: DASH, paint: asMuted }
      : { text: info.sandboxEnabled ? ON : OFF, paint: (t) => mark(t, info.sandboxEnabled === true) }
  const mode: Segment[] = [
    sandbox,
    { text: " " },
    info.permissionMode ? { text: info.permissionMode } : { text: DASH, paint: asMuted },
  ]

  const model: Segment[][] = info.model
    ? info.effort
      ? [[{ text: info.model }, { text: SEP, paint: asMuted }, { text: info.effort }], [{ text: info.model }]]
      : [[{ text: info.model }]]
    : [[{ text: DASH, paint: asMuted }]]

  const percent = info.context?.usedPercent ?? null
  const paintContext = (t: string) => (style.paintContext ?? style.paint)(t, percent)
  const size = info.context?.windowSize == null ? null : abbreviate(info.context.windowSize)
  const used: Segment = percent === null
    ? { text: DASH, paint: asMuted }
    : { text: `${Math.round(percent)}%`, paint: paintContext }
  const context: Segment[][] = size
    ? [[used, { text: SEP, paint: asMuted }, { text: size }], [used]]
    : [[used]]

  const speed: Segment[] = info.outputPerSecond === null
    ? [{ text: DASH, paint: asMuted }, { text: " t/s" }]
    : [{ text: `${Math.round(info.outputPerSecond)} t/s` }]

  return [finish(spread(model, mode, width)), finish(spread(context, speed, width))]
}

/**
 * The workspace block: where this pane is working.
 *
 *   herdr-sidebar-plugin
 *   main/feature-x                ↑2 ↓1
 *
 * The worktree rides the branch behind a slash rather than taking a row of its own: most
 * checkouts are not worktrees, and a row that is a dash more often than not earns no space at
 * the foot of the pane. When the row is cramped the worktree is what gives way — the branch is
 * the half that identifies the work.
 */
export function workspaceRows(project: ProjectInfo | null, width: number, style: Style): string[] {
  if (!project) return []
  const finish = style.line ?? ((s: string) => s)
  const asMuted = style.muted ?? ((t: string) => t)

  const name = project.workspace
    ? truncate(project.workspace, width)
    : asMuted(DASH)

  const branch = project.branch
  const ref: Segment[][] = branch
    ? project.worktree
      ? [[{ text: branch }, { text: "/", paint: asMuted }, { text: project.worktree }], [{ text: branch }]]
      : [[{ text: branch }]]
    : [[{ text: DASH, paint: asMuted }]]

  // Divergence reads as nothing rather than as "↑0 ↓0": a branch level with its upstream has
  // nothing to report, and printing zeros would make the ordinary case the loudest row.
  const diff: Segment[] = project.diff ? [{ text: project.diff }] : []

  return [finish(name), finish(spread(ref, diff, width))]
}
