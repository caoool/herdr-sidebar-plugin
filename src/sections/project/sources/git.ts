import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { basename } from "node:path"

const run = promisify(execFile)

export type GitInfo = {
  branch: string | null
  /** Commits on the local branch that the upstream lacks. Null when there is no upstream. */
  ahead: number | null
  /** Commits on the upstream that the local branch lacks. */
  behind: number | null
  /** The linked worktree's name, or null when this checkout is the main one. */
  worktree: string | null
}

const git = async (cwd: string, args: string[]): Promise<string | null> => {
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 5_000 }).catch(() => ({ stdout: "" }))
  const out = stdout.trim()
  return out === "" ? null : out
}

/**
 * Branch, divergence and worktree for a checkout.
 *
 * herdr computes the same things for its own sidebar rows, but exposes them only for
 * worktree-backed workspaces — `workspace.get` carries no branch — so this asks git directly.
 * Two invocations rather than four: the first batches three rev-parse queries, and the second
 * is separate because it fails whenever the branch has no upstream, which is ordinary.
 */
export async function gitInfo(cwd: string): Promise<GitInfo | null> {
  const head = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD", "--git-dir", "--git-common-dir"])
  if (!head) return null
  const [branch, gitDir, commonDir] = head.split("\n").map((l) => l.trim())

  // A linked worktree keeps its own git dir under <common>/worktrees/<name>, so the two paths
  // agreeing means this is the main checkout and there is no worktree worth naming.
  const linked = Boolean(gitDir && commonDir && gitDir !== commonDir && gitDir.includes("/worktrees/"))

  let ahead: number | null = null
  let behind: number | null = null
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
  if (counts) {
    const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10))
    if (Number.isFinite(a) && Number.isFinite(b)) { ahead = a; behind = b }
  }

  return {
    branch: branch && branch !== "HEAD" ? branch : null,
    ahead,
    behind,
    worktree: linked ? basename(cwd) : null,
  }
}
