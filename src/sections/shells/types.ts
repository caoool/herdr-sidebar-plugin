import type { ProviderKind } from "../../types.js"

/** A shell runs a command; a monitor watches something and keeps running until stopped. */
export type ShellKind = "shell" | "monitor"

/**
 * Something the agent started that is running right now.
 *
 * There is no `finished` variant on purpose. Every source here can distinguish running from
 * finished, and a row that might be either is worse than no row: the whole reason for this
 * section is to see what is still alive, and a stale row would defeat it.
 */
export type Shell = { id: string; kind: ShellKind; command: string }

export type ShellSnapshot = {
  agent: ProviderKind
  running: Shell[]
  observedAt: number
}
