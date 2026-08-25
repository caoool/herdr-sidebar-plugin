/**
 * The sidebar pane process.
 *
 * herdr plugin v1 has no UI API, so this is an ordinary terminal program that herdr launches
 * as a right-hand split. It is the only long-lived process the plugin gets: it starts when
 * the pane opens and dies when it closes.
 *
 * The pane owns no data. It resolves which agent this pane belongs to, drives each section's
 * refresh, and stacks their output. Sections own their sources and their rendering, so
 * adding MCP status or the task list is a new directory under src/sections and one entry
 * in SECTIONS.
 *
 * Rendering is deliberately plain text so the skeleton runs end to end. Swap it for the
 * @opentui/solid components from opencode-cpa-quota-plugin — OpenTUI is a standalone library
 * (native Zig core, node entry point), so those components do not need rewriting, only
 * remounting in this process instead of opencode's TuiPluginApi.
 */
import { watch } from "node:fs"
import { listAgents, resolveSubject, selfTabId } from "./herdr.js"
import { TERMINAL } from "./ansi.js"
import { quotaSection } from "./sections/quota/index.js"
import type { Section } from "./sections/types.js"
import type { PaneAgent } from "./types.js"

const SECTIONS: Section[] = [quotaSection()]

let subject: PaneAgent | null = null
let dirty = true

async function refresh() {
  // Keep the previous subject when the snapshot comes back empty, rather than blanking.
  subject = resolveSubject(await listAgents().catch(() => []), selfTabId(), subject)
  await Promise.all(SECTIONS.map((s) => s.refresh({ subject }).catch(() => {})))
  dirty = true
}

function render() {
  if (!dirty) return
  dirty = false
  const width = Math.max(18, (process.stdout.columns ?? 34) - 4)
  const out: string[] = []
  for (const section of SECTIONS) {
    const lines = section.render(width, TERMINAL)
    if (!lines.length) continue
    if (out.length) out.push("")
    out.push(...lines)
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
for (const target of new Set(SECTIONS.flatMap((s) => s.watch()))) {
  try { watch(target, { persistent: false, recursive: true }, bump) } catch { /* not present yet */ }
}

// A slow tick covers what the watchers cannot: a directory that did not exist at startup, a
// platform without recursive watching, and a change of subject when focus moves.
setInterval(() => refresh().then(render), 5000)
process.stdout.on("resize", () => { dirty = true; render() })
refresh().then(render)
