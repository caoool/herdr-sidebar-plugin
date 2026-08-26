import type { ProviderKind } from "../../types.js"

/**
 * What the pane's own agent is doing right now.
 *
 * Unlike quota, every field here belongs to *this session*: the model it was started with, the
 * effort it is reasoning at, how full its context is. A value that is only known machine-wide
 * is therefore a weaker claim, and `permissionModeIsGlobal` marks it so the renderer can avoid
 * presenting a config default as though it were live state.
 */
export type SessionInfo = {
  agent: ProviderKind
  sessionId: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  /** True when permissionMode came from machine-wide config rather than the running session. */
  permissionModeIsGlobal: boolean
  /**
   * Whether the agent is sandboxed at all. The agents describe sandboxing differently — a
   * Codex sandbox_policy, a Grok profile name, a Claude boolean — and only on/off is common
   * to all three, so the distinction each one draws internally is deliberately flattened here.
   */
  sandboxEnabled: boolean | null
  context: ContextUsage | null
  /** Output tokens per second of the most recent response, or null until one is observed. */
  outputPerSecond: number | null
  observedAt: number
}

export type ContextUsage = {
  /** 0-100. Null when the agent reports tokens but not a window to measure them against. */
  usedPercent: number | null
  /** Total context window in tokens, for the "of 258K" half of the label. */
  windowSize: number | null
}
