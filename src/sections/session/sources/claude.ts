import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { claudeDir } from "../../quota/sources/claude.js"
import { displayName, readFromTranscript } from "./claude-transcript.js"
import { permissionFromScreen, sandboxFromSettings } from "./claude-live.js"
import { outputSpeed } from "./claude-speed.js"
import { effortPreset } from "./claude-effort.js"
import { cleanModelName } from "../format.js"
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

/**
 * The session block without a status line.
 *
 * Same fields, different sources: the model, effort and token usage come from the transcript,
 * the name from the file Claude keeps per process, the permission mode from the screen as
 * before. Only the context window's *size* is not recorded anywhere, so it is derived from the
 * model — and when the model is unrecognised the percentage is left null rather than divided by
 * a guess.
 */
async function fromTranscript(sessionId: string, paneId?: string): Promise<SessionInfo | null> {
  const t = await readFromTranscript(sessionId).catch(() => null)
  if (!t) return null

  const permissionMode = (paneId ? await permissionFromScreen(paneId).catch(() => null) : null) ?? null
  const usedPercent =
    t.usedTokens !== null && t.windowSize
      ? Math.round((t.usedTokens / t.windowSize) * 100)
      : null

  return {
    agent: "claude",
    sessionId,
    name: t.name,
    model: cleanModelName(displayName(t.model)),
    effort: (await effortPreset(t.transcriptPath, sessionId, t.effort).catch(() => null)) ?? t.effort,
    permissionMode,
    permissionModeIsGlobal: false,
    sandboxEnabled: await sandboxFromSettings(t.cwd).catch(() => null),
    context: t.usedTokens === null && t.windowSize === null
      ? null
      : { usedPercent, windowSize: t.windowSize },
    outputPerSecond: await outputSpeed(t.transcriptPath).catch(() => null),
    observedAt: Date.now(),
  }
}

export async function readClaudeSession(sessionId: string, paneId?: string): Promise<SessionInfo | null> {
  const text = await readFile(join(claudeDir(), `${sessionId}.json`), "utf8").catch(() => null)
  // No collector payload means no status line is configured. Everything the payload carried is
  // available from what Claude writes anyway, so the block is rebuilt from that rather than
  // disappearing — see sources/claude-transcript.ts.
  if (!text) return fromTranscript(sessionId, paneId)
  let d: any
  try { d = JSON.parse(text) } catch { return fromTranscript(sessionId, paneId) }

  const cw = d.context_window ?? {}

  // The screen is the only live source — no hook fires when the mode is cycled — so it wins.
  // The hook-written file is the fallback for when the footer is covered by a dialog.
  const modeText = await readFile(join(claudeDir(), `${sessionId}.mode.json`), "utf8").catch(() => null)
  let fromHook: string | null = null
  if (modeText) {
    try { fromHook = JSON.parse(modeText).permission_mode ?? null } catch { /* ignore */ }
  }
  const permissionMode = (paneId ? await permissionFromScreen(paneId).catch(() => null) : null) ?? fromHook

  const sandboxEnabled = await sandboxFromSettings(typeof d.cwd === "string" ? d.cwd : null).catch(() => null)

  return {
    agent: "claude",
    sessionId,
    name: typeof d.session_name === "string" ? d.session_name : null,
    model: cleanModelName(d.model?.display_name ?? d.model?.id ?? null),
    // The preset when there is one worth naming — "ultracode" runs at xhigh, and the payload
    // reports only the level — otherwise the level itself.
    effort: (typeof d.transcript_path === "string"
      ? await effortPreset(d.transcript_path, sessionId, d.effort?.level ?? null).catch(() => null)
      : null) ?? d.effort?.level ?? null,
    permissionMode,
    permissionModeIsGlobal: false,
    // Derived from layered settings rather than the payload, which has no sandbox field.
    sandboxEnabled,
    context:
      typeof cw.context_window_size === "number" || typeof cw.used_percentage === "number"
        ? {
            usedPercent: typeof cw.used_percentage === "number" ? cw.used_percentage : null,
            windowSize: typeof cw.context_window_size === "number" ? cw.context_window_size : null,
          }
        : null,
    outputPerSecond: typeof d.transcript_path === "string"
      ? await outputSpeed(d.transcript_path).catch(() => null)
      : null,
    observedAt: typeof d._collected_at === "number" ? d._collected_at : Date.now(),
  }
}
