import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { claudeDir } from "../../quota/sources/claude.js"
import type { SessionInfo } from "../types.js"

/**
 * Claude's statusLine payload already carries model, effort and context — the collector this
 * plugin installs for quota is picking them up on every sample.
 *
 * Two fields it does not carry, established from the payload builder in the binary rather than
 * inferred from a sample: `permissionMode` is passed *into* the builder but only used to choose
 * which model id to report, and is never emitted; there is no sandbox field at all. Permission
 * mode therefore comes from a hook (bin/mode-hook.sh), and sandbox is reported as unknown
 * rather than guessed.
 */

type Sample = { outputTokens: number; apiMs: number; perSecond: number | null }
const samples = new Map<string, Sample>()

/**
 * Output rate for the most recent response.
 *
 * `context_window.total_output_tokens` is not a cumulative counter — it equals
 * `current_usage.output_tokens` in every session observed, so it is the last response's output
 * and differencing it would be meaningless. What is cumulative is `cost.total_api_duration_ms`,
 * so when the reported output changes, that response's tokens are divided by the API time
 * consumed since the previous sample.
 *
 * The rate is held between responses rather than dropped to null, since "the last response ran
 * at 42 t/s" stays true while the agent sits idle. It is null only until a first response has
 * been seen, which is honest: nothing has been measured yet.
 */
function rateFor(sessionId: string, outputTokens: number, apiMs: number): number | null {
  const previous = samples.get(sessionId)
  let perSecond = previous?.perSecond ?? null

  if (previous && outputTokens !== previous.outputTokens) {
    const seconds = (apiMs - previous.apiMs) / 1000
    if (outputTokens > 0 && seconds > 0) perSecond = outputTokens / seconds
  }
  samples.set(sessionId, { outputTokens, apiMs, perSecond })
  return perSecond
}

export async function readClaudeSession(sessionId: string): Promise<SessionInfo | null> {
  const text = await readFile(join(claudeDir(), `${sessionId}.json`), "utf8").catch(() => null)
  if (!text) return null
  let d: any
  try { d = JSON.parse(text) } catch { return null }

  const cw = d.context_window ?? {}
  const cost = d.cost ?? {}

  // Written by the hook, which fires on tool use and prompt submission. Absent until the
  // session does something, and stale if the user toggles mode and then sits still.
  const modeText = await readFile(join(claudeDir(), `${sessionId}.mode.json`), "utf8").catch(() => null)
  let permissionMode: string | null = null
  if (modeText) {
    try { permissionMode = JSON.parse(modeText).permission_mode ?? null } catch { /* ignore */ }
  }

  return {
    agent: "claude",
    sessionId,
    model: d.model?.display_name ?? d.model?.id ?? null,
    effort: d.effort?.level ?? null,
    permissionMode,
    permissionModeIsGlobal: false,
    // No sandbox field exists in the statusLine payload or the hook payloads.
    sandbox: null,
    context:
      typeof cw.context_window_size === "number" || typeof cw.used_percentage === "number"
        ? {
            usedPercent: typeof cw.used_percentage === "number" ? cw.used_percentage : null,
            windowSize: typeof cw.context_window_size === "number" ? cw.context_window_size : null,
          }
        : null,
    outputPerSecond: rateFor(
      sessionId,
      typeof cw.total_output_tokens === "number" ? cw.total_output_tokens : 0,
      typeof cost.total_api_duration_ms === "number" ? cost.total_api_duration_ms : 0,
    ),
    observedAt: typeof d._collected_at === "number" ? d._collected_at : Date.now(),
  }
}
