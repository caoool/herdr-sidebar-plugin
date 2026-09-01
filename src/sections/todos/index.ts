import type { Section, SectionContext } from "../types.js"
import type { TodoSnapshot } from "./types.js"
import { todoItems, todosTally } from "./format.js"
import { CLAUDE_TASKS, readClaudeTodos } from "./sources/claude.js"
import { CODEX_SESSIONS } from "../quota/sources/codex.js"
import { GROK_SESSIONS, readGrokTodos } from "./sources/grok.js"
import { readCodexTodos } from "./sources/codex.js"


/**
 * The agent's own task list for this session.
 *
 * Only two of the three agents keep one. Claude writes a file per task under
 * `~/.claude/tasks/<session>/`; Grok re-emits its whole plan into `updates.jsonl` whenever it
 * changes. Codex calls an `update_plan` tool whose arguments carry the whole plan; that tool is
 * configurable (`[tools] update_plan`) and had never been called on the machine this was written
 * against, so a Codex pane shows a dash until it is used — a dash rather than an empty list,
 * which would read as "all done".
 *
 * The list is never re-sorted. The order is the agent's own and carries meaning.
 */
export function todosSection(): Section {
  let snapshot: TodoSnapshot | null = null
  let subject: SectionContext["subject"] = null

  return {
    id: "todos",
    placement: "flex",

    watch: () => [CLAUDE_TASKS, GROK_SESSIONS, CODEX_SESSIONS],

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
        : await readCodexTodos(sessionId).catch(() => null)
      snapshot = todos ? { agent, todos, observedAt: Date.now() } : null
    },

    // The one section that expands: it is given every row the pinned bands leave, and scrolls
    // only once the list outgrows even that. Uncapped for the same reason.
    regions(width, style) {
      if (!subject) return []
      const todos = snapshot?.todos ?? null
      const items = todoItems(todos, width, style)
      if (!items.length) return []
      return [{ head: [todosTally(todos, width, style)], body: items }]
    },
  }
}
