import { homedir } from "node:os"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { Subagent, SubagentSnapshot } from "./types.js"
import { subagentItems } from "./format.js"
import { readClaudeSubagents } from "./sources/claude.js"
import { CODEX_SESSIONS, readCodexSubagents } from "./sources/codex.js"
import { readGrokSubagents } from "./sources/grok.js"
import { transcriptFor } from "../tools/sources/calls.js"
import { sessionDir } from "../session/sources/grok.js"


/**
 * The subagents this session has in flight.
 *
 * All three agents keep one, and all three were made to prove it rather than assumed: Grok pairs
 * `subagent_spawned` with `subagent_finished`, Codex files each child as its own rollout naming
 * its parent, and Claude pairs the id handed back at launch against the notification that reports
 * it done. Claude is the one with no process to fall back on — its subagents run inside the same
 * process — so the transcript pairing is the only oracle it has.
 */
export function subagentsSection(): Section {
  let snapshot: SubagentSnapshot | null = null
  let subject: SectionContext["subject"] = null

  return {
    id: "subagents",
    placement: "top",

    watch: () => [CODEX_SESSIONS, join(homedir(), ".grok", "sessions")],

    async refresh(ctx) {
      subject = ctx.subject
      if (!subject?.sessionId) {
        snapshot = null
        return
      }
      const { agent, sessionId } = subject

      let running: Subagent[] = []
      if (agent === "claude") {
        const transcript = await transcriptFor("claude", sessionId).catch(() => null)
        running = transcript
          ? await readClaudeSubagents(transcript, sessionId).catch(() => [])
          : []
      } else if (agent === "codex") {
        running = await readCodexSubagents(sessionId).catch(() => [])
      } else {
        const dir = await sessionDir(sessionId).catch(() => null)
        running = dir ? await readGrokSubagents(join(dir, "updates.jsonl")).catch(() => []) : []
      }

      snapshot = { agent, running, observedAt: Date.now() }
    },

    // Hidden when nothing is in flight, like SHELLS: a row here always means work is running.
    regions(width, style) {
      if (!subject) return []
      const rows = subagentItems(snapshot?.running ?? null, width, style)
      return rows.length ? [{ head: rows, body: [] }] : []
    },
  }
}
