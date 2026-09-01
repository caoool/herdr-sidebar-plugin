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
import { watch, statSync } from "node:fs"
import { agentsInTab, herdrBin, listAgents, resolveSubject, selfPaneId, selfTabId } from "./herdr.js"
import { execFile } from "node:child_process"
import { TERMINAL } from "./ansi.js"
import { autoDismiss } from "./dismiss.js"
import { quotaSection } from "./sections/quota/index.js"
import { sessionSection } from "./sections/session/index.js"
import { toolsSection } from "./sections/tools/index.js"
import type { Section } from "./sections/types.js"
import type { PaneAgent } from "./types.js"
import { compose, type Region, type Span } from "./layout.js"

const SECTIONS: Section[] = [quotaSection(), sessionSection(), toolsSection()]

let subject: PaneAgent | null = null
let dirty = true
/** One scroll position per region, and which region the keys are driving. */
let offsets: number[] = []
let focus = 0
/** Where each region sits on screen, so a wheel event can be attributed to the list under it. */
let spans: Span[] = []
/**
 * Reset the scroll when the pane changes agent — the list underneath is a different session's,
 * so an offset carried over from the last one points at nothing meaningful.
 */
let scrolledFor: string | null = null

/**
 * Exit code asking bin/pane.sh to relaunch us. See that file for why this exists: herdr never
 * relaunches a pane, so without it a sidebar opened before an upgrade runs the old code for
 * as long as it stays open.
 */
const RESTART = 75
const buildStamp = (): number => {
  try { return statSync(process.argv[1]).mtimeMs } catch { return 0 }
}
const startedWith = buildStamp()

/** Opens with an agent, so it leaves with one. See src/dismiss.ts for why this is polled. */
const dismisser = autoDismiss(process.env.HERDR_SIDEBAR_AUTO_CLOSE !== "0", 12_000)

function dismiss() {
  const self = selfPaneId()
  // Ask herdr to close the pane rather than merely exiting: whether a pane disappears when
  // its command ends is herdr's configuration to decide, and this leaves nothing behind.
  if (self) execFile(herdrBin(), ["plugin", "pane", "close", self], () => process.exit(0))
  else process.exit(0)
}

/**
 * The label herdr shows on this pane's tab strip. It matches herdr-plugin.toml's `title`.
 */
const LABEL = "sidebar"

/**
 * Claim the pane's label on every start.
 *
 * herdr stamps a pane's label from the manifest when the pane is *created* and never revisits
 * it, so a sidebar opened before the manifest changed keeps the old name for as long as it
 * stays open — the supervisor in bin/pane.sh replaces this process, not the pane. Renaming
 * ourselves makes the label a property of the running code rather than of whichever install
 * happened to open the pane. Idempotent, so re-claiming it every start costs nothing.
 */
function claimLabel() {
  const self = selfPaneId()
  if (self) execFile(herdrBin(), ["pane", "rename", self, LABEL], () => {})
}

async function refresh() {
  // A reinstall rewrites the bundle underneath us; restart so the new code takes over.
  const stamp = buildStamp()
  if (startedWith && stamp && stamp !== startedWith) process.exit(RESTART)

  const agents = await listAgents().catch(() => [])
  const now = Date.now()
  dismisser.note(agentsInTab(agents, selfTabId()).length > 0, now)
  if (dismisser.ready(now)) return dismiss()
  // Keep the previous subject when the snapshot comes back empty, rather than blanking.
  subject = resolveSubject(agents, selfTabId(), subject)
  const key = subject ? `${subject.agent}:${subject.sessionId}` : null
  if (key !== scrolledFor) {
    offsets = []
    focus = 0
    scrolledFor = key
  }
  await Promise.all(SECTIONS.map((s) => s.refresh({ subject }).catch(() => {})))
  dirty = true
}

function render() {
  if (!dirty) return
  dirty = false
  const width = Math.max(18, (process.stdout.columns ?? 34) - 4)
  const height = Math.max(1, (process.stdout.rows ?? 40) - 2)

  const pinned: string[] = []
  const regions: Region[] = []
  for (const section of SECTIONS) {
    if (section.regions) {
      for (const region of section.regions(width, TERMINAL)) {
        if (region.head.length || region.body.length) regions.push(region)
      }
      continue
    }
    const lines = section.render(width, TERMINAL)
    if (!lines.length) continue
    if (pinned.length) pinned.push("")
    pinned.push(...lines)
  }
  if (pinned.length && regions.length) pinned.push("")

  const composed = compose(pinned, regions, height, width, offsets, focus, TERMINAL)
  offsets = composed.offsets
  spans = composed.spans
  if (focus >= regions.length) focus = 0
  const out = composed.lines
  process.stdout.write("\x1b[2J\x1b[H\n" + out.map((l) => (l ? `  ${l}` : l)).join("\n"))
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

/**
 * Scroll keys.
 *
 * PageUp and PageDown are deliberately absent: herdr binds them for its own scrollback and they
 * never reach this process — verified by sending all three to a live pane and seeing only the
 * arrow and the letter arrive.
 *
 * Raw mode turns off the terminal's own Ctrl-C handling, so it is handled here explicitly;
 * without this the sidebar could not be interrupted from its own pane.
 */
/**
 * The first line of output is a blank spacer and every row is indented, so a line's index in the
 * composed output sits two rows below the top of the screen. Mouse rows are 1-based.
 */
const ROW_OFFSET = 2

/** Which region is under a screen row, or -1 if the row belongs to the pinned block. */
function regionAt(row: number): number {
  const line = row - ROW_OFFSET
  return spans.findIndex((s) => s.start >= 0 && line >= s.start && line <= s.end)
}

/**
 * Wheel events, in SGR mouse form: `ESC [ < button ; column ; row (M|m)`.
 *
 * Buttons 64 and 65 are wheel up and down. The event carries the row it happened on, which is
 * what makes hovering work: the list under the pointer moves, and nothing else does. The pointer
 * also takes focus, so the keys afterwards drive whatever was last scrolled.
 */
const MOUSE = /\x1b\[<(\d+);(\d+);(\d+)[Mm]/g

function onMouse(data: string): boolean {
  let acted = false
  MOUSE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MOUSE.exec(data)) !== null) {
    const button = Number(m[1])
    if (button !== 64 && button !== 65) continue
    const at = regionAt(Number(m[3]))
    if (at < 0) continue
    focus = at
    offsets[at] = (offsets[at] ?? 0) + (button === 64 ? -1 : 1)
    acted = true
  }
  return acted
}

function onKey(chunk: Buffer) {
  const key = chunk.toString("utf8")
  if (key === "\x03") return process.exit(0)
  if (key.includes("\x1b[<")) {
    if (!onMouse(key)) return
    dirty = true
    return render()
  }
  const at = offsets[focus] ?? 0
  if (key === "\t") focus += 1
  else if (key === "\x1b[A" || key === "k") offsets[focus] = at - 1
  else if (key === "\x1b[B" || key === "j") offsets[focus] = at + 1
  else if (key === "g") offsets[focus] = 0
  else if (key === "G") offsets[focus] = Number.MAX_SAFE_INTEGER
  else return
  dirty = true
  render()
}

/**
 * Draw on the alternate screen.
 *
 * Rows that leave the alternate screen never enter herdr's host scrollback, so the pane itself
 * cannot be scrolled — verified by writing a thousand rows to a test pane and reading back
 * `max_offset_from_bottom: 0`, against 124 for the same content on the normal screen. That is
 * what makes per-region scrolling meaningful: the sidebar as a whole stays put, and the only
 * thing that moves is the list the keys are pointed at.
 */
if (process.stdout.isTTY) {
  // Alternate screen, plus SGR mouse reporting so the wheel is delivered here with the row it
  // happened on. Claiming the wheel costs nothing that was working: the alternate screen has no
  // scrollback for herdr's own wheel to move.
  process.stdout.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h")
  // Leaving either mode on would corrupt whatever herdr draws in this pane next.
  const restore = () => {
    try { process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?1049l") } catch { /* already gone */ }
  }
  process.on("exit", restore)
  process.on("SIGTERM", () => { restore(); process.exit(0) })
  process.on("SIGHUP", () => { restore(); process.exit(0) })
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", onKey)
  // Leaving a terminal in raw mode would corrupt whatever herdr draws in this pane next.
  process.on("exit", () => { try { process.stdin.setRawMode(false) } catch { /* already gone */ } })
}

claimLabel()
refresh().then(render)
