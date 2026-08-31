import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { stateDir } from "../../herdr.js"
import type { ProviderKind } from "../../types.js"
import type { McpSnapshot } from "./types.js"

/**
 * How long a server list may be believed.
 *
 * Claude's check costs about nine and a half seconds and spawns every stdio server it knows
 * about, so it cannot run on the pane's refresh loop at any price. Fifteen minutes is the
 * compromise: long enough that the cost is negligible, short enough that a list which has drifted
 * corrects itself without intervention. Config changes bypass this entirely by invalidating the
 * cache, and the `refresh-mcp` action exists for the case the TTL is built to be bad at — you
 * just authenticated something and want to see it turn green now.
 */
export const TTL: Record<ProviderKind, number> = {
  claude: 15 * 60_000,
  codex: 60_000,
  grok: 60_000,
}

/** A lock older than this is assumed abandoned by a pane that died mid-check. */
const LOCK_STALE = 60_000

export const mcpDir = (): string => join(stateDir(), "mcp")

/**
 * A reading is fresh only inside its TTL, and only if its timestamp is not in the future.
 * Anything else renders as a dash: an expired status is indistinguishable from a wrong one.
 */
export function isFresh(snap: McpSnapshot | null, now: number, agent: ProviderKind): boolean {
  if (!snap || typeof snap.observedAt !== "number") return false
  const age = now - snap.observedAt
  return age >= 0 && age <= TTL[agent]
}

export async function readCached(agent: ProviderKind): Promise<McpSnapshot | null> {
  const text = await readFile(join(mcpDir(), `${agent}.json`), "utf8").catch(() => null)
  if (!text) return null
  try { return JSON.parse(text) as McpSnapshot } catch { return null }
}

/** Written via tmp + rename so a pane never reads a half-written list. */
export async function writeCached(snap: McpSnapshot): Promise<void> {
  await mkdir(mcpDir(), { recursive: true }).catch(() => {})
  const target = join(mcpDir(), `${snap.agent}.json`)
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(snap)).catch(() => {})
  await rename(tmp, target).catch(() => {})
}

/**
 * Take the right to run the check, or decline.
 *
 * Every sidebar pane runs this code, and Claude's check spawns a process per server. Without a
 * lock, opening four sidebars would spawn fifty-two servers at once — the same reasoning that
 * put quota's state behind a single writer.
 */
export async function claimLock(agent: ProviderKind, now: number): Promise<boolean> {
  await mkdir(mcpDir(), { recursive: true }).catch(() => {})
  const path = join(mcpDir(), `${agent}.lock`)
  const held = await stat(path).catch(() => null)
  if (held && now - held.mtimeMs < LOCK_STALE) return false
  await writeFile(path, String(process.pid)).catch(() => {})
  return true
}
