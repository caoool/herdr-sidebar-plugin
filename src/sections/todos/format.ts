import { tally, truncate } from "../session/format.js"
import type { Style } from "../../ansi.js"
import { displayWidth } from "../../width.js"
import type { Todo, TodoStatus } from "./types.js"

const DASH = "—"

/**
 * A glyph per state, chosen so the states stay distinguishable without colour — a tick reads as
 * finished, a filled dot as underway, an empty one as waiting, a cross as given up.
 */
const GLYPH: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "●",
  pending: "○",
  failed: "✗",
}

/** Only work that is underway counts as lit; pending and failed are not achievements. */
const isLive = (status: TodoStatus): boolean => status === "in_progress"

/**
 * How many are finished, over how many there are.
 *
 * Not the row count: a list of nine todos three of which are done is a different situation from
 * nine untouched ones, and the glyphs say so only once you have counted them.
 */
export function todosTally(todos: Todo[] | null, width: number, style: Style): string {
  const done = todos?.filter((t) => t.status === "completed").length ?? 0
  return tally("todos", todos && todos.length ? `${done}/${todos.length}` : null, width, style)
}

/**
 * One row per todo, in the agent's own order.
 *
 * The glyph leads rather than trails, unlike the tool and server rows: those end in a figure the
 * eye scans down a column, while a todo's text is the content and its state is a prefix. The text
 * is truncated to whatever the glyph and its space leave.
 */
export function todoItems(todos: Todo[] | null, width: number, style: Style): string[] {
  const label = style.label ?? ((s: string) => s)
  const mark = style.mark
  return (todos ?? []).map((todo) => {
    const glyph = GLYPH[todo.status]
    const painted = mark ? mark(glyph, isLive(todo.status)) : glyph
    const room = Math.max(1, width - displayWidth(glyph) - 1)
    const text = truncate(todo.text, room)
    // Left-aligned after the glyph: a todo's text is prose, and prose read down a ragged right
    // edge is easier than prose pushed against one. The row is padded so its width still matches
    // every other row in the sidebar.
    const used = displayWidth(glyph) + 1 + displayWidth(text)
    return painted + " " + label(text) + " ".repeat(Math.max(0, width - used))
  })
}

