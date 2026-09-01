import { tailLines } from "../../../tail.js"
import type { Shell } from "../types.js"

const CALLS = ["custom_tool_call", "function_call", "local_shell_call"]
const OUTPUTS = ["custom_tool_call_output", "function_call_output", "local_shell_call_output"]

/**
 * Codex writes a call record when it starts a command and an output record when it finishes, both
 * carrying the same `call_id`. A call with no output is therefore still running.
 *
 * Verified live: while `sleep 45` was running the rollout held one unmatched call, and the moment
 * the command exited its output landed and the count fell to zero — disk agreeing with the
 * process table within five seconds.
 *
 * `status` is NOT used, and that is deliberate: it read `"completed"` on the call that was still
 * running. Trusting it would mark every live command as finished.
 */
export function runningIn(lines: string[]): Shell[] {
  const calls = new Map<string, Shell>()
  const done = new Set<string>()

  for (const line of lines) {
    if (!line.includes("call_id")) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    const p = d?.payload
    const id = p?.call_id
    if (!p || typeof id !== "string") continue

    if (CALLS.includes(p.type)) calls.set(id, { id, kind: "shell", command: commandIn(p) })
    else if (OUTPUTS.includes(p.type)) done.add(id)
  }

  return [...calls.values()].filter((s) => !done.has(s.id))
}

/**
 * Recover the command from a call record.
 *
 * Codex's code-mode wraps the call in a line of JavaScript —
 * `const r = await tools.exec_command({cmd:"sleep 45","workdir":…})` — so the command is a field
 * inside a source string rather than a value in a structured argument. Older shapes pass JSON
 * arguments instead, and both are handled: whatever cannot be read yields an empty string, which
 * the formatter renders as a bare row rather than inventing a plausible command.
 */
export function commandIn(payload: any): string {
  const source = typeof payload?.input === "string" ? payload.input
    : typeof payload?.arguments === "string" ? payload.arguments
    : ""

  const quoted = /\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(source)
  if (quoted) return quoted[1].replace(/\\"/g, '"')

  if (source.trim().startsWith("{")) {
    try {
      const args = JSON.parse(source)
      const cmd = args?.cmd ?? args?.command
      if (typeof cmd === "string") return cmd
      if (Array.isArray(cmd)) return cmd.join(" ")
    } catch { /* fall through to nothing */ }
  }
  return ""
}

const ROLLOUT_TAIL = 512 * 1024

export async function readCodexShells(rolloutPath: string): Promise<Shell[]> {
  return runningIn(await tailLines(rolloutPath, ROLLOUT_TAIL))
}
