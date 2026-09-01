import { homedir } from "node:os"
import { join } from "node:path"
import { readdir, stat } from "node:fs/promises"
import { tailLines } from "../../../tail.js"
import type { Todo, TodoStatus } from "../types.js"

export const GROK_SESSIONS = join(homedir(), ".grok", "sessions")

/** Matches the window used for Grok's other readings: its update lines are very large. */
const UPDATES_TAIL = 1024 * 1024

const STATUS: Record<string, TodoStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  failed: "failed",
}

/**
 * The newest plan in a batch of update lines, or null.
 *
 * Grok re-emits the whole plan every time it changes, so the last one wins and there is nothing
 * to merge. Entries carry a `priority` as well, which is not shown: it is the agent's own
 * bookkeeping and says nothing about what is done.
 */
export function newestPlan(lines: string[]): Todo[] | null {
  let found: Todo[] | null = null
  for (const line of lines) {
    if (!line.includes('"plan"')) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const update = d?.params?.update
    if (update?.sessionUpdate !== "plan" || !Array.isArray(update.entries)) continue
    const todos = update.entries
      .map((e: any): Todo | null => {
        const text = typeof e?.content === "string" ? e.content : null
        const status = typeof e?.status === "string" ? STATUS[e.status] : undefined
        return text && status ? { text, status } : null
      })
      .filter((t: Todo | null): t is Todo => t !== null)
    if (todos.length) found = todos
  }
  return found
}

/**
 * Grok keys its sessions by a percent-encoded cwd, so the id is searched for rather than the
 * encoding reconstructed — the same approach the session section takes.
 */
async function updatesPath(sessionId: string): Promise<string | null> {
  for (const bucket of await readdir(GROK_SESSIONS, { withFileTypes: true }).catch(() => [])) {
    if (!bucket.isDirectory()) continue
    const candidate = join(GROK_SESSIONS, bucket.name, sessionId, "updates.jsonl")
    if (await stat(candidate).then((s) => s.isFile()).catch(() => false)) return candidate
  }
  return null
}

/**
 * Remembered per session, because a plan set early in a long session falls out of the tail
 * window. Only a newer plan replaces it, so the list cannot silently revert to nothing on a
 * refresh that happened to read past it.
 */
const known = new Map<string, Todo[]>()

export async function readGrokTodos(sessionId: string): Promise<Todo[] | null> {
  const path = await updatesPath(sessionId)
  if (!path) return known.get(sessionId) ?? null
  const plan = newestPlan(await tailLines(path, UPDATES_TAIL))
  if (plan) known.set(sessionId, plan)
  return known.get(sessionId) ?? null
}
