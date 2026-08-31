import type { McpServer, McpStatus } from "../types.js"

/**
 * Trim a server name to what distinguishes it.
 *
 * Claude qualifies every plugin server as `plugin:<plugin>:<server>` and every connector as
 * `claude.ai <Name>`. In a 30-column sidebar the qualifier costs more than it says — the last
 * segment is what the reader is looking for.
 */
export function shortenServer(name: string): string {
  if (name.startsWith("plugin:")) return name.split(":").pop() ?? name
  if (name.startsWith("claude.ai ")) return name.slice("claude.ai ".length)
  return name
}

const STATUS: Array<[RegExp, McpStatus]> = [
  [/needs? authentication/i, "needs-auth"],
  [/pending/i, "pending"],
  [/failed|error|disconnected/i, "failed"],
  [/connected/i, "connected"],
]

/**
 * Parse `claude mcp list`, which has no JSON mode.
 *
 * Each server is one line, `name: target - status`. The name may itself contain colons
 * (`plugin:github:github`), so the split is on the first `": "` — a colon followed by a space —
 * which the qualifier never contains. The status is whatever follows the last `" - "`, since
 * targets contain hyphens and parenthesised transports.
 *
 * A line that does not even have that shape is not a server and is dropped. A line that does,
 * but whose status word matches none of the known patterns, still is one — it is kept and
 * counted in the total as `unverified`, the status that claims least: not healthy, but not a
 * known failure or auth need either, just "present, but nothing checkable was read". Dropping
 * it instead would shrink the denominator and leave `n/total` confidently wrong; labelling it
 * `pending` instead would claim the specific, checkable fact "pending approval", which is not
 * what was observed.
 */
export function parseClaudeMcp(stdout: string): McpServer[] {
  const out: McpServer[] = []
  for (const line of stdout.split("\n")) {
    const cut = line.indexOf(": ")
    const dash = line.lastIndexOf(" - ")
    if (cut < 1 || dash < cut) continue
    const tail = line.slice(dash + 3).trim()
    const hit = STATUS.find(([re]) => re.test(tail))
    const status = hit ? hit[1] : "unverified"
    out.push({ name: shortenServer(line.slice(0, cut).trim()), status })
  }
  return out
}
