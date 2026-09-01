import { tailLines } from "../../../tail.js"
import type { Subagent } from "../types.js"

/**
 * Grok announces both ends of a subagent's life, so running is simply spawned-minus-finished.
 *
 * Verified live: two `explore` subagents produced one `subagent_spawned` and one
 * `subagent_finished` each, carrying id, type, description, role, model, and on completion the
 * status, duration, tokens and full output.
 */
export function runningIn(lines: string[]): Subagent[] {
  const started = new Map<string, Subagent>()
  const finished = new Set<string>()

  for (const line of lines) {
    if (!line.includes("subagent_spawned") && !line.includes("subagent_finished")) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const u = d?.params?.update
    const id = u?.subagent_id
    if (typeof id !== "string") continue

    if (u.sessionUpdate === "subagent_spawned") {
      started.set(id, {
        id,
        label: typeof u.description === "string" ? u.description : "",
        kind: typeof u.subagent_type === "string" ? u.subagent_type : null,
      })
    } else if (u.sessionUpdate === "subagent_finished") {
      finished.add(id)
    }
  }

  return [...started.values()].filter((s) => !finished.has(s.id))
}

const UPDATES_TAIL = 2 * 1024 * 1024

export async function readGrokSubagents(updatesPath: string): Promise<Subagent[]> {
  return runningIn(await tailLines(updatesPath, UPDATES_TAIL))
}
