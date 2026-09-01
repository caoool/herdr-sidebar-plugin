import type { ProviderKind } from "../../types.js"

/**
 * A subagent this session started that has not finished.
 *
 * As with SHELLS there is no finished variant: all three agents record a start and an end, so a
 * row here always means the work is still in flight. `kind` is the agent's own word for what it
 * spawned — Grok's `explore`, Claude's `general-purpose` — and is shown only when it says
 * something the label does not.
 */
export type Subagent = { id: string; label: string; kind: string | null }

export type SubagentSnapshot = {
  agent: ProviderKind
  running: Subagent[]
  observedAt: number
}
