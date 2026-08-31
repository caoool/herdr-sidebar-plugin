import { labelled, truncate } from "../session/format.js"
import type { Segment } from "../session/format.js"
import type { Style } from "../../ansi.js"
import type { ProviderKind } from "../../types.js"
import type { McpSnapshot, McpStatus, ToolCall } from "./types.js"

const DASH = "—"

/**
 * Glyphs carry the claim, so two agents saying different things cannot look alike by accident.
 * `enabled` reuses the filled dot because for Codex it is the best state available, and the
 * header count beside it is what says how many are in it.
 */
const GLYPH: Record<McpStatus, string> = {
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
  const maxLabel = Math.max(1, width - plain.length - 1)
  return labelled(truncate(name, maxLabel), segments, width, paintLabel)
}

export function toolsBlock(
  calls: ToolCall[],
  mcp: McpSnapshot | null,
  agent: ProviderKind,
  width: number,
  style: Style,
): string[] {
  const muted = style.muted ?? ((s: string) => s)
  const label = style.label ?? ((s: string) => s)
  const out: string[] = []

  const total = calls.reduce((n, c) => n + c.count, 0)
  out.push(labelled("TOOLS", total
    ? [{ text: `${total} calls` }]
    : [{ text: DASH, paint: muted }], width, style.bold))
  out.push("")
  for (const call of calls) {
    out.push(nameRow(call.name, [{ text: String(call.count) }], width, label))
  }

  out.push("")
  const servers = mcp?.servers ?? null
  const healthy = servers?.filter((s) => HEALTHY.includes(s.status)).length ?? 0
  out.push(labelled("MCP", servers && servers.length
    ? [{ text: `${healthy}/${servers.length}` }]
    : [{ text: DASH, paint: muted }], width, style.bold))
  out.push("")
  for (const server of servers ?? []) {
    const on = HEALTHY.includes(server.status)
    const paint = style.mark ? (s: string) => style.mark!(s, on) : undefined
    out.push(nameRow(server.name, [{ text: GLYPH[server.status], paint }], width, label))
  }

  return out
}
