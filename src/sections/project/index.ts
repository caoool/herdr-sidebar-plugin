import { cached } from "../../cache.js"
import { paneContext } from "../../herdr.js"
import type { Section } from "../types.js"
import type { Style } from "../../ansi.js"
import { projectBlock, type ProjectInfo } from "./format.js"
import { gitInfo } from "./sources/git.js"

/**
 * Git state changes far more slowly than a five-second repaint, and each read costs two
 * subprocesses, so it is refreshed on its own cadence and shared through the plugin's cache.
 */
const CACHE_MS = 15_000

/** One cache entry per checkout: panes in different workspaces must not share a reading. */
const keyFor = (cwd: string) => `git-${Buffer.from(cwd).toString("base64url").slice(-40)}.json`

/**
 * Where the work is happening: the workspace, its branch and divergence, and its worktree.
 *
 * The workspace name and cwd come from the context herdr injects at launch, so naming the
 * project costs nothing. Only the git facts need asking for.
 */
export function projectSection(): Section {
  const ctx = paneContext()
  const cwd = ctx?.workspace_cwd ?? ctx?.focused_pane_cwd ?? null
  const workspace = ctx?.workspace_label ?? null
  let info: ProjectInfo | null = null

  return {
    id: "project",

    // Watching .git would fire on every index write during a build; the timed refresh below is
    // both quieter and sufficient for something that changes at human speed.
    watch: () => [],

    async refresh() {
      if (!cwd) { info = { workspace, branch: null, ahead: null, behind: null, worktree: null }; return }
      const git = await cached(keyFor(cwd), CACHE_MS, () => gitInfo(cwd)).catch(() => null)
      info = {
        workspace,
        branch: git?.branch ?? null,
        ahead: git?.ahead ?? null,
        behind: git?.behind ?? null,
        worktree: git?.worktree ?? null,
      }
    },

    render(width: number, style: Style) {
      return projectBlock(info, width, style)
    },
  }
}
