import { readFile, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Todo, TodoStatus } from "../types.js"

export const CLAUDE_TASKS = join(homedir(), ".claude", "tasks")

const STATUS: Record<string, TodoStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
}

/**
 * One task per file, named by its id: `~/.claude/tasks/<session>/<id>.json`.
 *
 * The id is the agent's own ordering, so files are read in numeric order rather than the order
 * the directory happens to return. Each file also carries `activeForm`, `blocks` and `blockedBy`;
 * only the subject and status are shown, because a dependency graph does not fit a 30-column
 * column and a half-rendered one would mislead.
 */
export function orderTasks(files: string[]): string[] {
  return files
    .filter((n) => /^\d+\.json$/.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

/** A task file's todo, or null when the file says nothing usable. */
export function toTodo(raw: unknown): Todo | null {
  const d = raw as Record<string, unknown> | null
  const text = typeof d?.subject === "string" ? d.subject : null
  const status = typeof d?.status === "string" ? STATUS[d.status] : undefined
  if (!text || !status) return null
  return { text, status }
}

export async function readClaudeTodos(sessionId: string): Promise<Todo[] | null> {
  const dir = join(CLAUDE_TASKS, sessionId)
  const names = await readdir(dir).catch(() => null)
  // No directory at all is "this session never made tasks", which is a dash rather than an
  // empty list — the section says nothing rather than claiming the list is finished.
  if (!names) return null

  const out: Todo[] = []
  for (const name of orderTasks(names)) {
    const text = await readFile(join(dir, name), "utf8").catch(() => null)
    if (!text) continue
    try {
      const todo = toTodo(JSON.parse(text))
      if (todo) out.push(todo)
    } catch { /* a half-written file is skipped, not guessed at */ }
  }
  return out.length ? out : null
}
