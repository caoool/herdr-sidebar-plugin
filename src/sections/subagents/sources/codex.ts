import { open, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { tailLines } from "../../../tail.js"
import type { Subagent } from "../types.js"

export const CODEX_SESSIONS = join(homedir(), ".codex", "sessions")

/**
 * Codex gives every subagent its own rollout file, and says so in that file's opening record:
 * `thread_source: "subagent"` with a `parent_thread_id` pointing back at the session that spawned
 * it, plus the nickname it was given and the path it was filed under.
 *
 * Verified live: spawning one subagent produced two rollouts, the child announcing
 * `agent_nickname: "Zeno"`, `agent_path: "/root/count_files"`, `multi_agent_version: "v2"`.
 */
export function childOf(meta: unknown, parentSessionId: string): Subagent | null {
  const d = meta as Record<string, any> | null
  if (!d || d.thread_source !== "subagent") return null
  if (d.parent_thread_id !== parentSessionId) return null

  const path = typeof d.agent_path === "string" ? d.agent_path : ""
  // "/root/count_files" — the leaf is the task's name and the only readable part; the prompt
  // itself is encrypted in the parent's spawn arguments, so there is nothing better to show.
  const task = path.split("/").filter(Boolean).pop() ?? ""
  const nickname = typeof d.agent_nickname === "string" ? d.agent_nickname : ""
  return {
    id: typeof d.id === "string" ? d.id : path,
    label: task || nickname,
    kind: task && nickname ? nickname : null,
  }
}

/** A rollout that has recorded its own completion is finished. */
export function isFinished(lines: string[]): boolean {
  return lines.some((line) => line.includes('"task_complete"'))
}

/** Rollout files, newest first. Only recent ones can belong to a live session. */
async function recentRollouts(limit: number): Promise<string[]> {
  const found: Array<{ path: string; mtime: number }> = []
  const stack = [CODEX_SESSIONS]
  while (stack.length) {
    const dir = stack.pop()!
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { stack.push(path); continue }
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue
      const info = await stat(path).catch(() => null)
      if (info) found.push({ path, mtime: info.mtimeMs })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((f) => f.path)
}

const CONSIDER = 40
const HEAD_BYTES = 64 * 1024

/** The first line of a file, without reading the rest of it. */
async function firstLine(path: string): Promise<string | null> {
  const handle = await open(path, "r").catch(() => null)
  if (!handle) return null
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    const text = buf.subarray(0, bytesRead).toString("utf8")
    const cut = text.indexOf("\n")
    return cut < 0 ? text : text.slice(0, cut)
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}

export async function readCodexSubagents(parentSessionId: string): Promise<Subagent[]> {
  const out: Subagent[] = []
  for (const path of await recentRollouts(CONSIDER)) {
    // Only the opening bytes: the record that identifies the thread is the first line, and
    // reading whole rollouts to find it would mean reading every rollout on the machine on
    // every refresh.
    const first = await firstLine(path)
    if (!first) continue
    let meta: any
    try { meta = JSON.parse(first)?.payload } catch { continue }
    const child = childOf(meta, parentSessionId)
    if (!child) continue
    if (isFinished(await tailLines(path, 256 * 1024))) continue
    out.push(child)
  }
  return out
}
