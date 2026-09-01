import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Subagent } from "../types.js"

/**
 * Claude launches a subagent asynchronously: the tool returns at once with an id, and the agent's
 * completion arrives later as a notification. So the pairing is between the id handed back at
 * launch and the id in the notification that reports it finished.
 *
 * Both are matched by raw text rather than by walking the message structure, and that is
 * deliberate. Notifications arrive wrapped — inside system reminders, inside tool results — and a
 * structured parse missed four of twenty-two on a real transcript, reporting finished agents as
 * still running. Scanning the line finds all of them: verified at 22 launched, 22 completed, none
 * unmatched.
 */
const LAUNCHED = /agentId: (a[0-9a-f]+)/g
const COMPLETED = /<task-id>(a[0-9a-f]+)<\/task-id>/g

export function scan(line: string, launched: Set<string>, completed: Set<string>): void {
  if (line.includes("agentId: ")) {
    LAUNCHED.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = LAUNCHED.exec(line)) !== null) launched.add(m[1])
  }
  if (line.includes("<task-id>")) {
    COMPLETED.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COMPLETED.exec(line)) !== null) completed.add(m[1])
  }
}

/**
 * Read incrementally, the way the tool-call counter does.
 *
 * A subagent launched early in a long session must still be counted, so the whole transcript
 * matters — but these files reach tens of megabytes and this runs every few seconds. The cursor
 * advances only past complete lines, so a record split across a read is recovered rather than
 * lost.
 */
type Cursor = { size: number; launched: Set<string>; completed: Set<string> }
const cursors = new Map<string, Cursor>()

async function consume(path: string): Promise<Cursor | null> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return null

  let cursor = cursors.get(path)
  if (!cursor || info.size < cursor.size) {
    cursor = { size: 0, launched: new Set(), completed: new Set() }
    cursors.set(path, cursor)
  }
  if (info.size === cursor.size) return cursor

  let leftover = ""
  let consumed = cursor.size
  try {
    const stream = createReadStream(path, { start: cursor.size, end: info.size - 1 })
    for await (const chunk of stream) {
      const text = leftover + String(chunk)
      const lines = text.split("\n")
      leftover = lines.pop() ?? ""
      for (const line of lines) scan(line, cursor.launched, cursor.completed)
      consumed += Buffer.byteLength(text, "utf8") - Buffer.byteLength(leftover, "utf8")
    }
  } catch { return cursor }
  cursor.size = consumed
  return cursor
}

/** What a subagent was for, from the file Claude writes beside its transcript. */
export async function describe(subagentsDir: string, id: string): Promise<Subagent> {
  const text = await readFile(join(subagentsDir, `agent-${id}.meta.json`), "utf8").catch(() => null)
  if (!text) return { id, label: "", kind: null }
  try {
    const d = JSON.parse(text)
    return {
      id,
      label: typeof d?.description === "string" ? d.description : "",
      kind: typeof d?.agentType === "string" ? d.agentType : null,
    }
  } catch {
    return { id, label: "", kind: null }
  }
}

export async function readClaudeSubagents(
  transcriptPath: string,
  sessionId: string,
): Promise<Subagent[]> {
  const cursor = await consume(transcriptPath)
  if (!cursor) return []
  const running = [...cursor.launched].filter((id) => !cursor.completed.has(id))
  const dir = join(dirname(transcriptPath), sessionId, "subagents")
  return Promise.all(running.map((id) => describe(dir, id)))
}
