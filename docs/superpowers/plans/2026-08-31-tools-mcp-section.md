# TOOLS / MCP Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third sidebar section listing every tool the current session has called and every MCP server the pane's agent has configured, inside a scroll region that leaves QUOTA and SESSION pinned.

**Architecture:** A pure `window()` function does the scroll arithmetic; a pure `compose()` splits the pane into a pinned block and a scroll region; `pane.ts` holds the offset and reads keys. The section itself follows the existing `Section` shape — its own sources, its own formatter, one entry in `SECTIONS`.

**Tech Stack:** TypeScript, Node 24 ESM, esbuild bundle, `node:test` + `node:assert/strict`. No third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-tools-mcp-section-design.md`

## Global Constraints

- **No third-party dependencies.** The user runs this on machines where nothing else is installed.
- **Never render a value that might be wrong.** Absent, stale, or unverifiable readings render a dim `—`.
- **Codex never claims connectivity.** `codex mcp list` reports configuration only; its glyphs are `●` enabled / `○` disabled.
- **Styling must never change a row's width.** Measure plain text, then paint. Every formatter test asserts `strip(styled) === plain`.
- **Never write to agent auth files** (`~/.grok/auth.json`, `~/.codex/auth.json`). Read only.
- Code style: double quotes, no semicolons, 2-space indent, matching the existing `src/`.
- Test command: `npm test`. Full gate: `npm run check` (typecheck + test + build).

## Deviation from the spec, and why

The spec draws the overflow indicator as `↑3/28` in the divider plus a `▾` appended to the last
content row. Appending a glyph to a content row would break the width invariant every other row
in this codebase obeys, and the row it lands on is section content the section owns. This plan
puts **both** indicators in the divider instead — `↑3 ↓12`, zeros omitted — and leaves content
rows untouched. Same information, one owner.

---

### Task 1: Scroll window arithmetic

**Files:**
- Create: `src/viewport.ts`
- Test: `test/viewport.test.ts`

**Interfaces:**
- Produces: `type Window = { lines: string[]; offset: number; above: number; below: number }` and `window(lines: string[], height: number, offset: number): Window`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { window } from "../src/viewport.js"

const rows = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`)

test("a list shorter than the height is shown whole, with nothing hidden", () => {
  const w = window(rows(3), 10, 0)
  assert.deepEqual(w.lines, ["r0", "r1", "r2"])
  assert.equal(w.above, 0)
  assert.equal(w.below, 0)
})

test("an offset past the end clamps to the last full screen rather than scrolling into space", () => {
  const w = window(rows(20), 5, 999)
  assert.deepEqual(w.lines, ["r15", "r16", "r17", "r18", "r19"])
  assert.equal(w.offset, 15)
  assert.equal(w.below, 0)
  assert.equal(w.above, 15)
})

test("a negative offset clamps to the top", () => {
  const w = window(rows(20), 5, -4)
  assert.equal(w.offset, 0)
  assert.deepEqual(w.lines[0], "r0")
})

test("above and below account for every hidden row", () => {
  const w = window(rows(20), 5, 3)
  assert.equal(w.above, 3)
  assert.equal(w.below, 12)
  assert.equal(w.above + w.lines.length + w.below, 20)
})

test("a height of zero hides everything without throwing", () => {
  const w = window(rows(20), 0, 5)
  assert.deepEqual(w.lines, [])
  assert.equal(w.below, 20)
})

test("a shrinking list pulls the offset back so the view is never empty", () => {
  // The MCP list shortens when a server is removed; the offset must follow it down.
  const w = window(rows(6), 5, 15)
  assert.equal(w.offset, 1)
  assert.equal(w.lines.length, 5)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 viewport`
Expected: FAIL — `Cannot find module '../src/viewport.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * A window onto a list too long to show at once.
 *
 * The offset is clamped rather than trusted, because the list changes underneath it: a server
 * disconnects, a tool is called for the first time, the terminal is resized. An offset that was
 * valid one frame ago can point past the end of the next one, and scrolling into blank space
 * reads as a bug even though the data is fine.
 */
export type Window = {
  lines: string[]
  /** The offset actually used, after clamping. Callers store this back. */
  offset: number
  above: number
  below: number
}

export function window(lines: string[], height: number, offset: number): Window {
  if (height <= 0) return { lines: [], offset: 0, above: 0, below: lines.length }
  const max = Math.max(0, lines.length - height)
  const at = Math.min(Math.max(0, offset), max)
  const shown = lines.slice(at, at + height)
  return { lines: shown, offset: at, above: at, below: Math.max(0, lines.length - at - shown.length) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/viewport.ts test/viewport.test.ts
git commit -m "Add scroll window arithmetic"
```

---

### Task 2: Pinned / scroll composition

**Files:**
- Create: `src/layout.ts`
- Test: `test/layout.test.ts`

**Interfaces:**
- Consumes: `window()` from Task 1
- Produces: `compose(pinned: string[], scroll: string[], height: number, width: number, offset: number, style: Style): { lines: string[]; offset: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { compose, MIN_SCROLL } from "../src/layout.js"
import { PLAIN } from "../src/ansi.js"

const rows = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`)

test("with room for everything there is no divider and no scrolling", () => {
  const { lines } = compose(rows("p", 3), rows("s", 4), 40, 20, 0, PLAIN)
  assert.deepEqual(lines, ["p0", "p1", "p2", "s0", "s1", "s2", "s3"])
})

test("an overflowing list gets a divider carrying both directions", () => {
  const { lines } = compose(rows("p", 2), rows("s", 30), 12, 20, 3, PLAIN)
  const divider = lines[2]
  assert.match(divider, /↑3/)
  assert.match(divider, /↓/)
  assert.equal(divider.length, 20, "the divider spans the content width")
})

test("the divider omits a direction with nothing in it", () => {
  const { lines } = compose(rows("p", 2), rows("s", 30), 12, 20, 0, PLAIN)
  assert.doesNotMatch(lines[2], /↑/, "nothing above at the top")
  assert.match(lines[2], /↓/)
})

test("the composed block never exceeds the height it was given", () => {
  for (const height of [8, 12, 20, 40]) {
    const { lines } = compose(rows("p", 5), rows("s", 50), height, 20, 0, PLAIN)
    assert.ok(lines.length <= height, `height ${height} produced ${lines.length} rows`)
  }
})

test("a short terminal sacrifices pinned rows rather than the list", () => {
  // The list is the thing being scrolled; leaving it one row tall would defeat the section.
  const { lines } = compose(rows("p", 20), rows("s", 30), 10, 20, 0, PLAIN)
  const scrollRows = lines.filter((l) => l.startsWith("s"))
  assert.ok(scrollRows.length >= MIN_SCROLL, `only ${scrollRows.length} scroll rows`)
})

test("pinned rows are dropped from the bottom, keeping the top of the sidebar", () => {
  const { lines } = compose(rows("p", 20), rows("s", 30), 10, 20, 0, PLAIN)
  assert.equal(lines[0], "p0", "the first pinned row survives")
  assert.ok(!lines.includes("p19"), "the last pinned row is the first to go")
})

test("the clamped offset is returned so the caller can store it back", () => {
  const { offset } = compose(rows("p", 2), rows("s", 8), 12, 20, 999, PLAIN)
  assert.ok(offset < 999)
})

test("styling the divider does not change its width", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")
  const plain = compose(rows("p", 2), rows("s", 30), 12, 20, 3, PLAIN).lines[2]
  const styled = compose(rows("p", 2), rows("s", 30), 12, 20, 3, {
    bold: (s) => s, paint: (t) => t, muted: (s) => `\x1b[2m${s}\x1b[0m`,
  }).lines[2]
  assert.equal(strip(styled), plain)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 layout`
Expected: FAIL — `Cannot find module '../src/layout.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { window } from "./viewport.js"
import type { Style } from "./ansi.js"

/**
 * The scroll region never shrinks below this. A list one row tall is not a list, and the pinned
 * sections are the part that can survive being cut — quota and context are re-read every few
 * seconds, while the tool list is the thing you scrolled here to read.
 */
export const MIN_SCROLL = 5

/** Both directions, zeros omitted, so a divider at the top does not claim rows above it. */
function marker(above: number, below: number): string {
  const parts: string[] = []
  if (above > 0) parts.push(`↑${above}`)
  if (below > 0) parts.push(`↓${below}`)
  return parts.join(" ")
}

/**
 * Split the pane into a pinned block and a scroll region.
 *
 * Pinned sections render whole and stay put; the rest of the height belongs to the scrollable
 * one. The divider appears only when there is something hidden, so a sidebar that fits shows no
 * chrome at all.
 */
export function compose(
  pinned: string[],
  scroll: string[],
  height: number,
  width: number,
  offset: number,
  style: Style,
): { lines: string[]; offset: number } {
  if (!scroll.length) return { lines: pinned.slice(0, height), offset: 0 }

  const fits = pinned.length + scroll.length <= height
  if (fits) return { lines: [...pinned, ...scroll], offset: 0 }

  // One row goes to the divider once we know there is something to hide.
  let room = height - pinned.length - 1
  let head = pinned
  if (room < MIN_SCROLL) {
    head = pinned.slice(0, Math.max(0, height - MIN_SCROLL - 1))
    room = Math.max(0, height - head.length - 1)
  }

  const w = window(scroll, room, offset)
  const tag = marker(w.above, w.below)
  const rule = "─".repeat(Math.max(0, width - (tag ? tag.length + 2 : 0)))
  const dim = style.muted ?? ((s: string) => s)
  const divider = tag ? dim(rule) + " " + dim(tag) + dim(" ") : dim(rule)

  return { lines: [...head, divider, ...w.lines], offset: w.offset }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/layout.ts test/layout.test.ts
git commit -m "Add pinned/scroll pane composition"
```

---

### Task 3: Wire the pane to scroll, and read keys

**Files:**
- Modify: `src/sections/types.ts` (add `scrollable?: boolean`)
- Modify: `src/pane.ts` (render via `compose`, hold the offset, read keys)
- Test: manual, in a live pane

**Interfaces:**
- Consumes: `compose()` from Task 2
- Produces: `Section.scrollable?: boolean` — a section opting into the scroll region. At most one section may set it; the first one wins.

- [ ] **Step 1: Add the interface flag**

In `src/sections/types.ts`, inside the `Section` type:

```ts
  /**
   * Render into the pane's scroll region rather than the pinned block.
   *
   * At most one section is scrollable. Everything else renders whole and stays put, so the
   * readings you glance at — quota, context, speed — never scroll out of view while you are
   * reading a long list.
   */
  scrollable?: boolean
```

- [ ] **Step 2: Replace the render function in `src/pane.ts`**

```ts
function render() {
  if (!dirty) return
  dirty = false
  const width = Math.max(18, (process.stdout.columns ?? 34) - 4)
  const height = Math.max(1, (process.stdout.rows ?? 40) - 2)

  const pinned: string[] = []
  const scroll: string[] = []
  for (const section of SECTIONS) {
    const lines = section.render(width, TERMINAL)
    if (!lines.length) continue
    const into = section.scrollable ? scroll : pinned
    if (into.length) into.push("")
    into.push(...lines)
  }
  if (pinned.length && scroll.length) pinned.push("")

  const composed = compose(pinned, scroll, height, width, offset, TERMINAL)
  offset = composed.offset
  const out = composed.lines
  process.stdout.write("\x1b[2J\x1b[H\n" + out.map((l) => (l ? `  ${l}` : l)).join("\n") + "\n")
}
```

- [ ] **Step 3: Add the offset and key handling to `src/pane.ts`**

Beside the other module state:

```ts
let offset = 0
/**
 * Reset the scroll when the pane changes agent — the list underneath is a different session's,
 * so an offset carried over from the last one points at nothing meaningful.
 */
let scrolledFor: string | null = null
```

And in `refresh()`, immediately after `subject` is resolved:

```ts
  const key = subject ? `${subject.agent}:${subject.sessionId}` : null
  if (key !== scrolledFor) {
    offset = 0
    scrolledFor = key
  }
```

After the resize handler:

```ts
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
function onKey(chunk: Buffer) {
  const key = chunk.toString("utf8")
  if (key === "\x03") return process.exit(0)
  if (key === "\x1b[A" || key === "k") offset -= 1
  else if (key === "\x1b[B" || key === "j") offset += 1
  else if (key === "g") offset = 0
  else if (key === "G") offset = Number.MAX_SAFE_INTEGER
  else return
  dirty = true
  render()
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", onKey)
  // Leaving a terminal in raw mode would corrupt whatever herdr draws in this pane next.
  process.on("exit", () => { try { process.stdin.setRawMode(false) } catch { /* already gone */ } })
}
```

Add the import: `import { compose } from "./layout.js"`

- [ ] **Step 4: Verify nothing regressed**

Run: `npm run check`
Expected: typecheck clean, `fail 0`, build succeeds. With no scrollable section yet, the sidebar renders exactly as before — `scroll` is empty, so `compose` returns the pinned lines unchanged.

- [ ] **Step 5: Verify in a live pane**

```bash
npm run build && touch dist/pane.js   # the supervisor restarts panes on a new build stamp
sleep 8 && herdr pane read "$(herdr pane list | python3 -c "import sys,json;print([p['pane_id'] for p in json.load(sys.stdin)['result']['panes'] if (p.get('label') or '')=='sidebar'][0])")" --source visible | head -20
```

Expected: the sidebar looks unchanged. Ctrl+C in a focused sidebar pane still exits it.

- [ ] **Step 6: Commit**

```bash
git add src/pane.ts src/sections/types.ts
git commit -m "Render the sidebar as a pinned block plus a scroll region"
```

---

### Task 4: Count this session's tool calls

**Files:**
- Create: `src/sections/tools/types.ts`
- Create: `src/sections/tools/sources/calls.ts`
- Test: `test/tool-calls.test.ts`

**Interfaces:**
- Produces:
  - `type ToolCall = { name: string; count: number }`
  - `namesIn(agent: ProviderKind, line: string): string[]`
  - `shortenTool(name: string): string`
  - `tally(agent: ProviderKind, lines: string[]): ToolCall[]`
  - `countCalls(agent: ProviderKind, path: string): Promise<ToolCall[]>`
  - `transcriptFor(agent: ProviderKind, sessionId: string): Promise<string | null>`

**Note:** `PaneAgent` carries no transcript path — each session source resolves its own, and
both resolvers are currently private. This task exports them rather than duplicating them:
add `export` to `rolloutFor` in `src/sections/session/sources/codex.ts:21` and to `sessionDir`
in `src/sections/session/sources/grok.ts:32`. Neither changes behaviour.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { namesIn, shortenTool, tally } from "../src/sections/tools/sources/calls.js"

const claudeLine = (names: string[]) =>
  JSON.stringify({ message: { content: names.map((name) => ({ type: "tool_use", name })) } })

test("Claude tool calls come from tool_use blocks", () => {
  assert.deepEqual(namesIn("claude", claudeLine(["Bash", "Read"])), ["Bash", "Read"])
})

test("a Claude line with no tool blocks yields nothing", () => {
  assert.deepEqual(namesIn("claude", JSON.stringify({ message: { content: "plain text" } })), [])
})

test("Codex counts every call shape it emits", () => {
  const line = (type: string, name: string) => JSON.stringify({ payload: { type, name } })
  assert.deepEqual(namesIn("codex", line("custom_tool_call", "exec")), ["exec"])
  assert.deepEqual(namesIn("codex", line("function_call", "wait")), ["wait"])
  assert.deepEqual(namesIn("codex", line("local_shell_call", "shell")), ["shell"])
  assert.deepEqual(namesIn("codex", line("custom_tool_call_output", "exec")), [], "outputs are not calls")
})

test("Grok takes the tool name from _meta, never the rendered title", () => {
  // title is display text — "Read `/Users/lu/...`" — and would splinter one tool into many rows.
  const line = JSON.stringify({
    params: { update: {
      sessionUpdate: "tool_call",
      title: "Read `/Users/lu/dotfiles/x`",
      _meta: { "x.ai/tool": { name: "read_file" } },
    } },
  })
  assert.deepEqual(namesIn("grok", line), ["read_file"])
})

test("Grok's tool_call_update records are status changes, not new calls", () => {
  // There are ~2.5 updates per call; counting them would inflate every figure.
  const line = JSON.stringify({
    params: { update: { sessionUpdate: "tool_call_update", _meta: { "x.ai/tool": { name: "read_file" } } } },
  })
  assert.deepEqual(namesIn("grok", line), [])
})

test("MCP tool names collapse to server:tool", () => {
  assert.equal(shortenTool("mcp__github__search_code"), "github:search_code")
  assert.equal(shortenTool("mcp__plugin_cloudflare_cloudflare-docs__search"), "cloudflare-docs:search")
  assert.equal(shortenTool("Bash"), "Bash")
})

test("tally sorts by count, breaking ties alphabetically so the order is stable", () => {
  const lines = [claudeLine(["Bash", "Bash", "Read"]), claudeLine(["Edit", "Bash"])]
  assert.deepEqual(tally("claude", lines), [
    { name: "Bash", count: 3 },
    { name: "Edit", count: 1 },
    { name: "Read", count: 1 },
  ])
})

test("a malformed line is skipped rather than throwing", () => {
  assert.deepEqual(namesIn("claude", "{not json"), [])
  assert.deepEqual(tally("claude", ["{not json", claudeLine(["Bash"])]), [{ name: "Bash", count: 1 }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 tool-calls`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/sections/tools/types.ts`**

```ts
import type { ProviderKind } from "../../types.js"

export type ToolCall = { name: string; count: number }

/**
 * What a status glyph is allowed to claim.
 *
 * `connected` and `failed` are assertions about a live connection and may only be used by an
 * agent that actually checked. `enabled` and `disabled` are assertions about configuration.
 * Codex can only ever produce the latter pair — see the spec's honesty rules.
 */
export type McpStatus = "connected" | "needs-auth" | "failed" | "pending" | "enabled" | "disabled"

export type McpServer = { name: string; status: McpStatus }

export type McpSnapshot = {
  agent: ProviderKind
  servers: McpServer[]
  observedAt: number
}
```

- [ ] **Step 4: Write `src/sections/tools/sources/calls.ts`**

```ts
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { claudeDir } from "../../quota/sources/claude.js"
import { rolloutFor } from "../../session/sources/codex.js"
import { sessionDir } from "../../session/sources/grok.js"
import type { ProviderKind } from "../../../types.js"
import type { ToolCall } from "../types.js"

/** `mcp__github__search_code` -> `github:search_code`, and a plugin prefix loses its scaffolding. */
export function shortenTool(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!m) return name
  const server = m[1].replace(/^plugin_[^_]+_/, "").replace(/_/g, "-")
  return `${server}:${m[2]}`
}

/** Tool names invoked on one transcript line. Malformed lines contribute nothing. */
export function namesIn(agent: ProviderKind, line: string): string[] {
  if (!line.includes("tool") && !line.includes("_call")) return []
  let d: any
  try { d = JSON.parse(line) } catch { return [] }

  if (agent === "claude") {
    const content = d?.message?.content
    if (!Array.isArray(content)) return []
    return content.filter((b: any) => b?.type === "tool_use" && b?.name).map((b: any) => b.name)
  }

  if (agent === "codex") {
    const p = d?.payload
    const kinds = ["custom_tool_call", "function_call", "local_shell_call"]
    return p && kinds.includes(p.type) && p.name ? [p.name] : []
  }

  const u = d?.params?.update
  if (u?.sessionUpdate !== "tool_call") return []
  const name = u?._meta?.["x.ai/tool"]?.name ?? u?.title
  return name ? [String(name)] : []
}

/** Counts, highest first; ties alphabetical so the rows do not reshuffle between refreshes. */
const sorted = (counts: Map<string, number>): ToolCall[] =>
  [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

export function tally(agent: ProviderKind, lines: string[]): ToolCall[] {
  const counts = new Map<string, number>()
  for (const line of lines) {
    for (const raw of namesIn(agent, line)) {
      const name = shortenTool(raw)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return sorted(counts)
}

/**
 * Where the session's transcript lives, per agent.
 *
 * `PaneAgent` does not carry this and should not: each agent files its history differently, and
 * the resolvers already exist beside the session section's readers. Claude's path is recorded by
 * the statusLine collector; Codex names the session in its rollout filename; Grok keeps a
 * directory per session under a percent-encoded cwd.
 */
export async function transcriptFor(
  agent: ProviderKind,
  sessionId: string,
): Promise<string | null> {
  if (agent === "claude") {
    const text = await readFile(join(claudeDir(), `${sessionId}.json`), "utf8").catch(() => null)
    if (!text) return null
    try {
      const path = JSON.parse(text)?.transcript_path
      return typeof path === "string" ? path : null
    } catch { return null }
  }
  if (agent === "codex") return rolloutFor(sessionId)
  const dir = await sessionDir(sessionId)
  return dir ? join(dir, "updates.jsonl") : null
}

/**
 * Session totals, read incrementally.
 *
 * The count is for the whole session, so the tail trick used elsewhere would undercount — a
 * session's first hundred calls are far behind the window. Transcripts also reach tens of
 * megabytes, so re-reading the file every five seconds is not an option either. The file is
 * append-only, so the first read streams it whole and every later read consumes only the bytes
 * that appeared since, keeping the steady-state cost proportional to what the agent just did.
 */
const cursors = new Map<string, { size: number; counts: Map<string, number> }>()

export async function countCalls(agent: ProviderKind, path: string): Promise<ToolCall[]> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return []

  let cursor = cursors.get(path)
  // A file that shrank was rotated or replaced; start over rather than trust the old offset.
  if (!cursor || info.size < cursor.size) {
    cursor = { size: 0, counts: new Map() }
    cursors.set(path, cursor)
  }
  if (info.size === cursor.size) return sorted(cursor.counts)

  const stream = createReadStream(path, { start: cursor.size, end: info.size - 1 })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      for (const raw of namesIn(agent, line)) {
        const name = shortenTool(raw)
        cursor.counts.set(name, (cursor.counts.get(name) ?? 0) + 1)
      }
    }
  } catch { /* a partial read is recovered on the next refresh */ }
  cursor.size = info.size
  return sorted(cursor.counts)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: PASS, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/sections/tools/types.ts src/sections/tools/sources/calls.ts \
  src/sections/session/sources/codex.ts src/sections/session/sources/grok.ts test/tool-calls.test.ts
git commit -m "Count this session's tool calls incrementally"
```

---

### Task 5: Parse each agent's MCP server list

**Files:**
- Create: `src/sections/tools/sources/claude.ts`
- Create: `src/sections/tools/sources/codex.ts`
- Create: `src/sections/tools/sources/grok.ts`
- Test: `test/mcp-parse.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `McpStatus` from Task 4
- Produces: `parseClaudeMcp(stdout: string): McpServer[]`, `parseCodexMcp(stdout: string): McpServer[]`, `parseGrokMcp(list: string, doctor: string | null): McpServer[]`, `shortenServer(name: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseClaudeMcp, shortenServer } from "../src/sections/tools/sources/claude.js"
import { parseCodexMcp } from "../src/sections/tools/sources/codex.js"
import { parseGrokMcp } from "../src/sections/tools/sources/grok.js"

// Captured verbatim from `claude mcp list` on 2026-08-31.
const CLAUDE = `Checking MCP server health…

claude.ai Context7: https://mcp.context7.com/mcp - ✔ Connected
plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✔ Connected
plugin:huggingface-skills:huggingface-skills: https://huggingface.co/mcp?login (HTTP) - ! Needs authentication
plugin:playwright:playwright: npx @playwright/mcp@latest - ✗ Failed to connect
plugin:local:pending: ./x - ⏸ Pending approval
`

test("every status Claude can report is recognised", () => {
  const servers = parseClaudeMcp(CLAUDE)
  assert.deepEqual(servers.map((s) => s.status), [
    "connected", "connected", "needs-auth", "failed", "pending",
  ])
})

test("a server name containing colons survives the split", () => {
  // "plugin:github:github: https://…" — splitting on the first colon would truncate the name.
  const servers = parseClaudeMcp(CLAUDE)
  assert.equal(servers[1].name, "github")
})

test("names shorten for a 30-column sidebar", () => {
  assert.equal(shortenServer("plugin:cloudflare:cloudflare-docs"), "cloudflare-docs")
  assert.equal(shortenServer("claude.ai Context7"), "Context7")
  assert.equal(shortenServer("mongodb"), "mongodb")
})

test("the health-check preamble and blank lines are not servers", () => {
  assert.equal(parseClaudeMcp(CLAUDE).length, 5)
})

test("unparseable output yields no servers rather than a guess", () => {
  assert.deepEqual(parseClaudeMcp("some unrelated error text"), [])
})

// Captured verbatim from `codex mcp list --json` on 2026-08-31.
const CODEX = JSON.stringify([
  { name: "codex_app", enabled: false, auth_status: "unsupported" },
  { name: "node_repl", enabled: true, auth_status: "unsupported" },
])

test("Codex reports configuration only — never connectivity", () => {
  const servers = parseCodexMcp(CODEX)
  assert.deepEqual(servers, [
    { name: "codex_app", status: "disabled" },
    { name: "node_repl", status: "enabled" },
  ])
  for (const s of servers) {
    assert.ok(s.status !== "connected", "Codex must never claim a live connection")
    assert.ok(s.status !== "failed", "Codex cannot know a connection failed")
  }
})

test("Codex with nothing configured yields an empty list, not an error", () => {
  assert.deepEqual(parseCodexMcp("[]"), [])
})

test("Grok with no servers configured yields nothing", () => {
  assert.deepEqual(parseGrokMcp("[]", null), [])
})

test("Grok falls back to configuration when the doctor could not run", () => {
  // `grok mcp doctor` needs auth and can fail outright; config state is still true.
  const list = JSON.stringify([{ name: "files", enabled: true }])
  assert.deepEqual(parseGrokMcp(list, null), [{ name: "files", status: "enabled" }])
})

test("Grok uses connectivity when the doctor did run", () => {
  const list = JSON.stringify([{ name: "files", enabled: true }])
  const doctor = JSON.stringify([{ name: "files", ok: true }])
  assert.deepEqual(parseGrokMcp(list, doctor), [{ name: "files", status: "connected" }])
})

test("Grok's doctor output survives the log noise it prints first", () => {
  // It emits ANSI-coloured ERROR lines before any JSON.
  const list = JSON.stringify([{ name: "files", enabled: true }])
  const noisy = `\x1b[2m2026-08-31T11:06:31Z\x1b[0m \x1b[31mERROR\x1b[0m worker quit\n[{"name":"files","ok":false}]`
  assert.deepEqual(parseGrokMcp(list, noisy), [{ name: "files", status: "failed" }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 mcp-parse`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `src/sections/tools/sources/claude.ts`**

```ts
import type { McpServer, McpStatus } from "../types.js"

/**
 * Trim a server name to what distinguishes it.
 *
 * Claude qualifies every plugin server as `plugin:<plugin>:<server>` and every connector as
 * `claude.ai <Name>`. In a 30-column sidebar the qualifier costs more than it says — the last
 * segment is what the reader is looking for.
 */
export function shortenServer(name: string): string {
  if (name.startsWith("plugin:")) return name.split(":").pop() ?? name
  if (name.startsWith("claude.ai ")) return name.slice("claude.ai ".length)
  return name
}

const STATUS: Array<[RegExp, McpStatus]> = [
  [/needs? authentication/i, "needs-auth"],
  [/pending/i, "pending"],
  [/failed|error|disconnected/i, "failed"],
  [/connected/i, "connected"],
]

/**
 * Parse `claude mcp list`, which has no JSON mode.
 *
 * Each server is one line, `name: target - status`. The name may itself contain colons
 * (`plugin:github:github`), so the split is on the first `": "` — a colon followed by a space —
 * which the qualifier never contains. The status is whatever follows the last `" - "`, since
 * targets contain hyphens and parenthesised transports.
 */
export function parseClaudeMcp(stdout: string): McpServer[] {
  const out: McpServer[] = []
  for (const line of stdout.split("\n")) {
    const cut = line.indexOf(": ")
    const dash = line.lastIndexOf(" - ")
    if (cut < 1 || dash < cut) continue
    const tail = line.slice(dash + 3).trim()
    const hit = STATUS.find(([re]) => re.test(tail))
    if (!hit) continue
    out.push({ name: shortenServer(line.slice(0, cut).trim()), status: hit[1] })
  }
  return out
}
```

- [ ] **Step 4: Write `src/sections/tools/sources/codex.ts`**

```ts
import type { McpServer } from "../types.js"

/**
 * Parse `codex mcp list --json`.
 *
 * Codex never connects to its servers when listing them, so `enabled` is the only thing this
 * output can support. Mapping it to `connected` would be a claim the command did not make —
 * see the spec's honesty rules.
 */
export function parseCodexMcp(stdout: string): McpServer[] {
  let parsed: any
  try { parsed = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((s: any) => typeof s?.name === "string")
    .map((s: any): McpServer => ({ name: s.name, status: s.enabled ? "enabled" : "disabled" }))
}
```

- [ ] **Step 5: Write `src/sections/tools/sources/grok.ts`**

```ts
import type { McpServer, McpStatus } from "../types.js"

/**
 * Grok prints ANSI-coloured log lines to the same stream as its JSON, so the payload has to be
 * found rather than assumed to start at byte zero.
 */
function jsonIn(text: string): any {
  const start = text.indexOf("[")
  if (start < 0) return null
  try { return JSON.parse(text.slice(start)) } catch { return null }
}

/**
 * Parse `grok mcp list --json`, upgraded with `grok mcp doctor --json` when that ran.
 *
 * The doctor needs authentication and can fail outright, so its absence is expected rather than
 * exceptional. Without it the status falls back to configuration — which is honest, and is
 * exactly what Codex is limited to permanently.
 */
export function parseGrokMcp(list: string, doctor: string | null): McpServer[] {
  const configured = jsonIn(list)
  if (!Array.isArray(configured)) return []

  const health = new Map<string, boolean>()
  const checked = doctor === null ? null : jsonIn(doctor)
  if (Array.isArray(checked)) {
    for (const entry of checked) {
      if (typeof entry?.name === "string" && typeof entry?.ok === "boolean") {
        health.set(entry.name, entry.ok)
      }
    }
  }

  return configured
    .filter((s: any) => typeof s?.name === "string")
    .map((s: any): McpServer => {
      const live = health.get(s.name)
      const status: McpStatus =
        live === undefined ? (s.enabled === false ? "disabled" : "enabled")
        : live ? "connected"
        : "failed"
      return { name: s.name, status }
    })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: PASS, `fail 0`

- [ ] **Step 7: Commit**

```bash
git add src/sections/tools/sources/ test/mcp-parse.test.ts
git commit -m "Parse each agent's MCP server list"
```

---

### Task 6: Cache the MCP reading with a TTL and a single-flight lock

**Files:**
- Create: `src/sections/tools/cache.ts`
- Test: `test/mcp-cache.test.ts`

**Interfaces:**
- Consumes: `McpSnapshot` from Task 4
- Produces: `TTL: Record<ProviderKind, number>`, `isFresh(snap: McpSnapshot | null, now: number, agent: ProviderKind): boolean`, `mcpDir(): string`, `readCached(agent): Promise<McpSnapshot | null>`, `writeCached(snap): Promise<void>`, `claimLock(agent, now): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { isFresh, TTL } from "../src/sections/tools/cache.js"
import type { McpSnapshot } from "../src/sections/tools/types.js"

const snap = (at: number): McpSnapshot => ({ agent: "claude", servers: [], observedAt: at })
const NOW = 1_800_000_000_000

test("Claude's reading is trusted for fifteen minutes", () => {
  assert.equal(TTL.claude, 15 * 60_000)
  assert.ok(isFresh(snap(NOW - 14 * 60_000), NOW, "claude"))
  assert.ok(!isFresh(snap(NOW - 16 * 60_000), NOW, "claude"))
})

test("the cheap agents are re-read every minute", () => {
  assert.equal(TTL.codex, 60_000)
  assert.equal(TTL.grok, 60_000)
  assert.ok(!isFresh(snap(NOW - 61_000), NOW, "codex"))
})

test("an expired reading is not fresh — it must render as a dash, never as current", () => {
  // The whole point of the section is that a wrong status is worse than no status.
  assert.ok(!isFresh(snap(NOW - 60 * 60_000), NOW, "claude"))
})

test("a missing reading is not fresh", () => {
  assert.ok(!isFresh(null, NOW, "claude"))
})

test("a reading from the future is not trusted", () => {
  // Clock changes happen; a timestamp ahead of now means the arithmetic cannot be relied on.
  assert.ok(!isFresh(snap(NOW + 60_000), NOW, "claude"))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 mcp-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sections/tools/cache.ts test/mcp-cache.test.ts
git commit -m "Cache MCP readings behind a TTL and a single-flight lock"
```

---

### Task 7: Format the section and wire it in

**Files:**
- Create: `src/sections/tools/format.ts`
- Create: `src/sections/tools/index.ts`
- Modify: `src/pane.ts:28` (add `toolsSection()` to `SECTIONS`)
- Modify: `herdr-plugin.toml` (add the `refresh-mcp` action)
- Test: `test/tools-format.test.ts`

**Interfaces:**
- Consumes: `ToolCall`, `McpServer`, `McpSnapshot` (Task 4); parsers (Task 5); cache (Task 6); `labelled` from `src/sections/session/format.js`
- Produces: `toolsBlock(calls, mcp, agent, width, style): string[]`, `toolsSection(): Section`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { toolsBlock } from "../src/sections/tools/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import type { McpSnapshot, ToolCall } from "../src/sections/tools/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")
const row = (lines: string[], label: string): string =>
  lines.find((l) => strip(l).startsWith(label + " ")) ?? ""

const calls: ToolCall[] = [
  { name: "Bash", count: 21 },
  { name: "Read", count: 12 },
  { name: "github:search_code", count: 6 },
]
const mcp: McpSnapshot = {
  agent: "claude",
  observedAt: Date.now(),
  servers: [
    { name: "context7", status: "connected" },
    { name: "huggingface", status: "needs-auth" },
    { name: "playwright", status: "failed" },
  ],
}

test("the header counts total calls, not distinct tools", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.ok(lines[0].startsWith("TOOLS"))
  assert.ok(lines[0].endsWith("39 calls"), lines[0])
})

test("every tool is listed — there is no top-N cut", () => {
  const many: ToolCall[] = Array.from({ length: 24 }, (_, i) => ({ name: `t${i}`, count: 24 - i }))
  const lines = toolsBlock(many, mcp, "claude", 30, PLAIN)
  for (let i = 0; i < 24; i++) assert.ok(row(lines, `t${i}`), `t${i} is missing`)
})

test("the MCP header counts healthy servers over the total", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  const header = lines.find((l) => l.startsWith("MCP")) ?? ""
  assert.ok(header.endsWith("1/3"), header)
})

test("each status gets its own glyph", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.ok(row(lines, "context7").endsWith("●"))
  assert.ok(row(lines, "huggingface").endsWith("◐"))
  assert.ok(row(lines, "playwright").endsWith("✗"))
})

test("Codex renders enabled and disabled, and never a connected glyph", () => {
  const codex: McpSnapshot = {
    agent: "codex", observedAt: Date.now(),
    servers: [{ name: "node_repl", status: "enabled" }, { name: "codex_app", status: "disabled" }],
  }
  const lines = toolsBlock([], codex, "codex", 30, PLAIN)
  assert.ok(row(lines, "node_repl").endsWith("●"))
  assert.ok(row(lines, "codex_app").endsWith("○"))
})

test("no tool calls yet is a dash, not an empty block", () => {
  const lines = toolsBlock([], mcp, "claude", 30, PLAIN)
  assert.ok(lines[0].endsWith("—"), lines[0])
})

test("no MCP reading at all is a dash", () => {
  const lines = toolsBlock(calls, null, "grok", 30, PLAIN)
  const header = lines.find((l) => l.startsWith("MCP")) ?? ""
  assert.ok(header.endsWith("—"), header)
})

test("a dash is dimmed wherever it stands in for a value", () => {
  const lines = toolsBlock([], null, "grok", 30, TERMINAL)
  for (const line of lines.filter((l) => strip(l).includes("—"))) {
    assert.match(line, /\x1b\[2m—/)
  }
})

test("styling never changes a row's width", () => {
  const plain = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  const styled = toolsBlock(calls, mcp, "claude", 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
  for (const line of plain) if (line) assert.equal(line.length, 30)
})

test("the blank-row-after-title convention matches the other sections", () => {
  const lines = toolsBlock(calls, mcp, "claude", 30, PLAIN)
  assert.equal(lines[1], "")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 tools-format`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/sections/tools/format.ts`**

```ts
import { labelled } from "../session/format.js"
import type { Style } from "../../ansi.js"
import type { ProviderKind } from "../../types.js"
import type { McpSnapshot, McpStatus, ToolCall } from "./types.js"

const DASH = "—"

/**
 * Glyphs carry the claim, so two agents saying different things cannot look alike by accident.
 * `enabled` reuses the filled dot because for Codex it is the best state available, and the
 * header count beside it is what says how many are in it.
 */
const GLYPH: Record<McpStatus, string> = {
  connected: "●",
  "needs-auth": "◐",
  failed: "✗",
  pending: "⏸",
  enabled: "●",
  disabled: "○",
}

/** The states worth counting in the header, per what the agent is able to know. */
const HEALTHY: McpStatus[] = ["connected", "enabled"]

export function toolsBlock(
  calls: ToolCall[],
  mcp: McpSnapshot | null,
  agent: ProviderKind,
  width: number,
  style: Style,
): string[] {
  const muted = style.muted ?? ((s: string) => s)
  const label = style.label ?? ((s: string) => s)
  const out: string[] = []

  const total = calls.reduce((n, c) => n + c.count, 0)
  out.push(labelled("TOOLS", total
    ? [{ text: `${total} calls` }]
    : [{ text: DASH, paint: muted }], width, style.bold))
  out.push("")
  for (const call of calls) {
    out.push(labelled(call.name, [{ text: String(call.count) }], width, label))
  }

  out.push("")
  const servers = mcp?.servers ?? null
  const healthy = servers?.filter((s) => HEALTHY.includes(s.status)).length ?? 0
  out.push(labelled("MCP", servers && servers.length
    ? [{ text: `${healthy}/${servers.length}` }]
    : [{ text: DASH, paint: muted }], width, style.bold))
  out.push("")
  for (const server of servers ?? []) {
    const on = HEALTHY.includes(server.status)
    const paint = style.mark ? (s: string) => style.mark!(s, on) : undefined
    out.push(labelled(server.name, [{ text: GLYPH[server.status], paint }], width, label))
  }

  return out
}
```

- [ ] **Step 4: Write `src/sections/tools/index.ts`**

```ts
import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { ProviderKind } from "../../types.js"
import type { McpServer, McpSnapshot, ToolCall } from "./types.js"
import { toolsBlock } from "./format.js"
import { countCalls, transcriptFor } from "./sources/calls.js"
import { parseClaudeMcp } from "./sources/claude.js"
import { parseCodexMcp } from "./sources/codex.js"
import { parseGrokMcp } from "./sources/grok.js"
import { claimLock, isFresh, mcpDir, readCached, writeCached } from "./cache.js"

/** Run a command for its stdout, yielding null rather than throwing. */
function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => {
      // A non-zero exit still often carries usable output — grok's doctor logs to the same
      // stream — so stdout is preferred over the error when there is any.
      resolve(stdout ? String(stdout) : err ? null : "")
    })
  })
}

async function check(agent: ProviderKind): Promise<McpServer[] | null> {
  if (agent === "claude") {
    const out = await run("claude", ["mcp", "list"], 30_000)
    return out === null ? null : parseClaudeMcp(out)
  }
  if (agent === "codex") {
    const out = await run("codex", ["mcp", "list", "--json"], 10_000)
    return out === null ? null : parseCodexMcp(out)
  }
  const list = await run("grok", ["mcp", "list", "--json"], 10_000)
  if (list === null) return null
  const configured = parseGrokMcp(list, null)
  // The doctor is slow and needs auth; there is nothing for it to check when nothing is set up.
  if (!configured.length) return []
  const doctor = await run("grok", ["mcp", "doctor", "--json"], 20_000)
  return parseGrokMcp(list, doctor)
}

/**
 * The tools this session has called, and the MCP servers this agent has configured.
 *
 * Unlike quota, both belong to one session and one provider, so only the pane's own agent is
 * shown. The section is scrollable because the lists are unbounded — thirteen servers and two
 * dozen tools is ordinary — while quota and context above it must stay in view.
 */
export function toolsSection(): Section {
  let calls: ToolCall[] = []
  let mcp: McpSnapshot | null = null
  let subject: SectionContext["subject"] = null
  let checking = false

  return {
    id: "tools",
    scrollable: true,

    watch: () => [
      mcpDir(),
      join(homedir(), ".claude.json"),
      join(homedir(), ".codex", "config.toml"),
      join(homedir(), ".grok", "config.toml"),
    ],

    async refresh(ctx) {
      subject = ctx.subject
      if (!subject) {
        calls = []
        mcp = null
        return
      }
      const agent = subject.agent
      const now = Date.now()

      const transcript = subject.sessionId
        ? await transcriptFor(agent, subject.sessionId).catch(() => null)
        : null
      calls = transcript ? await countCalls(agent, transcript).catch(() => []) : []

      const cached = await readCached(agent)
      mcp = isFresh(cached, now, agent) ? cached : null

      // Refresh in the background: a nine-second health check must never block a render.
      if (!mcp && !checking && (await claimLock(agent, now))) {
        checking = true
        void check(agent)
          .then(async (servers) => {
            if (servers) await writeCached({ agent, servers, observedAt: Date.now() })
          })
          .catch(() => {})
          .finally(() => { checking = false })
      }
    },

    render(width, style) {
      if (!subject) return []
      return toolsBlock(calls, mcp, subject.agent, width, style)
    },
  }
}
```

- [ ] **Step 5: Register the section**

In `src/pane.ts`, add the import and extend `SECTIONS`:

```ts
import { toolsSection } from "./sections/tools/index.js"

const SECTIONS: Section[] = [quotaSection(), sessionSection(), toolsSection()]
```

- [ ] **Step 6: Add the refresh action**

In `herdr-plugin.toml`, after the existing actions:

```toml
[[actions]]
id = "refresh-mcp"
title = "Refresh MCP status"
command = ["bash", "-c", "rm -f \"${SIDEBAR_STATE_DIR:-$HOME/.local/state/herdr/plugins/caoool.sidebar}\"/mcp/*.json"]
```

Deleting the cache is the whole mechanism: the next refresh finds nothing fresh, takes the lock, and re-checks.

- [ ] **Step 7: Run the full gate**

Run: `npm run check`
Expected: typecheck clean, `fail 0`, build succeeds.

- [ ] **Step 8: Verify live**

```bash
npm run build && touch dist/pane.js && sleep 10
herdr pane read "$(herdr pane list | python3 -c "import sys,json;print([p['pane_id'] for p in json.load(sys.stdin)['result']['panes'] if (p.get('label') or '')=='sidebar'][0])")" --source visible | tail -30
```

Expected: TOOLS and MCP appear below SESSION; the divider shows `↓n` when the list overflows; QUOTA stays at the top while `j`/`k` scroll the list in a focused pane.

- [ ] **Step 9: Commit**

```bash
git add src/sections/tools/ src/pane.ts herdr-plugin.toml test/tools-format.test.ts
git commit -m "Add the TOOLS/MCP section"
```

---

## Notes for the implementer

- Do not add a dependency. Every parser here is hand-written for that reason.
- When a test and the implementation disagree, the spec decides. If the spec is silent, prefer
  the reading that shows `—` over the one that shows a number.
