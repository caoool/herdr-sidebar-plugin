import { readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { homedir } from "node:os"
import { herdrBin } from "../../../herdr.js"

const run = promisify(execFile)

/**
 * Claude's footer labels, in the order the shift+tab cycle presents them, mapped to the values
 * the permission-mode vocabulary actually uses. "Manual" is reported as `default`.
 */
const FOOTER_MODES: Array<[RegExp, string]> = [
  [/\bbypass permissions\b/i, "bypassPermissions"],
  [/\baccept edits\b/i, "acceptEdits"],
  [/\bdon['’]t ask\b/i, "dontAsk"],
  [/\bplan mode\b/i, "plan"],
  [/\bauto mode\b/i, "auto"],
]

/**
 * Read the permission mode off Claude's own footer.
 *
 * No hook fires when the mode is cycled — `ConfigChange` covers config *files*, and shift+tab
 * is in-memory — so a hook-written value is only as fresh as the session's last prompt or tool
 * call. Cycling and then sitting still left the sidebar showing the old mode indefinitely.
 *
 * Claude does redraw its footer immediately, so the pane's screen is the only live source. A
 * match is trusted; no match returns null rather than assuming "default", because the footer is
 * also absent while a dialog or permission prompt covers it, and inventing a mode there would
 * be worse than briefly deferring to the hook.
 */
export async function permissionFromScreen(paneId: string): Promise<string | null> {
  const { stdout } = await run(herdrBin(), ["pane", "read", paneId, "--source", "visible", "--lines", "6"], {
    maxBuffer: 1 << 20,
  }).catch(() => ({ stdout: "" }))
  if (!stdout) return null
  for (const [pattern, mode] of FOOTER_MODES) {
    if (pattern.test(stdout)) return mode
  }
  return null
}

/**
 * Whether Claude's bash sandbox is enabled.
 *
 * Not in the statusLine payload — the documented field list has no sandbox entry — but it is
 * derivable from the same layered settings Claude itself reads, nearest scope first. This is
 * the mechanism ccstatusline uses for its own indicator, and it carries ccstatusline's caveat:
 * managed policy or a CLI flag can override these files, so it describes configuration rather
 * than a guaranteed live state.
 *
 * A file that exists but sets nothing means the default, off. No settings file at all means
 * nothing is known, which is reported as unknown rather than off.
 */
export async function sandboxFromSettings(cwd: string | null): Promise<boolean | null> {
  const user = join(homedir(), ".claude")
  const candidates = [
    ...(cwd ? [join(cwd, ".claude", "settings.local.json"), join(cwd, ".claude", "settings.json")] : []),
    join(user, "settings.local.json"),
    join(user, "settings.json"),
  ]
  let anyExisted = false
  for (const path of candidates) {
    const text = await readFile(path, "utf8").catch(() => null)
    if (text === null) continue
    anyExisted = true
    try {
      const enabled = JSON.parse(text)?.sandbox?.enabled
      if (typeof enabled === "boolean") return enabled
    } catch { /* unreadable layer: fall through to the next */ }
  }
  return anyExisted ? false : null
}
