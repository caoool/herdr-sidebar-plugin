import { homedir } from "node:os"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { TodoSnapshot } from "./types.js"
import { todoItems, todosBlock, todosHead } from "./format.js"
import { CLAUDE_TASKS, readClaudeTodos } from "./sources/claude.js"
import { GROK_SESSIONS, readGrokTodos } from "./sources/grok.js"

/** Items shown before the rest becomes scrollable, matching the TOOLS and MCP regions. */
const VISIBLE = 5

/**
 * The agent's own task list for this session.
 *
 * Only two of the three agents keep one. Claude writes a file per task under
 * `~/.claude/tasks/<session>/`; Grok re-emits its whole plan into `updates.jsonl` whenever it
 * changes. Codex has no equivalent — `update_plan` appears in its rollouts only as prose, never
 * as a call — so a Codex pane shows a dash rather than an empty list, which would read as "all
 * done".
 *
 * The list is never re-sorted. The order is the agent's own and carries meaning.
 */
export function todosSection(): Section {
  let snapshot: TodoSnapshot | null = null
  let subject: SectionContext["subject"] = null

  return {
    id: "todos",
    scrollable: true,

    watch: () => [CLAUDE_TASKS, GROK_SESSIONS],

    async refresh(ctx) {
      subject = ctx.subject
      if (!subject?.sessionId) {
        snapshot = null
        return
      }
      const { agent, sessionId } = subject
      const todos =
        agent === "claude" ? await readClaudeTodos(sessionId).catch(() => null)
        : agent === "grok" ? await readGrokTodos(sessionId).catch(() => null)
        : null
      snapshot = todos ? { agent, todos, observedAt: Date.now() } : null
    },

    render(width, style) {
      if (!subject) return []
      return todosBlock(snapshot, width, style)
    },

    regions(width, style) {
      if (!subject) return []
      const todos = snapshot?.todos ?? null
      return [{
        head: ["", ...todosHead(todos, width, style)],
        body: todoItems(todos, width, style),
        maxBody: VISIBLE,
      }]
    },
  }
}
