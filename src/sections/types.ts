import type { PaneAgent } from "../types.js"
import type { Style } from "../ansi.js"
import type { Region } from "../layout.js"

/**
 * A sidebar section.
 *
 * The sidebar is a stack of independent sections. Each owns its own data sources and its own
 * rendering, so adding one never touches the others or the pane process.
 *
 * Sections are deliberately pull-free where the agents allow it: `watch()` names the files
 * the agents already write, and the pane re-reads only when one of them changes.
 */

/**
 * Items a capped region shows before the rest has to be scrolled to.
 *
 * Shared rather than repeated per section: the number is a property of the sidebar's shape, not
 * of any one list, and four copies of it would drift the first time one was tuned. It counts
 * items, not rows — the overflow marker is an extra row, so raising this by one shows one more.
 */
export const VISIBLE = 3

/**
 * Which band of the pane a section's rows belong to.
 *
 *  - `top`    pinned against the top, under the banner. Quota, and what is running right now.
 *  - `flex`   takes every row the other two leave. At most one section may claim this.
 *  - `bottom` pinned against the foot, so the model and the branch are always in one place.
 *
 * A pane too short for everything drops whole `bottom` regions from the front, then trims the
 * `top` band from its foot. `flex` keeps a floor throughout — it is the section that expands, so
 * it must not be the one squeezed to nothing.
 */
export type Placement = "top" | "flex" | "bottom"

export type Section = {
  id: string

  placement: Placement

  /**
   * Files and directories whose changes should trigger a refresh. Missing paths are fine —
   * an agent that has never run leaves nothing behind, and the pane's slow tick covers a
   * directory that appears later.
   */
  watch(): string[]

  /** Re-read sources. Must not throw; a failing source becomes a missing reading. */
  refresh(ctx: SectionContext): Promise<void>

  /**
   * The section's rows at the given content width, without the pane's left indent.
   *
   * A section may contribute several regions — TOOLS and MCP are two lists that must scroll
   * independently — and each is separated from its neighbours by a single blank row, which the
   * pane inserts. An empty region is dropped rather than costing that separator.
   */
  regions(width: number, style: Style): Region[]

  /**
   * A row that rides at the very top of the pane, above every region.
   *
   * Only the session name uses this. It named the block back when the block had a heading; with
   * the headings gone it names the pane, which is the one thing on screen that is not a figure.
   */
  banner?(width: number, style: Style): string[]
}

export type SectionContext = {
  /**
   * The agent in this pane, when there is one. Sections use it for presentation only —
   * quota belongs to an account, not a pane, so every agent's figures are shown regardless
   * and this merely decides which block leads.
   */
  subject: PaneAgent | null
}
