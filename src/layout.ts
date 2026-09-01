import { window } from "./viewport.js"
import { displayWidth } from "./width.js"
import type { Style } from "./ansi.js"

/**
 * A region never shrinks below this. A list two rows tall is not a list, and the point of giving
 * TOOLS and MCP separate regions is that neither can push the other off the screen.
 */
export const MIN_REGION = 4

/** Both directions, zeros omitted, so a region scrolled to the top does not claim rows above it. */
function marker(above: number, below: number): string {
  const parts: string[] = []
  if (above > 0) parts.push(`↑${above}`)
  if (below > 0) parts.push(`↓${below}`)
  return parts.join(" ")
}

/**
 * Split rows between regions that each want a different amount.
 *
 * Every region is guaranteed its floor before any region gets a second helping, and the surplus
 * is handed out a row at a time to whoever still wants more. That ordering is what keeps a
 * forty-tool session from burying the MCP list: TOOLS cannot take rows that MCP has not yet been
 * offered.
 */
export function allocate(needs: number[], available: number, min: number = MIN_REGION): number[] {
  const out = needs.map(() => 0)
  if (available <= 0 || !needs.length) return out

  // Floors first, smallest need first so a region wanting less than the floor does not waste rows.
  let left = available
  const order = needs.map((need, i) => ({ need, i })).sort((a, b) => a.need - b.need)
  for (const { need, i } of order) {
    const share = Math.min(need, min, left)
    out[i] = share
    left -= share
  }

  // Then the surplus, one row at a time, so the split stays even rather than first-come.
  let wanting = true
  while (left > 0 && wanting) {
    wanting = false
    for (let i = 0; i < needs.length && left > 0; i++) {
      if (out[i] < needs[i]) {
        out[i] += 1
        left -= 1
        wanting = true
      }
    }
  }
  return out
}

/**
 * One independently scrollable region.
 *
 * `head` never scrolls — a heading that slid away with its list would leave rows of numbers with
 * nothing saying what they count. `body` is the list itself, and `maxBody` caps how much of it is
 * shown at once even when the pane has room to spare, so the sidebar stays compact and both
 * regions keep a predictable size.
 */
export type Region = { head: string[]; body: string[]; maxBody?: number }

/**
 * Where a region ended up on screen, as inclusive indices into the returned lines.
 *
 * The pane needs this to answer "which list is the pointer over?" — a wheel event carries a row,
 * and without a map from rows back to regions the sidebar would have to guess which list to move.
 */
export type Span = { start: number; end: number }

/** Rows a region wants: its head, the capped part of its body, and a divider if that clips. */
function desired(region: Region): number {
  const cap = region.maxBody ?? region.body.length
  const shown = Math.min(region.body.length, cap)
  return region.head.length + shown + (region.body.length > shown ? 1 : 0)
}

/**
 * Lay the pane out: a pinned block that never moves, then one independently scrollable region per
 * entry in `regions`.
 *
 * Each region is rendered into exactly the rows it was allocated. When a region has more content
 * than it was given, its last row becomes a divider carrying `↑n ↓m`, so the region always
 * declares what it is hiding and the total never exceeds the height it was handed. A pane that
 * never draws more rows than it has cannot scroll, which is the point: the whole sidebar staying
 * put is what makes per-region scrolling meaningful.
 */
export function compose(
  pinned: string[],
  regions: Region[],
  height: number,
  width: number,
  offsets: number[],
  focus: number,
  style: Style,
): { lines: string[]; offsets: number[]; spans: Span[] } {
  const dim = style.muted ?? ((s: string) => s)
  const bold = style.bold ?? ((s: string) => s)

  if (!regions.length) return { lines: pinned.slice(0, height), offsets: [], spans: [] }

  const wants = regions.map(desired)
  const total = wants.reduce((a, b) => a + b, 0)

  // The pinned block yields before the regions do — quota and context are re-read constantly,
  // while the lists are what the reader came to scroll.
  const floor = regions.length * MIN_REGION
  const head =
    pinned.length + Math.min(total, floor) <= height
      ? pinned
      : pinned.slice(0, Math.max(0, height - floor))

  const caps = allocate(wants, height - head.length)

  const lines: string[] = [...head]
  const settled: number[] = []
  const spans: Span[] = []
  regions.forEach((region, i) => {
    const cap = caps[i]
    if (cap <= 0) { settled.push(0); spans.push({ start: -1, end: -1 }); return }
    const start = lines.length

    const headRows = region.head.slice(0, cap)
    lines.push(...headRows)
    let room = cap - headRows.length
    if (region.maxBody !== undefined) room = Math.min(room, region.maxBody + 1)
    if (room <= 0) { settled.push(0); spans.push({ start, end: lines.length - 1 }); return }

    const clipped = region.body.length > Math.min(room, region.maxBody ?? room)
    const shown = clipped ? Math.min(room - 1, region.maxBody ?? room - 1) : region.body.length
    const w = window(region.body, Math.max(0, shown), offsets[i] ?? 0)
    settled.push(w.offset)
    lines.push(...w.lines)
    if (!clipped) { spans.push({ start, end: lines.length - 1 }); return }

    // The count alone, flush right like every value in the sidebar. A rule across the pane drew
    // a line between two blocks that already read as separate, and competed with the figures.
    const tag = marker(w.above, w.below)
    // The focused region's marker is bright so you can see which one the keys are driving.
    const paint = i === focus ? bold : dim
    lines.push(tag ? " ".repeat(Math.max(0, width - displayWidth(tag))) + paint(tag) : "")
    spans.push({ start, end: lines.length - 1 })
  })

  return { lines, offsets: settled, spans }
}
