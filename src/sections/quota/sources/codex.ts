import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { tailLines } from "../../../tail.js"
import { cached } from "../../../cache.js"
import { isExpired } from "../freshness.js"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"

export const CODEX_SESSIONS = join(homedir(), ".codex", "sessions")

/** A live reading costs a subprocess, so it is fetched at most this often per machine. */
const CACHE_MS = 10 * 60 * 1000

/** Codex reports the window length; render a label from it rather than assuming 5h/7d. */
const labelFor = (minutes: number | null | undefined): string => {
  if (!minutes) return "window"
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

const toWindow = (
  id: string,
  percent: unknown,
  minutes: unknown,
  resetsAt: unknown,
): QuotaWindow | null => {
  if (typeof percent !== "number") return null
  return {
    id,
    label: labelFor(typeof minutes === "number" ? minutes : null),
    percent,
    resetsAt: typeof resetsAt === "number" ? resetsAt : null,
    windowMinutes: typeof minutes === "number" ? minutes : null,
    active: true,
  }
}

async function newestRollout(): Promise<string | null> {
  const stack = [CODEX_SESSIONS]
  let newest: { path: string; mtime: number } | null = null
  while (stack.length) {
    const dir = stack.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      if (!e.name.startsWith("rollout-") || !e.name.endsWith(".jsonl")) continue
      const s = await stat(p).catch(() => null)
      if (s && (!newest || s.mtimeMs > newest.mtime)) newest = { path: p, mtime: s.mtimeMs }
    }
  }
  return newest?.path ?? null
}

/**
 * The free path. Codex appends its own rate-limit state to the session rollout as it works —
 * verified live-append, 6 events across 13 minutes with used_percent moving 3.0 to 4.0 — so
 * while Codex is running this is both current and costless.
 *
 *   {"type":"event_msg","payload":{"type":"token_count","rate_limits":{...}}}   (snake_case)
 */
async function fromRollout(now: number): Promise<QuotaSnapshot | null> {
  const path = await newestRollout()
  if (!path) return null
  const lines = await tailLines(path)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    const rl = rec?.payload?.rate_limits
    if (!rl) continue

    const windows = [
      toWindow("primary", rl.primary?.used_percent, rl.primary?.window_minutes, rl.primary?.resets_at),
      toWindow("secondary", rl.secondary?.used_percent, rl.secondary?.window_minutes, rl.secondary?.resets_at),
    ].filter((w): w is QuotaWindow => w !== null && !isExpired(w, now))
    if (!windows.length) return null

    return {
      agent: "codex",
      sessionId: null,
      plan: typeof rl.plan_type === "string" ? rl.plan_type : null,
      windows,
      credits: rl.credits
        ? { balance: rl.credits.balance ?? null, unlimited: Boolean(rl.credits.unlimited) }
        : null,
      observedAt: Date.parse(rec.timestamp ?? rec.ts ?? "") || Date.now(),
      source: "rollout",
    }
  }
  return null
}

/**
 * The live path, used when no rollout covers the current window.
 *
 * `codex app-server --stdio` speaks JSON-RPC over stdio and answers
 * `account/rateLimits/read` in about a second. Note the casing flips here: the wire protocol
 * is camelCase where the rollout is snake_case.
 *
 * Codex owns the credential, so the sidebar never touches ~/.codex/auth.json. When that token
 * is revoked the call returns a JSON-RPC error, which is reported as no reading rather than
 * as a figure — `codex login` is the fix, and inventing a number would hide that.
 */
function queryAppServer(): Promise<any | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn("codex", ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] })
    } catch { return resolve(null) }

    let buf = ""
    let settled = false
    const done = (v: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(v)
    }
    const timer = setTimeout(() => done(null), 20_000)

    child.on("error", () => done(null))
    child.stdout?.on("data", (chunk) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let msg: any
        try { msg = JSON.parse(line) } catch { continue }
        if (msg?.id !== 2) continue
        // An error here means the account cannot be read at all — usually a revoked token.
        done(msg.error ? null : (msg.result?.rateLimits ?? msg.result ?? null))
      }
    })

    child.stdin?.write(
      JSON.stringify({
        id: 1, method: "initialize",
        params: { clientInfo: { name: "herdr-sidebar", version: "0.1.0" } },
      }) + "\n",
    )
    child.stdin?.write(JSON.stringify({ id: 2, method: "account/rateLimits/read" }) + "\n")
  })
}

async function fromAppServer(now: number): Promise<QuotaSnapshot | null> {
  const rl = await cached<any>("codex-ratelimits.json", CACHE_MS, queryAppServer)
  if (!rl) return null

  const windows = [
    toWindow("primary", rl.primary?.usedPercent, rl.primary?.windowDurationMins, rl.primary?.resetsAt),
    toWindow("secondary", rl.secondary?.usedPercent, rl.secondary?.windowDurationMins, rl.secondary?.resetsAt),
  ].filter((w): w is QuotaWindow => w !== null && !isExpired(w, now))
  if (!windows.length) return null

  return {
    agent: "codex",
    sessionId: null,
    // planType from this call has been observed disagreeing with account/read; it is only a
    // label, so it is carried as-is rather than trusted for anything.
    plan: typeof rl.planType === "string" ? rl.planType : null,
    windows,
    credits: rl.credits
      ? { balance: rl.credits.balance ?? null, unlimited: Boolean(rl.credits.unlimited) }
      : null,
    observedAt: Date.now(),
    source: "api",
  }
}

export async function readCodex(now: number = Date.now()): Promise<QuotaSnapshot | null> {
  return (await fromRollout(now)) ?? (await fromAppServer(now))
}

/** Exported for tests: label derivation and field-shape handling. */
export { toWindow as _toWindow }
