import type { McpServer, McpStatus } from "../types.js"

/**
 * Grok prints ANSI-coloured log lines to the same stream as its JSON, so the payload has to be
 * found rather than assumed to start at byte zero.
 *
 * The obvious `indexOf("[")` is wrong here: an ANSI escape sequence (`\x1b[2m`, `\x1b[31m`) is
 * itself made of a `[`, so the first `[` in the text is usually inside one of those, and parsing
 * from there fails. Instead every candidate `[` is tried in turn — the first one from which the
 * remainder actually parses as JSON is the payload. Doctor and list output are short, so trying
 * each candidate is cheap.
 */
function jsonIn(text: string): any {
  let from = 0
  while (true) {
    const start = text.indexOf("[", from)
    if (start < 0) return null
    try { return JSON.parse(text.slice(start)) } catch { /* try the next candidate */ }
    from = start + 1
  }
}

/**
 * Parse `grok mcp list --json`, upgraded with `grok mcp doctor --json` when that ran.
 *
 * The doctor needs authentication and can fail outright, so its absence is expected rather than
 * exceptional. Without it the status falls back to configuration — which is honest, and is
 * exactly what Codex is limited to permanently.
 */
export function parseGrokMcp(list: string, doctor: string | null): McpServer[] {
  const configured = jsonIn(list)
  if (!Array.isArray(configured)) return []

  const health = new Map<string, boolean>()
  const checked = doctor === null ? null : jsonIn(doctor)
  if (Array.isArray(checked)) {
    for (const entry of checked) {
      if (typeof entry?.name === "string" && typeof entry?.ok === "boolean") {
        health.set(entry.name, entry.ok)
      }
    }
  }

  return configured
    .filter((s: any) => typeof s?.name === "string")
    .map((s: any): McpServer => {
      const live = health.get(s.name)
      const status: McpStatus =
        live === undefined ? (s.enabled === false ? "disabled" : "enabled")
        : live ? "connected"
        : "failed"
      return { name: s.name, status }
    })
}
