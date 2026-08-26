import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { tailLines } from "../../../tail.js"
import type { SessionInfo } from "../types.js"

const GROK = join(homedir(), ".grok")
const SESSIONS = join(GROK, "sessions")

/**
 * Grok keeps a directory per session, under a percent-encoded copy of the cwd:
 *
 *   ~/.grok/sessions/%2FUsers%2Flu/<session-id>/summary.json
 *                                              /updates.jsonl
 *
 * summary.json holds the session's configuration — current_model_id, reasoning_effort,
 * sandbox_profile — and updates.jsonl streams the turns. Rather than reconstruct the encoding
 * (which has its own rules for long or non-ASCII paths), the id is searched for directly; there
 * are few enough cwd buckets that this is cheaper than getting the encoding subtly wrong.
 */
async function sessionDir(sessionId: string): Promise<string | null> {
  for (const bucket of await readdir(SESSIONS, { withFileTypes: true }).catch(() => [])) {
    if (!bucket.isDirectory()) continue
    const candidate = join(SESSIONS, bucket.name, sessionId)
    if (await stat(candidate).then((s) => s.isDirectory()).catch(() => false)) return candidate
  }
  return null
}

/** Context windows are per model and live in the cache Grok refreshes on startup. */
async function contextWindowFor(modelId: string | null): Promise<number | null> {
  if (!modelId) return null
  const text = await readFile(join(GROK, "models_cache.json"), "utf8").catch(() => null)
  if (!text) return null
  try {
    const models = JSON.parse(text).models ?? {}
    const w = models[modelId]?.info?.context_window
    return typeof w === "number" ? w : null
  } catch { return null }
}

/**
 * Grok is the only agent that reports a response's own duration, so its rate is the least
 * approximate of the three: `turn_completed` carries outputTokens beside the apiDurationMs
 * that produced them.
 */
function fromUpdates(lines: string[]): { totalTokens: number | null; perSecond: number | null } {
  let totalTokens: number | null = null
  let perSecond: number | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes("otalTokens") && !line.includes("usage")) continue
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }
    const update = rec?.params?.update
    const meta = rec?.params?._meta

    if (totalTokens === null && typeof meta?.totalTokens === "number") totalTokens = meta.totalTokens
    if (perSecond === null && update?.sessionUpdate === "turn_completed") {
      const u = update.usage
      if (typeof u?.outputTokens === "number" && typeof u?.apiDurationMs === "number" && u.apiDurationMs > 0) {
        perSecond = u.outputTokens / (u.apiDurationMs / 1000)
      }
      if (totalTokens === null && typeof u?.totalTokens === "number") totalTokens = u.totalTokens
    }
    if (totalTokens !== null && perSecond !== null) break
  }
  return { totalTokens, perSecond }
}

export async function readGrokSession(sessionId: string): Promise<SessionInfo | null> {
  const dir = await sessionDir(sessionId)
  if (!dir) return null

  const summaryText = await readFile(join(dir, "summary.json"), "utf8").catch(() => null)
  let summary: any = {}
  if (summaryText) { try { summary = JSON.parse(summaryText) } catch { /* keep defaults */ } }

  const model = typeof summary.current_model_id === "string" ? summary.current_model_id : null
  const windowSize = await contextWindowFor(model)
  const { totalTokens, perSecond } = fromUpdates(await tailLines(join(dir, "updates.jsonl")))

  // Grok's permission mode lives only in machine-wide config; the running session may have been
  // started with a flag that overrode it, so it is reported as the weaker claim that it is.
  let permissionMode: string | null = null
  const config = await readFile(join(GROK, "config.toml"), "utf8").catch(() => null)
  const match = config?.match(/^\s*permission_mode\s*=\s*"([^"]+)"/m)
  if (match) permissionMode = match[1]

  return {
    agent: "grok",
    sessionId,
    model,
    effort: typeof summary.reasoning_effort === "string" ? summary.reasoning_effort : null,
    permissionMode,
    permissionModeIsGlobal: true,
    // Grok names a profile; "off" is the only one that means unsandboxed.
    sandboxEnabled:
      typeof summary.sandbox_profile === "string"
        ? summary.sandbox_profile.toLowerCase() !== "off"
        : null,
    context:
      windowSize || totalTokens !== null
        ? {
            usedPercent: totalTokens !== null && windowSize ? Math.min(100, (totalTokens / windowSize) * 100) : null,
            windowSize,
          }
        : null,
    outputPerSecond: perSecond,
    observedAt: Date.parse(summary.last_active_at ?? summary.updated_at ?? "") || Date.now(),
  }
}
