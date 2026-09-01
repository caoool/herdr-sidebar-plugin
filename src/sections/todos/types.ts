import type { ProviderKind } from "../../types.js"

/**
 * What a todo can be.
 *
 * `failed` only ever comes from Grok, whose plan entries carry it; Claude's task files use the
 * other three. Nothing is inferred — a status the source does not state is not invented here.
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "failed"

export type Todo = { text: string; status: TodoStatus }

export type TodoSnapshot = {
  agent: ProviderKind
  /** In the agent's own order. This section never re-sorts; the order is information. */
  todos: Todo[]
  observedAt: number
}
