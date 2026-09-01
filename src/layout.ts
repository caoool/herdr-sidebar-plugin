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

export type Region = { lines: string[] }

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
): { lines: string[]; offsets: number[] } {
  const dim = style.muted ?? ((s: string) => s)
  const bold = style.bold ?? ((s: string) => s)

  if (!regions.length) return { lines: pinned.slice(0, height), offsets: [] }

  const totalRegion = regions.reduce((n, r) => n + r.lines.length, 0)
  if (pinned.length + totalRegion <= height) {
    // Everything fits: no dividers, no scrolling, nothing to explain.
    return { lines: [...pinned, ...regions.flatMap((r) => r.lines)], offsets: regions.map(() => 0) }
  }

  // The pinned block yields before the regions do — quota and context are re-read constantly,
  // while the lists are what the reader came to scroll.
  const floor = regions.length * MIN_REGION
  const head = pinned.length + floor <= height ? pinned : pinned.slice(0, Math.max(0, height - floor))

  const caps = allocate(regions.map((r) => r.lines.length), height - head.length)

  const lines: string[] = [...head]
  const settled: number[] = []
  regions.forEach((region, i) => {
    const cap = caps[i]
    if (cap <= 0) { settled.push(0); return }
    const clipped = region.lines.length > cap
    // A clipped region spends its last row on the divider that says so.
    const w = window(region.lines, clipped ? cap - 1 : cap, offsets[i] ?? 0)
    settled.push(w.offset)
    lines.push(...w.lines)
    if (!clipped) return
    const tag = marker(w.above, w.below)
    const rule = "─".repeat(Math.max(0, width - (tag ? displayWidth(tag) + 2 : 0)))
    // The focused region's marker is bright so you can see which one the keys are driving.
    const paint = i === focus ? bold : dim
    lines.push(tag ? dim(rule) + " " + paint(tag) + dim(" ") : dim(rule))
  })

  return { lines, offsets: settled }
}
