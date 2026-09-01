import { tailLines } from "../../../tail.js"
import type { Shell } from "../types.js"

/**
 * Grok records a backgrounded task and its completion as separate lines, so what is still running
 * is simply what has been started and not yet completed.
 *
 * Verified live: backgrounding `sleep 300`, monitoring it, and backgrounding `sleep 8` produced
 * exactly this, and the pairing agreed with the process table — two running, one finished.
 *
 * The completion record nests its id under `task_snapshot.task_id` rather than carrying it at the
 * top level like `task_backgrounded` does. Reading the top level instead finds no completions at
 * all and reports every finished task as running, which is precisely the lie this section must
 * never tell.
 */
export function runningIn(lines: string[]): Shell[] {
  const started = new Map<string, Shell>()
  const finished = new Set<string>()

  for (const line of lines) {
    if (!line.includes("task_backgrounded") && !line.includes("task_completed")) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const u = d?.params?.update
    if (!u) continue

    if (u.sessionUpdate === "task_backgrounded" && typeof u.task_id === "string") {
      started.set(u.task_id, {
        id: u.task_id,
        // A monitor is marked by carrying its own description; the shell that it watches has none.
        kind: u.monitor_description ? "monitor" : "shell",
        command: typeof u.command === "string" ? u.command : "",
      })
    } else if (u.sessionUpdate === "task_completed") {
      const id = u.task_snapshot?.task_id
      if (typeof id === "string") finished.add(id)
    }
  }

  return [...started.values()].filter((s) => !finished.has(s.id))
}

/** A window wide enough that a task started earlier in the turn is still in it. */
const UPDATES_TAIL = 2 * 1024 * 1024

export async function readGrokShells(updatesPath: string): Promise<Shell[]> {
  return runningIn(await tailLines(updatesPath, UPDATES_TAIL))
}
