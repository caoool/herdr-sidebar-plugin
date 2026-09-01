import { labelled, truncate } from "../session/format.js"
import type { Style } from "../../ansi.js"
import { displayWidth } from "../../width.js"
import type { Subagent, SubagentSnapshot } from "./types.js"

const DASH = "—"
const GLYPH = "◆"

/** The heading: how many subagents this session has in flight. */
export function subagentsHead(running: Subagent[] | null, width: number, style: Style): string[] {
  const muted = style.muted ?? ((s: string) => s)
  return [
    labelled("AGENTS", running && running.length
      ? [{ text: String(running.length) }]
      : [{ text: DASH, paint: muted }], width, style.bold),
    "",
  ]
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

/** Both parts stacked, for callers that do not scroll them separately. */
export function subagentsBlock(
  snapshot: SubagentSnapshot | null,
  width: number,
  style: Style,
): string[] {
  const running = snapshot?.running ?? null
  return [...subagentsHead(running, width, style), ...subagentItems(running, width, style)]
}
