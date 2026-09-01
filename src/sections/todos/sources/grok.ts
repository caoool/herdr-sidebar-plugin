import { homedir } from "node:os"
import { join } from "node:path"
import { readdir, stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
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
 * Scan the whole file, once, for a plan set before the tail window.
 *
 * Streamed rather than read whole: these files reach several megabytes, and the plan is usually
 * nowhere near the end. Measured on a real session, the newest plan sat 2.6 MB back — a tail of
 * any sane size would never have reached it, which is exactly what the first version got wrong.
 */
async function fullScan(path: string): Promise<Todo[] | null> {
  let found: Todo[] | null = null
  try {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
    for await (const line of rl) {
      const plan = newestPlan([line])
      if (plan) found = plan
    }
  } catch { return null }
  return found
}

/**
 * Remembered per session, because a plan set early in a long session falls out of the tail
 * window. Only a newer plan replaces it, so the list cannot silently revert to nothing on a
 * refresh that happened to read past it.
 */
const known = new Map<string, Todo[]>()
/** Sessions already scanned in full, so the one expensive pass happens at most once each. */
const scanned = new Set<string>()

export async function readGrokTodos(sessionId: string): Promise<Todo[] | null> {
  const path = await updatesPath(sessionId)
  if (!path) return known.get(sessionId) ?? null

  // The tail first, so a plan changed moments ago is picked up immediately and supersedes
  // anything older. Only when it has nothing is the whole file worth a pass.
  const recent = newestPlan(await tailLines(path, UPDATES_TAIL))
  if (recent) {
    known.set(sessionId, recent)
    return recent
  }

  if (!scanned.has(sessionId)) {
    scanned.add(sessionId)
    const whole = await fullScan(path)
    if (whole) known.set(sessionId, whole)
  }
  return known.get(sessionId) ?? null
}
