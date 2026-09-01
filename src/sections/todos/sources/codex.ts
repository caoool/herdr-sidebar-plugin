import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { tailLines } from "../../../tail.js"
import { rolloutFor } from "../../session/sources/codex.js"
import type { Todo, TodoStatus } from "../types.js"

/** Rollouts are large; this matches the window the session reader uses. */
const ROLLOUT_TAIL = 512 * 1024

const STATUS: Record<string, TodoStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
}

/**
 * Codex's plan arrives as a call to its `update_plan` tool, whose arguments the binary describes
 * as "an optional explanation and a list of plan items, each with a step and status".
 *
 * Unlike Claude and Grok, this tool is configurable — `[tools] update_plan` in
 * `~/.codex/config.toml` — and across every rollout on the machine this was written against it
 * had never once been called. The reader is written from the tool's own published shape rather
 * than from captured output, so it stays honest about what it has never seen: an unrecognised
 * status is dropped rather than mapped to a guess, and a call carrying no usable items yields
 * nothing instead of an empty list that would read as "all done".
 */
export function planFromCall(payload: unknown): Todo[] | null {
  const p = payload as Record<string, any> | null
  const kinds = ["function_call", "custom_tool_call", "local_shell_call"]
  if (!p || !kinds.includes(p.type) || p.name !== "update_plan") return null

  let args: any = p.arguments
  if (typeof args === "string") {
    try { args = JSON.parse(args) } catch { return null }
  }
  const items = args?.plan
  if (!Array.isArray(items)) return null

  const todos = items
    .map((e: any): Todo | null => {
      const text = typeof e?.step === "string" ? e.step : null
      const status = typeof e?.status === "string" ? STATUS[e.status] : undefined
      return text && status ? { text, status } : null
    })
    .filter((t: Todo | null): t is Todo => t !== null)
  return todos.length ? todos : null
}

/** The newest plan in a batch of rollout lines, or null. A later call replaces the whole plan. */
export function newestPlan(lines: string[]): Todo[] | null {
  let found: Todo[] | null = null
  for (const line of lines) {
    if (!line.includes("update_plan")) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const plan = planFromCall(d?.payload)
    if (plan) found = plan
  }
  return found
}

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

const known = new Map<string, Todo[]>()
const scanned = new Set<string>()

/**
 * The tail first, so a plan changed moments ago wins immediately; only when it has nothing does
 * the file get one streamed pass, remembered per session. Same shape as the Grok reader, and for
 * the same reason: a plan set early in a long session sits far behind any sane tail window.
 */
export async function readCodexTodos(sessionId: string): Promise<Todo[] | null> {
  const path = await rolloutFor(sessionId)
  if (!path) return known.get(sessionId) ?? null

  const recent = newestPlan(await tailLines(path, ROLLOUT_TAIL))
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
