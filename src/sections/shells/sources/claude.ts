import { execFile } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { SAFE_CWD } from "../../../run.js"
import type { Shell } from "../types.js"

const run = promisify(execFile)

export const CLAUDE_SESSIONS = join(homedir(), ".claude", "sessions")

/** Every shell Claude starts is a zsh that first sources this session's snapshot. */
const SNAPSHOT = "/.claude/shell-snapshots/snapshot-"

/**
 * Claude is the one agent whose running shells are not recoverable from disk.
 *
 * Its task files cannot be trusted: a finished foreground shell whose output exceeded the
 * mirroring threshold is left with no exit trailer and no process, byte-identical to a running
 * background one — six such phantoms were sitting in the live task root when this was written.
 * Task roots are never cleaned up, and a fifth of the entries are symlinks into transcripts.
 * `claude agents --json` and the on-disk job state disagreed with each other and were a week old.
 *
 * A pid that exists is the only claim that cannot be stale, so this reads the process table. The
 * filter on the snapshot signature is mandatory rather than cosmetic: the session process also
 * parents `caffeinate` and every MCP server it started, none of which are shells the user ran.
 */
export function runningShells(psOutput: string, sessionPid: number): Shell[] {
  const rows: Array<{ pid: number; ppid: number; args: string }> = []
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] })
  }

  // Descendants, not just children: a shell may sit under an intermediate process.
  const byParent = new Map<number, typeof rows>()
  for (const row of rows) {
    const kin = byParent.get(row.ppid) ?? []
    kin.push(row)
    byParent.set(row.ppid, kin)
  }
  const seen = new Set<number>()
  const stack = [sessionPid]
  const descendants: typeof rows = []
  while (stack.length) {
    const pid = stack.pop()!
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      descendants.push(child)
      stack.push(child.pid)
    }
  }

  return descendants
    .filter((row) => row.args.includes(SNAPSHOT))
    .map((row) => ({ id: String(row.pid), kind: "shell" as const, command: commandIn(row.args) }))
}

/**
 * The command the user's agent actually ran, out of the wrapper it runs inside.
 *
 * Claude wraps every shell as `zsh -c source <snapshot> … && eval '<command>' < /dev/null && …`,
 * so the command is a quoted argument in the middle of a much longer line. Without this the row
 * would show three hundred characters of boilerplate identical for every shell.
 */
export function commandIn(args: string): string {
  const start = args.indexOf("eval '")
  if (start < 0) return ""
  const rest = args.slice(start + "eval '".length)
  const end = rest.indexOf("' < /dev/null")
  const body = end < 0 ? rest : rest.slice(0, end)
  return body.replace(/\\012/g, " ").replace(/\s+/g, " ").trim()
}

/** The pid of the Claude process running this session, from the file it keeps per pid. */
export async function sessionPidFor(sessionId: string): Promise<number | null> {
  for (const name of await readdir(CLAUDE_SESSIONS).catch(() => [])) {
    if (!name.endsWith(".json")) continue
    const text = await readFile(join(CLAUDE_SESSIONS, name), "utf8").catch(() => null)
    if (!text) continue
    try {
      const d = JSON.parse(text)
      if (d?.sessionId === sessionId && typeof d.pid === "number") return d.pid
    } catch { /* a half-written file is skipped */ }
  }
  return null
}

export async function readClaudeShells(sessionId: string): Promise<Shell[]> {
  const pid = await sessionPidFor(sessionId)
  if (pid === null) return []
    // -ww is not optional: ps truncates the args column to the terminal width, and this runs
  // inside a 34-column sidebar. Without it every command is cut off long before the snapshot
  // path that identifies it, so the filter matches nothing and the section reports no shells
  // while shells are plainly running — which is exactly what it did.
  const { stdout } = await run("ps", ["-Awwo", "pid,ppid,args"], {
    cwd: SAFE_CWD,
    timeout: 5_000,
    maxBuffer: 8 << 20,
  }).catch(() => ({ stdout: "" }))
  return stdout ? runningShells(stdout, pid) : []
}
