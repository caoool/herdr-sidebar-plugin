import type { McpServer } from "../types.js"

/**
 * Parse `codex mcp list --json`.
 *
 * Codex never connects to its servers when listing them, so `enabled` is the only thing this
 * output can support. Mapping it to `connected` would be a claim the command did not make —
 * see the spec's honesty rules.
 */
export function parseCodexMcp(stdout: string): McpServer[] {
  let parsed: any
  try { parsed = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((s: any) => typeof s?.name === "string")
    .map((s: any): McpServer => ({ name: s.name, status: s.enabled ? "enabled" : "disabled" }))
}
