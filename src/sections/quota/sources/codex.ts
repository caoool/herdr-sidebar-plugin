import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { tailLines } from "../../../tail.js"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"

const ROOT = join(homedir(), ".codex", "sessions")

/**
 * Codex needs no configuration at all: it appends its own rate-limit state to the session
 * rollout as it works. Verified live-append — 6 token_count events across 13 minutes with
 * used_percent moving 3.0 -> 4.0 inside one session.
 *
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<session-uuid>.jsonl
 *   {"type":"event_msg","payload":{"type":"token_count","rate_limits":{...}}}
 *
 * Quota is a property of the account, not of a session, so the newest rollout across all
 * sessions is the current reading regardless of which pane is in front.
 */
async function newestRollout(): Promise<string | null> {
  const stack = [ROOT]
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

/** Codex reports the window length; render a label from it rather than assuming 5h/7d. */
const labelFor = (minutes: number | null | undefined): string => {
  if (!minutes) return "window"
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

const toWindow = (raw: any, id: string): QuotaWindow | null => {
  if (!raw || typeof raw !== "object") return null
  const percent = typeof raw.used_percent === "number" ? raw.used_percent : null
  if (percent === null) return null
  return {
    id,
    label: labelFor(raw.window_minutes),
    percent,
    resetsAt: typeof raw.resets_at === "number" ? raw.resets_at : null,
    windowMinutes: typeof raw.window_minutes === "number" ? raw.window_minutes : null,
    active: true,
  }
}

export async function readCodex(): Promise<QuotaSnapshot | null> {
  const path = await newestRollout()
  if (!path) return null
  const lines = await tailLines(path)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let rec: any
    try { rec = JSON.parse(lines[i]) } catch { continue }
    const rl = rec?.payload?.rate_limits
    if (!rl) continue
    const windows = [toWindow(rl.primary, "primary"), toWindow(rl.secondary, "secondary")]
      .filter((w): w is QuotaWindow => w !== null)
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
