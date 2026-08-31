import type { ProviderKind } from "../../types.js"

export type ToolCall = { name: string; count: number }

/**
 * What a status glyph is allowed to claim.
 *
 * `connected` and `failed` are assertions about a live connection and may only be used by an
 * agent that actually checked. `enabled` and `disabled` are assertions about configuration.
 * Codex can only ever produce the latter pair — see the spec's honesty rules.
 */
export type McpStatus = "connected" | "needs-auth" | "failed" | "pending" | "enabled" | "disabled"

export type McpServer = { name: string; status: McpStatus }

export type McpSnapshot = {
  agent: ProviderKind
  servers: McpServer[]
  observedAt: number
}
