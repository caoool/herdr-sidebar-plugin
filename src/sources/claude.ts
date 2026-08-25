import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"
import { stateDir } from "../herdr.js"

/**
 * Claude never writes quota to disk on its own: cachedUsageUtilization in ~/.claude.json
 * did not refresh across two sessions in a day and sat five days stale, and no hook payload
 * carries rate_limits (14 records across SessionStart / PostToolUse / TaskCreated /
 * TaskCompleted / Stop — zero hits).
 *
 * The one channel is the statusLine command, which Claude Code invokes about every 10s
 * even while idle. It renders whatever the command prints, so a command that prints NOTHING
 * is a silent collector: verified to keep firing with the footer unchanged. bin/install-
 * collector.mjs installs it; it writes one file per session here.
 */
export const claudeDir = () => join(stateDir(), "claude")

const window = (raw: any, id: string, label: string, minutes: number): QuotaWindow | null => {
  if (!raw || typeof raw !== "object") return null
  const pct = typeof raw.used_percentage === "number" ? raw.used_percentage
    : typeof raw.utilization === "number" ? raw.utilization
    : null
  if (pct === null) return null
  return {
    id, label, percent: pct, windowMinutes: minutes,
    resetsAt: typeof raw.resets_at === "number" ? raw.resets_at : null,
    active: true,
  }
}

/**
 * The collector writes one file per Claude session, but quota belongs to the account, so
 * the most recently collected file is the current reading whichever pane is in front.
 */
async function newestPayload(): Promise<any | null> {
  const dir = claudeDir()
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json"))
  let best: any = null
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8").catch(() => null)
    if (!text) continue
    let rec: any
    try { rec = JSON.parse(text) } catch { continue }
    if (!best || (rec._collected_at ?? 0) > (best._collected_at ?? 0)) best = rec
  }
  return best
}

export async function readClaude(): Promise<QuotaSnapshot | null> {
  const rec = await newestPayload()
  if (!rec) return null

  const rl = rec.rate_limits
  // rate_limits is absent until a session's first API response. That is a real state the UI
  // must distinguish from "no session" — hence an empty windows array rather than null.
  const windows = rl
    ? [window(rl.five_hour, "five_hour", "5h", 300), window(rl.seven_day, "seven_day", "7d", 10080)]
        .filter((w): w is QuotaWindow => w !== null)
    : []

  return {
    agent: "claude",
    sessionId: typeof rec.session_id === "string" ? rec.session_id : null,
    // The statusLine payload carries no plan field — only the model, which is not quota
    // information and must not be shown as one. If a plan label is ever wanted it comes
    // from `claude auth status --json` (subscriptionType) or ~/.claude.json
    // (oauthAccount.organizationRateLimitTier, which keeps the "20x" detail).
    plan: null,
    windows,
    credits: null,
    observedAt: typeof rec._collected_at === "number" ? rec._collected_at : Date.now(),
    source: "statusline",
  }
}
