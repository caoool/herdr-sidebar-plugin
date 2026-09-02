import type { McpServer, McpStatus } from "../types.js"

/**
 * Grok prints ANSI-coloured log lines to the same stream as its JSON, so the payload has to be
 * found rather than assumed to start at byte zero.
 *
 * Escapes (`\x1b[2m`) are stripped first: an unstripped `[` inside one of those is usually the
 * first bracket in the text, and parsing from there fails. After that every remaining `{` and
 * `[` is tried — Grok 1.0.13's doctor emits an object (`{ sources, servers }`), while list and
 * older doctor output are arrays. Doctor and list output are short, so trying each candidate
 * is cheap.
 */
function jsonIn(text: string): any {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "")
  let from = 0
  while (from < stripped.length) {
    const brace = stripped.indexOf("{", from)
    const bracket = stripped.indexOf("[", from)
    const start = [brace, bracket].filter((i) => i >= 0).sort((a, b) => a - b)[0]
    if (start == null) return null
    try { return JSON.parse(stripped.slice(start)) } catch { /* try the next candidate */ }
    from = start + 1
  }
  return null
}

type GrokEntry = { name: string; enabled?: boolean; ok?: boolean; healthy?: boolean }

/** Array form (mcp list, older doctor) or `{ servers: [...] }` (Grok 1.0.13 doctor). */
function entriesIn(payload: any): GrokEntry[] {
  const raw = Array.isArray(payload) ? payload
    : payload && Array.isArray(payload.servers) ? payload.servers
    : []
  return raw.filter((s: any) => typeof s?.name === "string")
}

function liveOf(entry: GrokEntry): boolean | undefined {
  if (typeof entry.ok === "boolean") return entry.ok
  if (typeof entry.healthy === "boolean") return entry.healthy
  return undefined
}

/**
 * Parse `grok mcp list --json`, upgraded with `grok mcp doctor --json` when that ran.
 *
 * From Grok 1.0.13 the servers live on plugins, not in config.toml. `mcp list` is then `[]`
 * even when doctor reports a dozen, so the doctor is the set of servers when the list is
 * empty. List-only names (config.toml, no plugin) still appear, with doctor health overlaid
 * when it ran. The doctor needs authentication and can fail outright; without it the status
 * falls back to configuration — which is honest, and is exactly what Codex is limited to
 * permanently.
 */
export function parseGrokMcp(list: string, doctor: string | null): McpServer[] {
  const listed = entriesIn(jsonIn(list))
  const checked = doctor === null ? [] : entriesIn(jsonIn(doctor))

  const health = new Map<string, boolean>()
  for (const entry of checked) {
    const live = liveOf(entry)
    if (live !== undefined) health.set(entry.name, live)
  }

  // Doctor order is what Grok itself prints. Config.toml-only names, if any, trail.
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of [...checked, ...listed]) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    names.push(entry.name)
  }
  const enabled = new Map(listed.map((s) => [s.name, s.enabled !== false]))

  return names.map((name): McpServer => {
    const live = health.get(name)
    const status: McpStatus =
      live === undefined ? (enabled.get(name) === false ? "disabled" : "enabled")
      : live ? "connected"
      : "failed"
    return { name, status }
  })
}
