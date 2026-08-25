import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { tailLines } from "../../../tail.js"
import { stateDir } from "../../../herdr.js"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"

export const GROK_LOG = join(homedir(), ".grok", "logs", "unified.jsonl")
const AUTH = join(homedir(), ".grok", "auth.json")
const BILLING = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"

/** One request per this interval per machine, shared by every sidebar pane through the cache. */
const CACHE_MS = 10 * 60 * 1000
const cachePath = () => join(stateDir(), "grok-billing.json")

/**
 * Grok is the one agent that will not hand its figures over for free.
 *
 * It has no statusLine-equivalent callback, and nothing caches billing to disk, so the only
 * route is the same call `/usage` makes:
 *
 *   GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 *   Authorization: Bearer <~/.grok/auth.json ["https://auth.x.ai::<client-id>"].key>
 *
 * Its `billing: fetched credits config` log line looks like a cheaper substitute, but it is a
 * hand-built summary — it prints `historyLen` where the payload has `history`, and drops
 * `topUpMethod` entirely. Close enough to mislead, not close enough to trust, so it is used
 * only as a fallback for tier and period when the call cannot be made.
 *
 * Overhead is one request per CACHE_MS for the whole machine: the result is cached in the
 * plugin state directory, so extra panes cost nothing and a restart starts warm.
 *
 * The token is read fresh on every call and never written back. That file holds a
 * refresh_token, and performing a refresh can rotate it and invalidate the agent's own
 * session — the sidebar must never log the user out of their CLI.
 */
async function readToken(): Promise<string | null> {
  const text = await readFile(AUTH, "utf8").catch(() => null)
  if (!text) return null
  let d: any
  try { d = JSON.parse(text) } catch { return null }
  const key = Object.keys(d).find((k) => k.includes("auth.x.ai"))
  const entry = key ? d[key] : null
  if (!entry) return null
  // expires_at lets us skip a doomed call rather than spend a round trip on a 401.
  if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) return null
  return typeof entry.key === "string" ? entry.key : null
}

async function fetchBilling(): Promise<any | null> {
  const token = await readToken()
  if (!token) return null
  const res = await fetch(BILLING, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-version": "0.2.117",
      Accept: "*/*",
      "User-Agent": "grok-pager/0.2.117 grok-shell/0.2.117",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res || !res.ok) return null
  return await res.json().catch(() => null)
}

/** Cached fetch. Writes atomically so a concurrent reader never sees a partial file. */
async function billing(): Promise<any | null> {
  const path = cachePath()
  const info = await stat(path).catch(() => null)
  if (info && Date.now() - info.mtimeMs < CACHE_MS) {
    const text = await readFile(path, "utf8").catch(() => null)
    if (text) { try { return JSON.parse(text) } catch { /* refetch */ } }
  }
  const fresh = await fetchBilling()
  if (!fresh) return null
  await mkdir(stateDir(), { recursive: true }).catch(() => {})
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(fresh)).catch(() => {})
  await rename(tmp, path).catch(() => {})
  return fresh
}

const num = (v: any): number | null =>
  typeof v === "number" ? v : typeof v?.val === "number" ? v.val : null

/**
 * Percent, matching what Grok's own `/usage` reports.
 *
 * Preference order is the server's figure, then spend against the limit. When neither is
 * present the answer is 0, not null — and that is a deliberate match rather than a guess.
 * Running `/usage` in a live Grok session against this same endpoint prints:
 *
 *   Weekly limit: 0%
 *   Next reset: August 27, 06:45
 *
 * with a `billing: fetched credits config` logged immediately before it. Grok receives the
 * same percent-free payload we do and renders 0%, because on a flat subscription with no
 * pay-as-you-go spend there is nothing metered: onDemandCap and onDemandUsed are both zero.
 * Showing a dash where the vendor shows 0% would misreport the account as unreadable when it
 * is simply unused.
 *
 * A truly unreadable account — no billing payload at all — still yields null upstream, and
 * the window renders without a figure.
 */
function percentOf(cfg: any): number | null {
  const direct = num(cfg.creditUsagePercent ?? cfg.credit_usage_percent)
  if (direct !== null) return direct
  const limit = num(cfg.monthlyLimit ?? cfg.monthly_limit)
  const used = num(cfg.totalUsed ?? cfg.total_used) ?? num(cfg.includedUsed ?? cfg.included_used)
  if (limit && used !== null) return Math.min(100, Math.max(0, (used / limit) * 100))
  const onDemandCap = num(cfg.onDemandCap ?? cfg.on_demand_cap)
  const onDemandUsed = num(cfg.onDemandUsed ?? cfg.on_demand_used)
  if (onDemandCap) return Math.min(100, Math.max(0, ((onDemandUsed ?? 0) / onDemandCap) * 100))
  // Billing answered, nothing is metered: the same 0% Grok itself shows.
  return onDemandUsed === null && onDemandCap === null ? null : 0
}

/** Tier and period without any request — used when the call fails or the token is stale. */
async function fromLog(): Promise<{ cfg: any; tier: string | null; at: number } | null> {
  const lines = await tailLines(GROK_LOG)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("billing:")) continue
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    if (!rec?.ctx?.config) continue
    return {
      cfg: rec.ctx.config,
      tier: rec.ctx.subscriptionTier ?? rec.ctx.subscription_tier ?? null,
      at: Date.parse(rec.ts ?? "") || Date.now(),
    }
  }
  return null
}

export async function readGrok(): Promise<QuotaSnapshot | null> {
  const live = await billing().catch(() => null)
  const fallback = live ? null : await fromLog()
  const cfg = live?.config ?? live ?? fallback?.cfg
  if (!cfg) return null

  const tier = live
    ? (live.subscriptionTier ?? live.subscription_tier ?? null)
    : (fallback?.tier ?? null)

  const period = cfg.currentPeriod ?? cfg.current_period ?? {}
  const end = Date.parse(period.end ?? cfg.billingPeriodEnd ?? "")
  const start = Date.parse(period.start ?? cfg.billingPeriodStart ?? "")

  const windows: QuotaWindow[] = [{
    id: "period",
    label: String(period.type ?? "").toLowerCase().includes("weekly") ? "7d" : "30d",
    percent: percentOf(cfg),
    resetsAt: Number.isFinite(end) ? Math.floor(end / 1000) : null,
    windowMinutes: Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60000) : null,
    active: true,
  }]

  const balance = num(cfg.prepaidBalance ?? cfg.prepaid_balance)

  return {
    agent: "grok",
    sessionId: null,
    plan: tier,
    windows,
    credits: balance === null ? null : { balance: String(balance), unlimited: false },
    observedAt: live ? Date.now() : (fallback?.at ?? Date.now()),
    source: live ? "api" : "log",
  }
}
