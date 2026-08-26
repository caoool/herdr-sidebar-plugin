import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"
import { stateDir } from "../../../herdr.js"

/**
 * Claude never writes quota to disk on its own: cachedUsageUtilization in ~/.claude.json
 * did not refresh across two sessions in a day and sat five days stale, and no hook payload
 * carries rate_limits (14 records across SessionStart / PostToolUse / TaskCreated /
 * TaskCompleted / Stop — zero hits).
 *
 * The one channel is the statusLine command, which Claude Code invokes about every 10s even
 * while idle. It renders whatever the command prints, so a command that prints NOTHING is a
 * silent collector. bin/install-collector.mjs installs it; it writes one file per session.
 */
export const claudeDir = () => join(stateDir(), "claude")

const WINDOWS: Array<{ key: string; label: string; minutes: number }> = [
  { key: "five_hour", label: "5h", minutes: 300 },
  { key: "seven_day", label: "7d", minutes: 10080 },
]

const pct = (raw: any): number | null =>
  typeof raw?.used_percentage === "number" ? raw.used_percentage
  : typeof raw?.utilization === "number" ? raw.utilization
  : null

/**
 * Reconcile the same window as reported by several concurrent sessions.
 *
 * Every live session writes its own file, and each carries the rate_limits from *its own*
 * last API response — so an idle session holds a staler figure than a busy one, and a session
 * that has not made its first call carries none at all. Picking the most recently written
 * file therefore made the panel oscillate (0% / 2% / 3% between frames) and blank whenever a
 * fresh session's write happened to land last. File recency is not data recency.
 *
 * Two facts make the reconciliation exact rather than a heuristic:
 *
 *   Usage within a window only rises, so of two observations of the same window the larger is
 *   necessarily the later one. Taking the maximum yields the most recent truth no matter which
 *   session observed it or when its file was written.
 *
 *   A window is identified by its reset time. When a window rolls over, resets_at changes, so
 *   restricting to the newest resets_at drops every observation of the previous window instead
 *   of letting yesterday's high-water mark bleed into today.
 *
 * Sessions missing the window contribute nothing rather than dragging the reading to zero.
 */
export function reconcile(payloads: any[]): QuotaWindow[] {
  const out: QuotaWindow[] = []
  for (const { key, label, minutes } of WINDOWS) {
    const seen = payloads
      .map((p) => p?.rate_limits?.[key])
      .filter((w) => w && pct(w) !== null)
    if (!seen.length) continue

    const resetsAt = Math.max(...seen.map((w) => (typeof w.resets_at === "number" ? w.resets_at : 0)))
    const current = seen.filter(
      (w) => (typeof w.resets_at === "number" ? w.resets_at : 0) === resetsAt,
    )
    out.push({
      id: key,
      label,
      percent: Math.max(...current.map((w) => pct(w)!)),
      resetsAt: resetsAt || null,
      windowMinutes: minutes,
      active: true,
    })
  }
  return out
}

async function payloads(): Promise<any[]> {
  const dir = claudeDir()
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json"))
  const read = await Promise.all(
    names.map(async (n) => {
      const text = await readFile(join(dir, n), "utf8").catch(() => null)
      if (!text) return null
      try { return JSON.parse(text) } catch { return null }
    }),
  )
  return read.filter(Boolean)
}

export async function readClaude(): Promise<QuotaSnapshot | null> {
  const all = await payloads()
  if (!all.length) return null

  const windows = reconcile(all)
  // An empty result is a real state — every session is new and none has had an API response
  // yet — and is distinct from "no sessions at all", which returns null above.
  return {
    agent: "claude",
    sessionId: null,
    // The statusLine payload carries no plan field, only the model, which is not quota
    // information and must not be shown as one. A plan label would come from
    // `claude auth status --json` or ~/.claude.json's oauthAccount.organizationRateLimitTier.
    plan: null,
    windows,
    credits: null,
    observedAt: Math.max(...all.map((p) => (typeof p._collected_at === "number" ? p._collected_at : 0))),
    source: "statusline",
  }
}
