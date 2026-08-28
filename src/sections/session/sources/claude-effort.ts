import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { tailLines } from "../../../tail.js"
import { claudeDir } from "../../quota/sources/claude.js"

/**
 * Effort presets that are not themselves levels.
 *
 * `/effort` offers presets as well as raw levels. `ultracode` is the interesting one: it is
 * "xhigh + dynamic workflow orchestration", so the session runs at xhigh and the payload
 * reports xhigh. Every other preset names its own level.
 */
const PRESET_LEVEL: Record<string, string> = { ultracode: "xhigh" }

/** The line `/effort` writes into the transcript when it changes the setting. */
const SET_EFFORT = /Set effort level to (\w[\w-]*)/g

const cachePath = (sessionId: string) => join(claudeDir(), `${sessionId}.effort.json`)

/** Newest match in a batch of lines, or null. Later lines win, since effort can be re-set. */
export function newestIn(lines: string[]): string | null {
  let found: string | null = null
  for (const line of lines) {
    if (!line.includes("Set effort level to")) continue
    SET_EFFORT.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SET_EFFORT.exec(line)) !== null) found = m[1]
  }
  return found
}

/**
 * Scan the whole transcript, once, for a session whose effort was set before the tail window.
 *
 * Streamed rather than read whole: these files reach tens of megabytes, and holding one in
 * memory to find a single line near its start would be wasteful even as a one-off.
 */
async function fullScan(path: string): Promise<string | null> {
  let found: string | null = null
  try {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.includes("Set effort level to")) continue
      SET_EFFORT.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = SET_EFFORT.exec(line)) !== null) found = m[1]
    }
  } catch { return null }
  return found
}

/**
 * The effort *preset* the session is running under, when it differs from the level.
 *
 * The statusLine payload reports only the level — `ultracode` runs at xhigh and is reported as
 * xhigh — and the preset is session-only state that reaches no config file. It is recoverable
 * because `/effort` echoes its result into the transcript as command output:
 *
 *   <local-command-stdout>Set effort level to ultracode (this session only): xhigh + …
 *
 * The tail is checked first, so a change made recently is picked up immediately and supersedes
 * anything older. Only when the tail has no match is the whole file scanned, and that result is
 * remembered per session so the scan happens at most once — a preset set at the start of a long
 * session would otherwise be re-sought on every refresh.
 *
 * `level` is the payload's own reading, used as a consistency check: a remembered preset whose
 * underlying level no longer matches has been superseded by some other route, so it is
 * discarded rather than shown. That keeps the row honest if effort is changed by a means that
 * leaves no transcript line.
 */
export async function effortPreset(
  transcriptPath: string,
  sessionId: string,
  level: string | null,
): Promise<string | null> {
  let preset = newestIn(await tailLines(transcriptPath))

  if (!preset) {
    const cached = await readFile(cachePath(sessionId), "utf8").catch(() => null)
    if (cached) {
      try { preset = JSON.parse(cached).preset ?? null } catch { /* rescan below */ }
    }
    if (!preset) {
      preset = await fullScan(transcriptPath)
      if (preset) {
        await mkdir(claudeDir(), { recursive: true }).catch(() => {})
        const tmp = `${cachePath(sessionId)}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify({ preset })).catch(() => {})
        await rename(tmp, cachePath(sessionId)).catch(() => {})
      }
    }
  }

  return resolvePreset(preset, level)
}

/**
 * Whether a preset found in the transcript is worth showing.
 *
 * A preset that names its own level adds nothing the level does not already say. One that does
 * not — `ultracode` — is shown only while its underlying level still matches what the payload
 * reports; if they have diverged, effort was changed by some route that left no transcript
 * line, and the remembered preset is stale.
 */
export function resolvePreset(preset: string | null, level: string | null): string | null {
  if (!preset) return null
  const underlying = PRESET_LEVEL[preset]
  if (!underlying) return null
  return level === null || underlying === level ? preset : null
}
