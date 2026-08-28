import { join } from "node:path"
import { homedir } from "node:os"
import { cached } from "../../cache.js"
import { paneContext } from "../../herdr.js"
import { gitInfo } from "./sources/git.js"
import type { Section } from "../types.js"
import type { Style } from "../../ansi.js"
import { claudeDir } from "../quota/sources/claude.js"
import { sessionBlock, divergence } from "./format.js"
import { readClaudeSession } from "./sources/claude.js"
import { readCodexSession } from "./sources/codex.js"
import { readGrokSession } from "./sources/grok.js"
import type { ProjectInfo, SessionInfo } from "./types.js"

/**
 * What the agent in this pane is doing.
 *
 * Strictly per-pane, unlike quota: with no agent, or no session id for it, there is nothing to
 * describe and the section renders nothing rather than a block of dashes.
 */
/**
 * Git state changes at human speed while the pane repaints every five seconds, and each read
 * costs two subprocesses, so it is refreshed on its own cadence and shared through the cache.
 */
const GIT_CACHE_MS = 15_000

/** One entry per checkout: panes in different workspaces must not share a reading. */
const gitKey = (cwd: string) => `git-${Buffer.from(cwd).toString("base64url").slice(-40)}.json`

export function sessionSection(): Section {
  let info: SessionInfo | null = null
  let project: ProjectInfo | null = null
  const ctx = paneContext()
  const cwd = ctx?.workspace_cwd ?? ctx?.focused_pane_cwd ?? null
  const workspace = ctx?.workspace_label ?? null

  async function refreshProject() {
    // Where the pane is working is knowable without an agent, so it is read regardless of
    // whether the session reading succeeds.
    const git = cwd ? await cached(gitKey(cwd), GIT_CACHE_MS, () => gitInfo(cwd)).catch(() => null) : null
    project = workspace || git
      ? {
          workspace,
          branch: git?.branch ?? null,
          worktree: git?.worktree ?? null,
          diff: divergence(git?.ahead ?? null, git?.behind ?? null),
        }
      : null
  }

  return {
    id: "session",

    watch: () => [
      claudeDir(),
      join(homedir(), ".codex", "sessions"),
      join(homedir(), ".grok", "sessions"),
    ],

    async refresh(ctx) {
      await refreshProject()
      const subject = ctx.subject
      if (!subject?.sessionId) { info = null; return }
      // Claude needs the pane as well as the session: its permission mode is only live on
      // the pane's own screen.
      const read =
        subject.agent === "claude" ? () => readClaudeSession(subject.sessionId!, subject.paneId)
        : subject.agent === "codex" ? () => readCodexSession(subject.sessionId!)
        : () => readGrokSession(subject.sessionId!)
      // Keep the previous reading if this one fails: the values change slowly and a blank
      // block for one refresh is worse than values a few seconds old.
      info = (await read().catch(() => null)) ?? info
      if (info && info.agent !== subject.agent) info = null
    },

    render(width: number, style: Style) {
      return sessionBlock(info, project, width, style)
    },
  }
}
