import { join } from "node:path"
import { homedir } from "node:os"
import type { Section } from "../types.js"
import type { Style } from "../../ansi.js"
import { claudeDir } from "../quota/sources/claude.js"
import { sessionBlock } from "./format.js"
import { readClaudeSession } from "./sources/claude.js"
import { readCodexSession } from "./sources/codex.js"
import { readGrokSession } from "./sources/grok.js"
import type { SessionInfo } from "./types.js"

/**
 * What the agent in this pane is doing.
 *
 * Strictly per-pane, unlike quota: with no agent, or no session id for it, there is nothing to
 * describe and the section renders nothing rather than a block of dashes.
 */
export function sessionSection(): Section {
  let info: SessionInfo | null = null

  return {
    id: "session",

    watch: () => [
      claudeDir(),
      join(homedir(), ".codex", "sessions"),
      join(homedir(), ".grok", "sessions"),
    ],

    async refresh(ctx) {
      const subject = ctx.subject
      if (!subject?.sessionId) { info = null; return }
      const read =
        subject.agent === "claude" ? readClaudeSession
        : subject.agent === "codex" ? readCodexSession
        : readGrokSession
      // Keep the previous reading if this one fails: the values change slowly and a blank
      // block for one refresh is worse than values a few seconds old.
      info = (await read(subject.sessionId).catch(() => null)) ?? info
      if (info && info.agent !== subject.agent) info = null
    },

    render(width: number, style: Style) {
      return sessionBlock(info, width, style)
    },
  }
}
