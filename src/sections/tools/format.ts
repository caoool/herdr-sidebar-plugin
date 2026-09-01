import { labelled, tally, truncate } from "../session/format.js"
import { displayWidth } from "../../width.js"
import type { Segment } from "../session/format.js"
import type { Style } from "../../ansi.js"
import type { McpSnapshot, McpStatus, ToolCall } from "./types.js"

const DASH = "—"

/**
 * Glyphs carry the claim, so two agents saying different things cannot look alike by accident.
 * `enabled` reuses the filled dot because for Codex it is the best state available, and the
 * header count beside it is what says how many are in it.
 *
 * `unverified` has no entry: it claims nothing checkable, so it is rendered as the dim dash
 * used for every other unknown value (see the loop below), never a glyph of its own.
 */
const GLYPH: Record<Exclude<McpStatus, "unverified">, string> = {
  connected: "●",
  "needs-auth": "◐",
  failed: "✗",
  pending: "⏸",
  enabled: "●",
  disabled: "○",
}

/** The states worth counting in the header, per what the agent is able to know. */
const HEALTHY: McpStatus[] = ["connected", "enabled"]

/**
 * A labelled row whose label is a tool or server name — arbitrary length, unlike the section's
 * fixed headings. `labelled`'s gap floors at 1, so an unbounded label can push the row past
 * `width` (a namespaced tool like `playwright:browser_take_screenshot`, or a qualified server
 * like `plugin:chrome-devtools-mcp:chrome-devtools`, both do this in practice). The label is
 * truncated to whatever room the value and a one-column gap leave, because the count or status
 * glyph is the information the row exists to show, and the name is what gives way.
 */
function nameRow(
  name: string,
  segments: Segment[],
  width: number,
  paintLabel: (s: string) => string,
): string {
  const plain = segments.map((s) => s.text).join("")
  const maxLabel = Math.max(1, width - displayWidth(plain) - 1)
  return labelled(truncate(name, maxLabel), segments, width, paintLabel)
}

/**
 * The total number of calls this session has made, sitting on the list of what it called.
 *
 * Worth keeping where the section heading was, because it is not the row count: a session with
 * four distinct tools may have called them eight hundred times, and that figure is the one the
 * rows cannot show.
 */
export function toolsTally(calls: ToolCall[], width: number, style: Style): string {
  const total = calls.reduce((n, c) => n + c.count, 0)
  return tally("tools", total ? String(total) : null, width, style)
}

/** One row per tool, most recently used first. */
export function toolItems(calls: ToolCall[], width: number, style: Style): string[] {
  const label = style.label ?? ((s: string) => s)
  return calls.map((call) => nameRow(call.name, [{ text: String(call.count) }], width, label))
}

/**
 * Servers reachable, over servers configured.
 *
 * Also not a row count: a list of six servers of which one has failed and one needs auth reads
 * very differently from six healthy ones, and the glyphs say which is which only once you have
 * counted them.
 */
export function mcpTally(mcp: McpSnapshot | null, width: number, style: Style): string {
  const servers = mcp?.servers ?? null
  const healthy = servers?.filter((s) => HEALTHY.includes(s.status)).length ?? 0
  return tally("mcp", servers && servers.length ? `${healthy}/${servers.length}` : null, width, style)
}

/** One row per server, in the order the agent reports them. */
export function mcpItems(mcp: McpSnapshot | null, width: number, style: Style): string[] {
  const muted = style.muted ?? ((s: string) => s)
  const label = style.label ?? ((s: string) => s)
  return (mcp?.servers ?? []).map((server) => {
    // `unverified` earns no glyph on purpose: the line parsed but its status word did not, and a
    // glyph would assert a state nothing checked.
    const segment: Segment = server.status === "unverified"
      ? { text: DASH, paint: muted }
      : { text: GLYPH[server.status], paint: style.mark
          ? (s: string) => style.mark!(s, HEALTHY.includes(server.status))
          : undefined }
    return nameRow(server.name, [segment], width, label)
  })
}
