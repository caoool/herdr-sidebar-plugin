import type { Style } from "../../ansi.js"

export type ProjectInfo = {
  workspace: string | null
  branch: string | null
  ahead: number | null
  behind: number | null
  worktree: string | null
}

/**
 * Ahead and behind, in herdr's own shape.
 *
 * Zero counts are omitted rather than shown as "↑0": a branch level with its upstream has
 * nothing to report, and printing zeros would make the common case the loudest one. A branch
 * with no upstream has no divergence to describe at all, so it renders empty too.
 */
export function divergence(ahead: number | null, behind: number | null): string {
  const parts: string[] = []
  if (ahead) parts.push(`↑${ahead}`)
  if (behind) parts.push(`↓${behind}`)
  return parts.join(" ")
}

/** The section: workspace, branch with its divergence, and a worktree only when there is one. */
export function projectBlock(info: ProjectInfo | null, width: number, style: Style): string[] {
  if (!info || (!info.workspace && !info.branch)) return []
  const finish = style.line ?? ((s: string) => s)
  const rows: string[] = []

  if (info.workspace) rows.push(finish(info.workspace))

  if (info.branch) {
    const right = divergence(info.ahead, info.behind)
    const gap = Math.max(1, width - info.branch.length - right.length)
    rows.push(finish(info.branch + " ".repeat(gap) + right))
  }

  // Only when the checkout actually is a linked worktree; the main checkout has nothing to add.
  if (info.worktree) rows.push(finish(info.worktree))

  return [finish(style.bold("PROJECT")), "", ...rows]
}
