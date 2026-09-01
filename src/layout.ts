import { window } from "./viewport.js"
import { displayWidth } from "./width.js"
import type { Style } from "./ansi.js"

/**
 * A block of rows the pane draws as a unit.
 *
 * `head` never scrolls: the dim total row that names a list would say nothing if it slid away
 * from the list it counts. `body` is the list itself, and `cap` bounds how much of it is shown
 * at once even when the pane has room to spare — a session that has called forty tools must not
 * push the model and workspace rows off the bottom.
 *
 * The cap counts items, not rows. A capped list that has more shows `cap` of them and spends one
 * further row on the overflow marker, so raising the cap by one always shows one more item.
 */
export type Region = { head: string[]; body: string[]; cap?: number }

/**
 * Where a region ended up on screen, as inclusive indices into the returned lines.
 *
 * The pane needs this to answer "which list is the pointer over?" — a wheel event carries a row,
 * and without a map from rows back to regions the sidebar would have to guess which list to move.
 * A region that did not make it onto the screen is reported as `{ start: -1, end: -1 }` so the
 * indices still line up with the offsets the caller stores.
 */
export type Span = { start: number; end: number }

/**
 * The pane's shape.
 *
 * Three bands rather than an even split. `banner` and `top` sit against the top of the pane and
 * `bottom` against its foot, so the readings glanced at most — quota at the top, context and
 * branch at the foot — are always in the same place. `flex` takes everything left between them
 * and is the only band whose height depends on the terminal.
 *
 * The bands are ordered by what may be sacrificed. A pane too short for all of it drops whole
 * regions off the front of `bottom` — whole, because trimming one by rows strands its overflow
 * marker, a row claiming to hide items from a list no longer on screen.
 */
export type Frame = {
  banner: string[]
  top: Region[]
  flex: Region | null
  bottom: Region[]
}

/**
 * Rows the flexible region keeps before a pinned block below it keeps its own.
 *
 * Without this a capped list holds its three rows while the section that is supposed to expand is
 * squeezed to nothing — the exact inversion of what makes it the flexible one.
 */
export const FLEX_FLOOR = 4

/** Both directions, zeros omitted, so a region scrolled to the top does not claim rows above it. */
function marker(above: number, below: number, width: number, dim: (s: string) => string): string {
  const parts: string[] = []
  if (above > 0) parts.push(`↑${above}`)
  if (below > 0) parts.push(`↓${below}`)
  const tag = parts.join(" ")
  // The count alone, flush right like every other value in the sidebar.
  return tag ? " ".repeat(Math.max(0, width - displayWidth(tag))) + dim(tag) : ""
}

/** Rows a region wants: its head, the capped part of its body, and a marker if that clips. */
export function natural(region: Region): number {
  const cap = region.cap ?? region.body.length
  const shown = Math.min(region.body.length, cap)
  return region.head.length + shown + (region.body.length > shown ? 1 : 0)
}

/** Whether a region has anything to draw. An empty one must not cost a separator row. */
export const live = (region: Region): boolean => region.head.length > 0 || region.body.length > 0

/**
 * Render one region into exactly the rows it was given, never more.
 *
 * A pane that never draws more rows than it has cannot scroll, which is the point: the sidebar as
 * a whole stays put, and the only thing that moves is the list the pointer is over.
 */
function draw(
  region: Region,
  rows: number,
  offset: number,
  width: number,
  dim: (s: string) => string,
): { lines: string[]; offset: number } {
  if (rows <= 0) return { lines: [], offset: 0 }
  const head = region.head.slice(0, rows)
  const room = rows - head.length
  if (room <= 0) return { lines: head, offset: 0 }

  const cap = region.cap ?? region.body.length
  const clipped = region.body.length > Math.min(cap, room)
  const shown = clipped ? Math.min(cap, room - 1) : region.body.length
  const w = window(region.body, Math.max(0, shown), offset)

  const lines = [...head, ...w.lines]
  if (clipped) lines.push(marker(w.above, w.below, width, dim))
  return { lines, offset: w.offset }
}

/**
 * Lay the pane out.
 *
 * Regions are separated by a single blank row and never by a rule: without section headings the
 * blank is the only structure the pane has, and a rule across a 34-column pane drew a line
 * between two blocks that already read as separate while competing with the figures.
 *
 * `offsets` is indexed in visual order — top regions, then the flexible one, then the bottom
 * regions — and the clamped offsets are returned for the caller to store, because the lists
 * change underneath them: a server disconnects, a tool is called for the first time, the terminal
 * is resized.
 */
export function compose(
  frame: Frame,
  height: number,
  width: number,
  offsets: number[],
  style: Style,
): { lines: string[]; offsets: number[]; spans: Span[] } {
  const dim = style.muted ?? ((s: string) => s)

  const flexIndex = frame.flex ? frame.top.length : -1
  const count = frame.top.length + (frame.flex ? 1 : 0) + frame.bottom.length
  const settled: number[] = new Array(count).fill(0)
  const spans: Span[] = Array.from({ length: count }, () => ({ start: -1, end: -1 }))

  if (height <= 0) return { lines: [], offsets: settled, spans }

  /* --- the top band: the banner, then each top region at its natural height --- */
  const topLines: string[] = [...frame.banner]
  frame.top.forEach((region, i) => {
    if (topLines.length) topLines.push("")
    const start = topLines.length
    const drawn = draw(region, natural(region), offsets[i] ?? 0, width, dim)
    settled[i] = drawn.offset
    topLines.push(...drawn.lines)
    spans[i] = { start, end: topLines.length - 1 }
  })

  /* --- the bottom band, as whole groups so a dropped one takes its marker with it --- */
  const base = frame.top.length + (frame.flex ? 1 : 0)
  let groups = frame.bottom.map((region, k) => {
    const index = base + k
    const drawn = draw(region, natural(region), offsets[index] ?? 0, width, dim)
    return { index, lines: ["", ...drawn.lines], offset: drawn.offset }
  })

  const floor = frame.flex && live(frame.flex) ? FLEX_FLOOR : 0
  const bottomHeight = () => groups.reduce((n, g) => n + g.lines.length, 0)
  // The last group is the workspace block, which is the last thing to go.
  while (groups.length > 1 && topLines.length + bottomHeight() + floor > height) {
    groups = groups.slice(1)
  }

  // Still too tall: the top band gives way from its foot, so the banner and quota survive.
  let room = height - topLines.length - bottomHeight()
  if (room < 0) {
    topLines.length = Math.max(0, topLines.length + room)
    room = Math.max(0, height - topLines.length - bottomHeight())
  }

  /* --- the flexible band takes what is left --- */
  const midLines: string[] = []
  if (frame.flex && live(frame.flex) && room > 0) {
    if (topLines.length) midLines.push("")
    const drawn = draw(frame.flex, room - midLines.length, offsets[flexIndex] ?? 0, width, dim)
    settled[flexIndex] = drawn.offset
    const start = topLines.length + midLines.length
    midLines.push(...drawn.lines)
    spans[flexIndex] = { start, end: topLines.length + midLines.length - 1 }
  }

  /* --- slack shows as blank, pushing the bottom band to the foot of the pane ---
     Only when there is a bottom band: with nothing to anchor, padding would emit a screenful
     of blank rows for no reason. */
  const filler = groups.length
    ? Math.max(0, height - topLines.length - midLines.length - bottomHeight())
    : 0
  const foot = topLines.length + midLines.length + filler

  const bottomLines: string[] = []
  for (const group of groups) {
    // The group's first row is its separating blank; the region itself starts after it.
    const start = foot + bottomLines.length + 1
    bottomLines.push(...group.lines)
    settled[group.index] = group.offset
    spans[group.index] = { start, end: foot + bottomLines.length - 1 }
  }

  const lines = [...topLines, ...midLines, ...new Array(filler).fill(""), ...bottomLines]
    .slice(0, height)

  // A span must never name a row that is not on screen: the wheel would move a list the reader
  // cannot see.
  const clamped = spans.map((s) => {
    if (s.start < 0) return s
    const start = Math.max(0, s.start)
    const end = Math.min(lines.length - 1, s.end)
    return end >= start ? { start, end } : { start: -1, end: -1 }
  })

  return { lines, offsets: settled, spans: clamped }
}
