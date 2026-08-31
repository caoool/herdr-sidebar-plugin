import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { tailLines } from "../../../tail.js"
import { codexSessionName } from "./codex-name.js"
import type { SessionInfo } from "../types.js"

const ROOT = join(homedir(), ".codex", "sessions")

/**
 * Codex is the most forthcoming of the three: everything this section needs is already in the
 * rollout it writes while it runs, so nothing has to be installed, called or configured.
 *
 *   turn_context            model, effort, approval_policy, sandbox_policy — re-emitted per turn
 *   event_msg/task_started  model_context_window
 *   event_msg/token_count   info.total_token_usage (cumulative) and info.last_token_usage
 *
 * The rollout filename carries the session uuid, so the pane's own session is addressed
 * directly rather than guessed from mtime.
 */
export async function rolloutFor(sessionId: string): Promise<string | null> {
  const stack = [ROOT]
  let best: { path: string; mtime: number } | null = null
  while (stack.length) {
    const dir = stack.pop()!
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      if (!e.name.startsWith("rollout-") || !e.name.endsWith(".jsonl")) continue
      if (!e.name.includes(sessionId)) continue
      const s = await stat(p).catch(() => null)
      if (s && (!best || s.mtimeMs > best.mtime)) best = { path: p, mtime: s.mtimeMs }
    }
  }
  return best?.path ?? null
}

/**
 * Codex names a policy rather than a flag. Every policy constrains the agent except
 * `danger-full-access`, which is the one that explicitly does not — so that is the only value
 * reported as unsandboxed.
 */
function sandboxEnabledFrom(policy: any): boolean | null {
  const kind = policy?.type ?? policy?.kind
  if (typeof kind !== "string") return null
  return kind !== "danger-full-access"
}

export async function readCodexSession(sessionId: string): Promise<SessionInfo | null> {
  const path = await rolloutFor(sessionId)
  if (!path) return null
  const lines = await tailLines(path, 512 * 1024)

  let turn: any = null
  let windowSize: number | null = null
  const counts: Array<{ at: number; total: number; last: number }> = []

  for (const line of lines) {
    if (!line.startsWith("{")) continue
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }
    const at = Date.parse(rec.timestamp ?? "") || 0

    if (rec.type === "turn_context") turn = rec.payload
    const p = rec.payload
    if (p?.type === "task_started" && typeof p.model_context_window === "number") {
      windowSize = p.model_context_window
    }
    if (p?.type === "token_count" && p.info) {
      const total = p.info.total_token_usage?.output_tokens
      const last = p.info.last_token_usage?.total_tokens
      if (typeof p.info.model_context_window === "number") windowSize = p.info.model_context_window
      if (typeof total === "number") counts.push({ at, total, last: typeof last === "number" ? last : 0 })
    }
  }
  if (!turn && !counts.length) return null

  const latest = counts[counts.length - 1]
  const previous = counts[counts.length - 2]

  // Output tokens produced between the two most recent reports, over the elapsed time. Codex
  // gives no per-response duration, so this spans tool execution as well as generation and is
  // throughput rather than raw generation speed.
  let outputPerSecond: number | null = null
  if (latest && previous && latest.at > previous.at) {
    const tokens = latest.total - previous.total
    const seconds = (latest.at - previous.at) / 1000
    if (tokens > 0 && seconds > 0) outputPerSecond = tokens / seconds
  }

  const usedPercent =
    latest && windowSize ? Math.min(100, (latest.last / windowSize) * 100) : null

  return {
    agent: "codex",
    sessionId,
    name: await codexSessionName(sessionId).catch(() => null),
    model: typeof turn?.model === "string" ? turn.model : null,
    effort: typeof turn?.effort === "string" ? turn.effort : null,
    permissionMode: typeof turn?.approval_policy === "string" ? turn.approval_policy : null,
    permissionModeIsGlobal: false,
    sandboxEnabled: sandboxEnabledFrom(turn?.sandbox_policy),
    context: windowSize || usedPercent !== null ? { usedPercent, windowSize } : null,
    outputPerSecond,
    observedAt: latest?.at || Date.now(),
  }
}
