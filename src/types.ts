export type ProviderKind = "claude" | "codex" | "grok"

export type PaneAgent = {
  paneId: string
  tabId: string
  workspaceId: string
  agent: ProviderKind
  sessionId: string | null
  status: string
  focused: boolean
}
