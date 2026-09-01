import { homedir, tmpdir } from "node:os"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { ShellSnapshot } from "./types.js"
import { shellItems, shellsBlock, shellsHead } from "./format.js"
import { CLAUDE_SESSIONS, readClaudeShells } from "./sources/claude.js"
import { readCodexShells } from "./sources/codex.js"
import { readGrokShells } from "./sources/grok.js"
import { rolloutFor } from "../session/sources/codex.js"
import { sessionDir } from "../session/sources/grok.js"

/** Items shown before the rest becomes scrollable, matching the other regions. */
const VISIBLE = 5

/**
 * What this session is running right now: background shells, and the monitors watching them.
 *
 * All three agents support this, but only after being made to prove it — an earlier survey
 * concluded Grok was unproven and Codex unobservable, and running both live disproved each.
 * Every source distinguishes running from finished, so a row here always means "this is alive".
 * That is the whole point: an invisible background process is how work gets left behind.
 */
export function shellsSection(): Section {
  let snapshot: ShellSnapshot | null = null
  let subject: SectionContext["subject"] = null

  return {
    id: "shells",
    scrollable: true,

    watch: () => [
      CLAUDE_SESSIONS,
      join(homedir(), ".codex", "sessions"),
      join(homedir(), ".grok", "sessions"),
    ],

    async refresh(ctx) {
      subject = ctx.subject
      if (!subject?.sessionId) {
        snapshot = null
        return
      }
      const { agent, sessionId } = subject

      let running: Awaited<ReturnType<typeof readClaudeShells>> = []
      if (agent === "claude") {
        running = await readClaudeShells(sessionId).catch(() => [])
      } else if (agent === "codex") {
        const path = await rolloutFor(sessionId).catch(() => null)
        running = path ? await readCodexShells(path).catch(() => []) : []
      } else {
        const dir = await sessionDir(sessionId).catch(() => null)
        running = dir ? await readGrokShells(join(dir, "updates.jsonl")).catch(() => []) : []
      }

      try {
        appendFileSync("/Users/lu/.sidebar-shells.log",
          JSON.stringify({ t: new Date().toISOString(), agent, sessionId, found: running.length,
            sample: running[0]?.command?.slice(0, 60) ?? null }) + "\n")
      } catch { /* diagnostic only */ }
      snapshot = { agent, running, observedAt: Date.now() }
    },

    render(width, style) {
      if (!subject) return []
      return shellsBlock(snapshot, width, style)
    },

    regions(width, style) {
      if (!subject) return []
      const running = snapshot?.running ?? null
      return [{
        head: ["", ...shellsHead(running, width, style)],
        body: shellItems(running, width, style),
        maxBody: VISIBLE,
      }]
    },
  }
}
