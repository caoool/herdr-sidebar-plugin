import { homedir } from "node:os"
import { join } from "node:path"
import { VISIBLE } from "../types.js"
import type { Section, SectionContext } from "../types.js"
import type { Subagent, SubagentSnapshot } from "./types.js"
import { subagentItems, subagentsBlock, subagentsHead } from "./format.js"
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
    scrollable: true,

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

    render(width, style) {
      if (!subject) return []
      return subagentsBlock(snapshot, width, style)
    },

    regions(width, style) {
      if (!subject) return []
      const running = snapshot?.running ?? null
      return [{
        head: ["", ...subagentsHead(running, width, style)],
        body: subagentItems(running, width, style),
        maxBody: VISIBLE,
      }]
    },
  }
}
