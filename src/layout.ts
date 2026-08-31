import { window } from "./viewport.js"
import type { Style } from "./ansi.js"

/**
 * The scroll region never shrinks below this. A list one row tall is not a list, and the pinned
 * sections are the part that can survive being cut — quota and context are re-read every few
 * seconds, while the tool list is the thing you scrolled here to read.
 */
export const MIN_SCROLL = 5

/** Both directions, zeros omitted, so a divider at the top does not claim rows above it. */
function marker(above: number, below: number): string {
  const parts: string[] = []
  if (above > 0) parts.push(`↑${above}`)
  if (below > 0) parts.push(`↓${below}`)
  return parts.join(" ")
}

/**
 * Split the pane into a pinned block and a scroll region.
 *
 * Pinned sections render whole and stay put; the rest of the height belongs to the scrollable
 * one. The divider appears only when there is something hidden, so a sidebar that fits shows no
 * chrome at all.
 */
export function compose(
  pinned: string[],
  scroll: string[],
  height: number,
  width: number,
  offset: number,
  style: Style,
): { lines: string[]; offset: number } {
  if (!scroll.length) return { lines: pinned.slice(0, height), offset: 0 }

  const fits = pinned.length + scroll.length <= height
  if (fits) return { lines: [...pinned, ...scroll], offset: 0 }

  // One row goes to the divider once we know there is something to hide.
  let room = height - pinned.length - 1
  let head = pinned
  if (room < MIN_SCROLL) {
    head = pinned.slice(0, Math.max(0, height - MIN_SCROLL - 1))
    room = Math.max(0, height - head.length - 1)
  }

  const w = window(scroll, room, offset)
  const tag = marker(w.above, w.below)
  const rule = "─".repeat(Math.max(0, width - (tag ? tag.length + 2 : 0)))
  const dim = style.muted ?? ((s: string) => s)
  const divider = tag ? dim(rule) + " " + dim(tag) + dim(" ") : dim(rule)

  return { lines: [...head, divider, ...w.lines], offset: w.offset }
}
