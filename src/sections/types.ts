import type { PaneAgent } from "../types.js"
import type { Style } from "../ansi.js"

/**
 * A sidebar section.
 *
 * The sidebar is a stack of independent sections — quota today, connected MCP servers and
 * the agent's task list later. Each owns its own data sources and its own rendering, so
 * adding one never touches the others or the pane process.
 *
 * Sections are deliberately pull-free where the agents allow it: `watch()` names the files
 * the agents already write, and the pane re-reads only when one of them changes.
 */
export type Section = {
  id: string

  /**
   * Render into the pane's scroll region rather than the pinned block.
   *
   * At most one section is scrollable. Everything else renders whole and stays put, so the
   * readings you glance at — quota, context, speed — never scroll out of view while you are
   * reading a long list.
   */
  scrollable?: boolean

  /**
   * Files and directories whose changes should trigger a refresh. Missing paths are fine —
   * an agent that has never run leaves nothing behind, and the pane's slow tick covers a
   * directory that appears later.
   */
  watch(): string[]

  /** Re-read sources. Must not throw; a failing source becomes a missing reading. */
  refresh(ctx: SectionContext): Promise<void>

  /** Render at the given content width. Returns lines without the pane's left indent. */
  render(width: number, style: Style): string[]
}

export type SectionContext = {
  /**
   * The agent in this pane, when there is one. Sections use it for presentation only —
   * quota belongs to an account, not a pane, so every agent's figures are shown regardless
   * and this merely decides which block leads.
   */
  subject: PaneAgent | null
}
