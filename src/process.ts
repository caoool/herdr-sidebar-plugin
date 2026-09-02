import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { herdrBin } from "./herdr.js"
import { SAFE_CWD } from "./run.js"
import type { PaneAgent, ProviderKind } from "./types.js"

const run = promisify(execFile)

export type Proc = {
  name?: string
  argv0?: string
  argv?: string[]
  cmdline?: string
}

/**
 * Whether a process is this agent.
 *
 * Basenames only: `/opt/homebrew/bin/grok` and `grok-1.0.13-mac` both count, a cwd
 * path that happens to contain the word does not. The match is the agent id as a
 * prefix (`grok`, `grok-…`) so a versioned binary still counts and `chrome-devtools`
 * does not look like Grok.
 */
export function processIsAgent(kind: ProviderKind, proc: Proc): boolean {
  const names = [proc.name, proc.argv0, ...(proc.argv ?? [])]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => s.split(/[/\\]/).pop()!.toLowerCase())
  return names.some((n) => n === kind || n.startsWith(`${kind}-`) || n.startsWith(`${kind}.`))
}

/**
 * Empty means we could not see the foreground — do not treat that as "the agent
 * quit", or a blip in process-info would close the sidebar on a live session.
 */
export function foregroundIsAgent(kind: ProviderKind, procs: Proc[]): boolean {
  if (!procs.length) return true
  return procs.some((p) => processIsAgent(kind, p))
}

export function parseForeground(raw: string): Proc[] {
  try {
    const procs = JSON.parse(raw)?.result?.process_info?.foreground_processes
    return Array.isArray(procs) ? procs : []
  } catch {
    return []
  }
}

/**
 * Whether any of these panes still has the agent as a live foreground process.
 *
 * herdr's Grok (and others') detection is screen- and title-based. After `/exit`
 * the OSC title often still ends in ` - grok`, so the pane stays in `agents[]`
 * while the foreground has already returned to the shell. That absence from the
 * process table is the signal auto-dismiss can actually trust.
 */
export async function anyLive(agents: PaneAgent[]): Promise<boolean> {
  if (agents.length === 0) return false
  const flags = await Promise.all(agents.map((a) => live(a)))
  return flags.some(Boolean)
}

async function live(agent: PaneAgent): Promise<boolean> {
  const { stdout } = await run(herdrBin(), ["pane", "process-info", "--pane", agent.paneId], {
    cwd: SAFE_CWD,
    timeout: 5_000,
    maxBuffer: 1 << 20,
  }).catch(() => ({ stdout: "" }))
  return foregroundIsAgent(agent.agent, parseForeground(stdout))
}
