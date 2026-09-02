import { tally, truncate } from "../session/format.js"
import type { Style } from "../../ansi.js"
import { displayWidth } from "../../width.js"
import type { Subagent } from "./types.js"

const DASH = "—"
const GLYPH = "◆"

/** How many subagents are in flight. Same dim title row as tools / mcp / shells. */
export function subagentsTally(running: Subagent[] | null, width: number, style: Style): string {
  const n = running?.length ?? 0
  return tally("subagents", n ? String(n) : null, width, style)
}

/**
 * One row per running subagent.
 *
 * The label is what the agent was asked to do; the kind is the agent's own word for what it
 * spawned. The kind is shown only when there is a label for it to qualify — on its own it would
 * be the row's whole content and say nothing about the work.
 */
export function subagentItems(running: Subagent[] | null, width: number, style: Style): string[] {
  const label = style.label ?? ((s: string) => s)
  const muted = style.muted ?? ((s: string) => s)
  const mark = style.mark
  return (running ?? []).map((sub) => {
    const painted = mark ? mark(GLYPH, true) : GLYPH
    const room = Math.max(1, width - displayWidth(GLYPH) - 1)
    const bare = !sub.label && !sub.kind
    const text = bare ? DASH : truncate(sub.label || sub.kind || "", room)
    const used = displayWidth(GLYPH) + 1 + displayWidth(text)
    const body = bare ? muted(text) : label(text)
    return painted + " " + body + " ".repeat(Math.max(0, width - used))
  })
}

