import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { tailLines } from "../../../tail.js"

/**
 * Claude's session facts, read from what Claude itself writes, rather than from the statusLine
 * collector.
 *
 * The collector only runs while a status line is configured, and configuring one costs a
 * permanent row of terminal — Claude draws the status line on its own line and puts the `/rc`
 * badge there. Everything the panel showed from that payload is available elsewhere, so removing
 * the status line does not have to mean losing the session block.
 *
 * The one thing genuinely absent is the context window's *size*. The transcript records how many
 * tokens a turn used but never what the limit is, so the denominator has to come from the model,
 * and that is inference rather than observation — see `windowFor`.
 */

const PROJECTS = join(homedir(), ".claude", "projects")
const SESSIONS = join(homedir(), ".claude", "sessions")

/**
 * The transcript for a session, found by searching rather than by rebuilding Claude's directory
 * naming. The project directory is the cwd with its separators replaced, and reproducing that
 * exactly (for paths with dots, symlinks, or non-ASCII) is more fragile than looking.
 */
export async function transcriptFor(sessionId: string): Promise<string | null> {
  for (const project of await readdir(PROJECTS, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue
    const candidate = join(PROJECTS, project.name, `${sessionId}.jsonl`)
    const found = await readFile(candidate, "utf8").then(() => true).catch(() => false)
    if (found) return candidate
  }
  return null
}

/** The name Claude gave this session, from the file it keeps per running process. */
export async function nameFor(sessionId: string): Promise<string | null> {
  for (const entry of await readdir(SESSIONS).catch(() => [])) {
    if (!entry.endsWith(".json")) continue
    const text = await readFile(join(SESSIONS, entry), "utf8").catch(() => null)
    if (!text) continue
    try {
      const d = JSON.parse(text)
      if (d?.sessionId === sessionId && typeof d.name === "string") return d.name
    } catch { /* a half-written file is skipped */ }
  }
  return null
}

export type FromTranscript = {
  model: string | null
  effort: string | null
  usedTokens: number | null
  cwd: string | null
}

/**
 * The newest turn's facts.
 *
 * Context used is the input side of the last turn — fresh input, plus what was cached and read
 * back. Output tokens are deliberately excluded: they are what the model produced, not what the
 * window is holding, and counting them would overstate the usage.
 */
export function latestIn(lines: string[]): FromTranscript {
  const out: FromTranscript = { model: null, effort: null, usedTokens: null, cwd: null }
  for (const line of lines) {
    if (!line.includes('"model"')) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const message = d?.message
    if (typeof message?.model !== "string") continue

    out.model = message.model
    if (typeof d.effort === "string") out.effort = d.effort
    if (typeof d.cwd === "string") out.cwd = d.cwd

    const usage = message.usage
    if (usage) {
      const used =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      out.usedTokens = used > 0 ? used : null
    }
  }
  return out
}

/**
 * Turn a model id into a display name, the way the payload's `display_name` did.
 * `claude-opus-5` becomes `Opus 5`; anything unrecognised is passed through unchanged rather
 * than mangled into something that looks official.
 */
export function displayName(modelId: string | null): string | null {
  if (!modelId) return null
  const m = /^claude-(opus|sonnet|haiku|fable)-([\d.]+)/.exec(modelId)
  if (!m) return modelId
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`
}

/**
 * The context window a model is running with.
 *
 * This is the one figure that is inferred rather than read: the transcript records what a turn
 * consumed but never the limit. The long-context variant is recorded separately by Claude as a
 * `[1m]` suffix on the model id wherever it tracks per-model usage, which is what distinguishes
 * the two. A model that is not recognised yields null, and the panel shows a dash — the window
 * is not guessed at, because a wrong denominator would put every percentage out.
 */
export function windowFor(modelId: string | null, longContext: boolean): number | null {
  if (!modelId) return null
  if (longContext) return 1_000_000
  if (/^claude-(opus|sonnet)-/.test(modelId)) return 200_000
  if (/^claude-haiku-/.test(modelId)) return 200_000
  return null
}

/** Whether this project has been running the long-context variant of the model. */
export async function usesLongContext(cwd: string | null): Promise<boolean> {
  if (!cwd) return false
  const text = await readFile(join(homedir(), ".claude.json"), "utf8").catch(() => null)
  if (!text) return false
  try {
    const projects = JSON.parse(text)?.projects ?? {}
    const usage = projects[cwd]?.lastModelUsage ?? {}
    return Object.keys(usage).some((id) => id.includes("[1m]"))
  } catch {
    return false
  }
}

/** How much of the transcript to read for the newest turn. */
const TAIL_BYTES = 512 * 1024

export async function readFromTranscript(sessionId: string): Promise<
  (FromTranscript & { transcriptPath: string; name: string | null; windowSize: number | null }) | null
> {
  const transcriptPath = await transcriptFor(sessionId)
  if (!transcriptPath) return null

  const latest = latestIn(await tailLines(transcriptPath, TAIL_BYTES))
  const windowSize = windowFor(latest.model, await usesLongContext(latest.cwd))
  return { ...latest, transcriptPath, name: await nameFor(sessionId), windowSize }
}
