/**
 * The quota model. Two fields are load-bearing and easy to get wrong:
 *
 *  - `percent` is nullable. It is NOT zero when unknown. Substituting 0 is exactly the
 *    bug the old Grok bar exhibits: a unified-billing account returns no
 *    `creditUsagePercent`, the fallback pushed `used: 0`, and the bar rendered a
 *    confident, permanent zero.
 *  - `windows` is variable-length. Claude reports up to four (5h, 7d, and per-model
 *    weeklies), Codex one or two against a window whose duration changes server-side
 *    without notice, Grok a period with no percent at all. Never assume two bars.
 */
export type QuotaWindow = {
  id: string
  /** Derive from the reported window duration where available; never hardcode "5h". */
  label: string
  /** null = the agent did not report a utilisation figure. Render no bar. */
  percent: number | null
  /** Unix seconds. */
  resetsAt: number | null
  /**
   * Window length in minutes, when the agent reports it. Drives how the reset is rendered:
   * a multi-day window shows days remaining, a short one shows a clock time. Codex reports
   * this directly and changes it server-side without notice, which is exactly why the
   * decision is made from duration rather than from a label like "7d".
   */
  windowMinutes: number | null
  active: boolean
}

export type ProviderKind = "claude" | "codex" | "grok"

/** Where a snapshot came from. All four are pull-free except `api`. */
export type QuotaSource = "statusline" | "rollout" | "log" | "api"

export type QuotaSnapshot = {
  agent: ProviderKind
  /** herdr `agent_session.value` — verified equal to the agent's own session id. */
  sessionId: string | null
  plan: string | null
  windows: QuotaWindow[]
  credits: { balance: string | null; unlimited: boolean } | null
  /**
   * When the AGENT observed these numbers, taken from its own timestamp — not when we
   * read the file. A watched file can be arbitrarily old if that agent has been idle,
   * and the UI must be able to say so.
   */
  observedAt: number
  source: QuotaSource
  error?: string
}

export type PaneAgent = {
  paneId: string
  tabId: string
  workspaceId: string
  agent: ProviderKind
  sessionId: string | null
  status: string
  focused: boolean
}
