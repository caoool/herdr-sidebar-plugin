/**
 * Decides when the sidebar should close itself.
 *
 * It opens on `pane.agent_detected`, so it should leave once there is no agent to sit beside.
 * herdr offers no event for that: quitting an agent leaves its pane alive at a shell prompt,
 * so nothing exits and nothing closes. `agents[]` is not a reliable signal on its own —
 * Grok's detector keys off an OSC title ending ` - grok`, which often survives `/exit`,
 * Ctrl+D and Ctrl+C, so the pane stays listed while the foreground is already a shell.
 * Presence is therefore "a same-tab agent whose foreground process is still that agent".
 *
 * Nothing happens until an agent has actually been seen, so a sidebar opened by hand in a
 * tab that has none is not dismissed the instant it appears. Once an agent has been seen
 * and the foreground process is no longer that agent, close is immediate (grace 0).
 */
export type Dismisser = {
  /** Record whether the tab currently holds an agent. */
  note(present: boolean, now: number): void
  /** Whether the sidebar should close: an agent was seen, and is now gone. */
  ready(now: number): boolean
}

export function autoDismiss(enabled: boolean, graceMs: number): Dismisser {
  let sawAgent = false
  let emptySince: number | null = null

  return {
    note(present, now) {
      if (present) {
        sawAgent = true
        emptySince = null
        return
      }
      // Only start the clock once, so a run of empty polls measures from the first.
      if (sawAgent && emptySince === null) emptySince = now
    },
    ready(now) {
      return enabled && sawAgent && emptySince !== null && now - emptySince >= graceMs
    },
  }
}
