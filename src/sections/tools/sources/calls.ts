import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
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

/** Counts, highest first; ties alphabetical so the rows do not reshuffle between refreshes. */
const sorted = (counts: Map<string, number>): ToolCall[] =>
  [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

export function tally(agent: ProviderKind, lines: string[]): ToolCall[] {
  const counts = new Map<string, number>()
  for (const line of lines) {
    for (const raw of namesIn(agent, line)) {
      const name = shortenTool(raw)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return sorted(counts)
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
const cursors = new Map<string, { size: number; counts: Map<string, number> }>()

export async function countCalls(agent: ProviderKind, path: string): Promise<ToolCall[]> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return []

  let cursor = cursors.get(path)
  // A file that shrank was rotated or replaced; start over rather than trust the old offset.
  if (!cursor || info.size < cursor.size) {
    cursor = { size: 0, counts: new Map() }
    cursors.set(path, cursor)
  }
  if (info.size === cursor.size) return sorted(cursor.counts)

  const stream = createReadStream(path, { start: cursor.size, end: info.size - 1 })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      for (const raw of namesIn(agent, line)) {
        const name = shortenTool(raw)
        cursor.counts.set(name, (cursor.counts.get(name) ?? 0) + 1)
      }
    }
  } catch { /* a partial read is recovered on the next refresh */ }
  cursor.size = info.size
  return sorted(cursor.counts)
}
