import { tally, truncate } from "../session/format.js"
import type { Style } from "../../ansi.js"
import { displayWidth } from "../../width.js"
import type { Shell, ShellKind } from "./types.js"

const DASH = "—"

/** A shell is a command; a monitor is an eye kept on one. */
const GLYPH: Record<ShellKind, string> = { shell: "$", monitor: "⟳" }

/**
 * How many background jobs are alive, sitting on the list the way `tools` does.
 *
 * The figure is the row count — unlike tools, there is no hidden total — but the dim name is
 * what makes the block readable once headings are gone, and monitors share the list so the
 * title stays `shells` rather than splitting in two.
 */
export function shellsTally(running: Shell[] | null, width: number, style: Style): string {
  const n = running?.length ?? 0
  return tally("shells", n ? String(n) : null, width, style)
}

/**
 * One row per running command, glyph first.
 *
 * Everything listed is alive — no source here reports anything it cannot distinguish from
 * finished — so the rows need no status, and the glyph is free to say what kind of thing it is
 * instead. A command that could not be recovered shows as a dash rather than a guess.
 */
export function shellItems(running: Shell[] | null, width: number, style: Style): string[] {
  const label = style.label ?? ((s: string) => s)
  const muted = style.muted ?? ((s: string) => s)
  const mark = style.mark
  return (running ?? []).map((shell) => {
    const glyph = GLYPH[shell.kind]
    // A monitor is lit: it is the one that keeps running until something stops it.
    const painted = mark ? mark(glyph, shell.kind === "monitor") : glyph
    const room = Math.max(1, width - displayWidth(glyph) - 1)
    const bare = !shell.command
    const text = bare ? DASH : truncate(shell.command, room)
    const used = displayWidth(glyph) + 1 + displayWidth(text)
    const body = bare ? muted(text) : label(text)
    return painted + " " + body + " ".repeat(Math.max(0, width - used))
  })
}

