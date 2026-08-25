/**
 * The sidebar pane process.
 *
 * herdr plugin v1 has no UI API, so this is an ordinary terminal program that herdr launches
 * as a right-hand split. It is the only long-lived process the plugin gets: it starts when
 * the pane opens and dies when it closes.
 *
 * Rendering here is deliberately plain so the skeleton runs end to end. Swap it for the
 * @opentui/solid components from opencode-cpa-quota-plugin — OpenTUI is a standalone
 * library (native Zig core, node entry point), so those components do not need rewriting,
 * only remounting in this process instead of opencode's TuiPluginApi.
 */
import { watch } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { listAgents, resolveSubject, selfTabId, stateDir } from "./herdr.js"
import { readClaude, claudeDir } from "./sources/claude.js"
import { readCodex } from "./sources/codex.js"
import { readGrok, GROK_LOG } from "./sources/grok.js"
import { block, TERMINAL_STYLE } from "./format.js"
import type { PaneAgent, ProviderKind, QuotaSnapshot } from "./types.js"

const ORDER: ProviderKind[] = ["claude", "codex", "grok"]

let subject: PaneAgent | null = null
let snapshots: Partial<Record<ProviderKind, QuotaSnapshot | null>> = {}
let dirty = true

async function refresh() {
  // Every provider is read every time: quota is account-wide, so a Claude pane shows the
  // Codex and Grok figures too. The pane's own agent is used only to order the blocks.
  const [claude, codex, grok, agents] = await Promise.all([
    readClaude().catch(() => null),
    readCodex().catch(() => null),
    readGrok().catch(() => null),
    listAgents().catch(() => []),
  ])
  snapshots = { claude, codex, grok }
  subject = resolveSubject(agents, selfTabId(), subject)
  dirty = true
}

/** The pane's own agent leads, so the one you are working with sits where your eye starts. */
const ordered = (): ProviderKind[] =>
  subject ? [subject.agent, ...ORDER.filter((a) => a !== subject!.agent)] : ORDER

function render() {
  if (!dirty) return
  dirty = false
  const width = Math.max(18, (process.stdout.columns ?? 34) - 4)
  const out: string[] = []
  for (const agent of ordered()) {
    if (out.length) out.push("")
    out.push(...block(agent, snapshots[agent] ?? null, width, Date.now(), TERMINAL_STYLE))
  }
  process.stdout.write("\x1b[2J\x1b[H\n" + out.map((l) => (l ? `  ${l}` : l)).join("\n") + "\n")
}

// Watch what the agents write rather than polling anything. Debounced because Codex appends
// per turn and the statusLine collector fires every ~10s.
let timer: NodeJS.Timeout | null = null
const bump = () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => refresh().then(render), 200)
}
const watched = [claudeDir(), GROK_LOG, stateDir(), join(homedir(), ".codex", "sessions")]
for (const target of watched) {
  try { watch(target, { persistent: false, recursive: true }, bump) } catch { /* not present yet */ }
}

// A slow tick covers anything the watchers miss — a directory that did not exist at startup,
// or a platform where recursive watching is unavailable.
setInterval(() => refresh().then(render), 5000)
process.stdout.on("resize", () => { dirty = true; render() })
refresh().then(render)
