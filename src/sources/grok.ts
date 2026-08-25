import { join } from "node:path"
import { homedir } from "node:os"
import { tailLines } from "../tail.js"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"

export const GROK_LOG = join(homedir(), ".grok", "logs", "unified.jsonl")

/**
 * Grok has no statusLine-equivalent callback — its "status line" is a built-in
 * background-task indicator, and its only configurable surface is Claude-style hooks in
 * ~/.grok/hooks/*.json. What it does give free is its own log: the CLI fetches billing
 * during a session and records the response.
 *
 *   {"msg":"billing: fetched credits config",
 *    "ctx":{"config":{currentPeriod:{type,start,end}, onDemandCap, onDemandUsed,
 *                     prepaidBalance, isUnifiedBillingUser, billingPeriodEnd},
 *           "subscriptionTier":"SuperGrok Heavy"}}
 *
 * NOTE the omission. On a unified-billing account this payload carries NO
 * `creditUsagePercent` — grepping every Grok log, that key and `productUsage`,
 * `usagePercent`, `monthlyLimit` appear nowhere. The window is emitted with percent: null
 * so the UI renders a period with no figure. It is never coerced to 0: that is what made
 * the previous sidebar show a permanent, confident zero.
 *
 * The log is account-wide rather than per-session, which is what quota actually is.
 */
export async function readGrok(): Promise<QuotaSnapshot | null> {
  const lines = await tailLines(GROK_LOG)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("billing:")) continue
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    const ctx = rec?.ctx
    const cfg = ctx?.config
    if (!cfg) continue

    const period = cfg.currentPeriod ?? cfg.current_period ?? {}
    const end = Date.parse(period.end ?? cfg.billingPeriodEnd ?? "")
    const start = Date.parse(period.start ?? cfg.billingPeriodStart ?? "")
    const percent =
      typeof cfg.creditUsagePercent === "number" ? cfg.creditUsagePercent
      : typeof cfg.credit_usage_percent === "number" ? cfg.credit_usage_percent
      : null

    const windows: QuotaWindow[] = [{
      id: "period",
      label: String(period.type ?? "").toLowerCase().includes("weekly") ? "7d" : "period",
      percent,
      resetsAt: Number.isFinite(end) ? Math.floor(end / 1000) : null,
      windowMinutes: Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60000) : null,
      active: true,
    }]

    return {
      agent: "grok",
      sessionId: null,
      plan: ctx.subscriptionTier ?? ctx.subscription_tier ?? null,
      windows,
      credits: cfg.prepaidBalance ? { balance: String(cfg.prepaidBalance.val ?? ""), unlimited: false } : null,
      observedAt: Date.parse(rec.ts ?? "") || Date.now(),
      source: "log",
    }
  }
  return null
}
