import { labelled, truncate } from "../session/format.js"
import { displayWidth } from "../../width.js"
import type { Segment } from "../session/format.js"
import type { Style } from "../../ansi.js"
import type { ProviderKind } from "../../types.js"
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
 * The TOOLS block: a heading carrying the session's total, then one row per tool.
 *
 * Split from the MCP block because the two scroll independently — a session that has called forty
 * distinct tools must not bury the server list, and a reader scrolling one should not move the
 * other.
 */
export function toolsHead(calls: ToolCall[], width: number, style: Style): string[] {
  const muted = style.muted ?? ((s: string) => s)
  const total = calls.reduce((n, c) => n + c.count, 0)
  return [
    // The bare count, like MCP's. "calls" said what the rows beneath it already say, and cost
    // columns the numbers could use.
    labelled("TOOLS", total ? [{ text: String(total) }] : [{ text: DASH, paint: muted }],
      width, style.bold),
    "",
  ]
}

/** One row per tool, most recently used first. The heading is `toolsHead`. */
export function toolItems(calls: ToolCall[], width: number, style: Style): string[] {
  const label = style.label ?? ((s: string) => s)
  return calls.map((call) => nameRow(call.name, [{ text: String(call.count) }], width, label))
}

export function mcpHead(mcp: McpSnapshot | null, width: number, style: Style): string[] {
  const muted = style.muted ?? ((s: string) => s)
  const servers = mcp?.servers ?? null
  const healthy = servers?.filter((s) => HEALTHY.includes(s.status)).length ?? 0
  return [
    labelled("MCP", servers && servers.length
      ? [{ text: `${healthy}/${servers.length}` }]
      : [{ text: DASH, paint: muted }], width, style.bold),
    "",
  ]
}

/** One row per server, in the order the agent reports them. The heading is `mcpHead`. */
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

/** The TOOLS block whole, for callers that do not scroll its parts separately. */
export function toolsRows(calls: ToolCall[], width: number, style: Style): string[] {
  return [...toolsHead(calls, width, style), ...toolItems(calls, width, style)]
}

/** The MCP block whole, for callers that do not scroll its parts separately. */
export function mcpRows(mcp: McpSnapshot | null, width: number, style: Style): string[] {
  return [...mcpHead(mcp, width, style), ...mcpItems(mcp, width, style)]
}

export function toolsBlock(
  calls: ToolCall[],
  mcp: McpSnapshot | null,
  _agent: ProviderKind,
  width: number,
  style: Style,
): string[] {
  return [...toolsRows(calls, width, style), "", ...mcpRows(mcp, width, style)]
}
