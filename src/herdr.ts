import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { PaneAgent, ProviderKind } from "./types.js"

const run = promisify(execFile)

/**
 * IMPORTANT: `HERDR_PANE_ID` means two different things depending on who is reading it.
 *
 *  - In a PANE process (this file's caller) it is our own pane id.
 *      src/pane.rs — PaneLaunchIdentity::Managed sets it to the launched pane.
 *  - In an ACTION or EVENT HOOK command it is the *event target* / focused pane.
 *      src/app/api/plugins/runtime.rs — filled from context.focused_pane_id.
 *
 * Reading it as "self" inside a hook is a real bug. Only call selfPaneId() from the pane.
 */
export const selfPaneId = (): string | null => process.env.HERDR_PANE_ID ?? null
export const selfTabId = (): string | null => process.env.HERDR_TAB_ID ?? null
export const herdrBin = (): string => process.env.HERDR_BIN_PATH ?? "herdr"
export const stateDir = (): string =>
  process.env.HERDR_PLUGIN_STATE_DIR ?? `${process.env.HOME}/.local/state/herdr/plugins/caoool.quota-sidebar`

const KINDS: ProviderKind[] = ["claude", "codex", "grok"]
const asKind = (v: unknown): ProviderKind | null =>
  typeof v === "string" && (KINDS as string[]).includes(v) ? (v as ProviderKind) : null

/**
 * `session.snapshot.agents[]` is already filtered by herdr to real agent panes — a plugin
 * pane has `agent: null` and never appears here. That is the primitive that defeats the
 * self-focus trap, so we read agents[] rather than inspecting focus directly.
 */
export async function listAgents(): Promise<PaneAgent[]> {
  const { stdout } = await run(herdrBin(), ["api", "snapshot"], { maxBuffer: 8 << 20 })
  const snap = JSON.parse(stdout)?.result?.snapshot
  if (!snap?.agents) return []
  return (snap.agents as Record<string, any>[]).flatMap((a) => {
    const agent = asKind(a.agent)
    if (!agent) return []
    return [{
      paneId: a.pane_id,
      tabId: a.tab_id,
      workspaceId: a.workspace_id,
      agent,
      sessionId: a.agent_session?.value ?? null,
      status: a.agent_status ?? "unknown",
      focused: Boolean(a.focused),
    }]
  })
}

/**
 * Which agent this sidebar is for.
 *
 * Scoped to our own tab rather than to global focus. That is what makes it immune to the
 * self-focus trap: focusing the sidebar sets focused_pane_id to our own pane, but we never
 * consult focus to decide identity — only to disambiguate when one tab holds several agents.
 * The last resolved agent is kept as a fallback so a transient empty snapshot does not blank
 * the panel.
 */
export function resolveSubject(
  agents: PaneAgent[],
  tabId: string | null,
  previous: PaneAgent | null,
): PaneAgent | null {
  const self = selfPaneId()
  const candidates = agents.filter((a) => a.paneId !== self && (!tabId || a.tabId === tabId))
  if (candidates.length === 0) return previous
  if (candidates.length === 1) return candidates[0]
  return (
    candidates.find((a) => a.focused) ??
    candidates.find((a) => a.paneId === previous?.paneId) ??
    candidates[0]
  )
}
