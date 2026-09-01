import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { claudeDir } from "../../quota/sources/claude.js"
import { rolloutFor } from "../../session/sources/codex.js"
import { sessionDir } from "../../session/sources/grok.js"
import type { ProviderKind } from "../../../types.js"
import type { ToolCall } from "../types.js"

/** `mcp__github__search_code` -> `github:search_code`, and a plugin prefix loses its scaffolding. */
export function shortenTool(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!m) return name
  const server = m[1].replace(/^plugin_[^_]+_/, "").replace(/_/g, "-")
  return `${server}:${m[2]}`
}

/** Tool names invoked on one transcript line. Malformed lines contribute nothing. */
export function namesIn(agent: ProviderKind, line: string): string[] {
  if (!line.includes("tool") && !line.includes("_call")) return []
  let d: any
  try { d = JSON.parse(line) } catch { return [] }

  if (agent === "claude") {
    const content = d?.message?.content
    if (!Array.isArray(content)) return []
    return content.filter((b: any) => b?.type === "tool_use" && b?.name).map((b: any) => b.name)
  }

  if (agent === "codex") {
    const p = d?.payload
    const kinds = ["custom_tool_call", "function_call", "local_shell_call"]
    return p && kinds.includes(p.type) && p.name ? [p.name] : []
  }

  const u = d?.params?.update
  if (u?.sessionUpdate !== "tool_call") return []
  const name = u?._meta?.["x.ai/tool"]?.name ?? u?.title
  return name ? [String(name)] : []
}

/** What is known about one tool: how often it has been called, and when it last was. */
type Seen = { count: number; last: number }

/**
 * Most recently used first.
 *
 * Recency rather than frequency, because the sidebar shows only the first few rows and those
 * rows should answer "what is this session doing now". Sorted by frequency, the top of the list
 * is whatever the session has done most since it started — usually Bash — and it never changes.
 * Ties fall back to count and then to name, so the order is total and cannot reshuffle between
 * refreshes on equal input.
 */
const sorted = (seen: Map<string, Seen>): ToolCall[] =>
  [...seen]
    .map(([name, s]) => ({ name, count: s.count, last: s.last }))
    .sort((a, b) => b.last - a.last || b.count - a.count || a.name.localeCompare(b.name))
    .map(({ name, count }) => ({ name, count }))

/** Record one call against a tool, remembering its position in the session's order. */
function note(seen: Map<string, Seen>, name: string, at: number): void {
  const prior = seen.get(name)
  if (prior) {
    prior.count += 1
    prior.last = at
    return
  }
  seen.set(name, { count: 1, last: at })
}

export function tally(agent: ProviderKind, lines: string[]): ToolCall[] {
  const seen = new Map<string, Seen>()
  let at = 0
  for (const line of lines) {
    for (const raw of namesIn(agent, line)) note(seen, shortenTool(raw), at++)
  }
  return sorted(seen)
}

/**
 * Where the session's transcript lives, per agent.
 *
 * `PaneAgent` does not carry this and should not: each agent files its history differently, and
 * the resolvers already exist beside the session section's readers. Claude's path is recorded by
 * the statusLine collector; Codex names the session in its rollout filename; Grok keeps a
 * directory per session under a percent-encoded cwd.
 */
export async function transcriptFor(
  agent: ProviderKind,
  sessionId: string,
): Promise<string | null> {
  if (agent === "claude") {
    const text = await readFile(join(claudeDir(), `${sessionId}.json`), "utf8").catch(() => null)
    if (!text) return null
    try {
      const path = JSON.parse(text)?.transcript_path
      return typeof path === "string" ? path : null
    } catch { return null }
  }
  if (agent === "codex") return rolloutFor(sessionId)
  const dir = await sessionDir(sessionId)
  return dir ? join(dir, "updates.jsonl") : null
}

/**
 * Session totals, read incrementally.
 *
 * The count is for the whole session, so the tail trick used elsewhere would undercount — a
 * session's first hundred calls are far behind the window. Transcripts also reach tens of
 * megabytes, so re-reading the file every five seconds is not an option either. The file is
 * append-only, so the first read streams it whole and every later read consumes only the bytes
 * that appeared since, keeping the steady-state cost proportional to what the agent just did.
 */
const cursors = new Map<string, { size: number; seen: Map<string, Seen>; at: number }>()

export async function countCalls(agent: ProviderKind, path: string): Promise<ToolCall[]> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return []

  let cursor = cursors.get(path)
  // A file that shrank was rotated or replaced; start over rather than trust the old offset.
  if (!cursor || info.size < cursor.size) {
    cursor = { size: 0, seen: new Map(), at: 0 }
    cursors.set(path, cursor)
  }
  if (info.size === cursor.size) return sorted(cursor.seen)

  // The cursor may only advance past bytes that formed a complete line. A refresh can land
  // mid-write (the writer's file ends without a trailing newline yet); the fragment that
  // produces is unparseable and correctly contributes nothing, but if the cursor advanced past
  // it anyway the record's remaining bytes would arrive next time as a different, still-broken
  // fragment — the whole record silently and permanently lost. So newlines are found by hand
  // (rather than via readline, which hands back a final unterminated chunk indistinguishable
  // from a real line) and only the bytes up to the last one found are consumed; whatever trails
  // the final newline is held back for the next call to re-read from its true start.
  const stream = createReadStream(path, { start: cursor.size, end: info.size - 1 })
  const NEWLINE = 0x0a

  let leftover = Buffer.alloc(0)
  let bytesRead = 0

  try {
    for await (const chunk of stream) {
      bytesRead += chunk.length
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      let start = 0
      let idx: number
      while ((idx = buf.indexOf(NEWLINE, start)) !== -1) {
        const line = buf.subarray(start, idx).toString("utf8")
        for (const raw of namesIn(agent, line)) {
        note(cursor.seen, shortenTool(raw), cursor.at++)
        }
        start = idx + 1
      }
      leftover = buf.subarray(start)
    }
  } catch { /* whatever was consumed above is still credited below; the rest waits for the next refresh */ }

  cursor.size += bytesRead - leftover.length
  return sorted(cursor.seen)
}
