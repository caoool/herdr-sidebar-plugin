import { test } from "node:test"
import assert from "node:assert/strict"
import { abbreviate, labelled, sessionBlock, cleanModelName, divergence } from "../src/sections/session/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import type { ProjectInfo, SessionInfo } from "../src/sections/session/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

/**
 * Find a row by its label, so adding or reordering rows does not break every assertion.
 * The trailing space matters: "MODE" is a prefix of "MODEL".
 */
const row = (lines: string[], label: string): string =>
  lines.find((l) => strip(l).startsWith(label + " ")) ?? ""

const project: ProjectInfo = {
  workspace: "herdr-sidebar-plugin", branch: "main", worktree: null, diff: "↑2 ↓1",
}

const info: SessionInfo = {
  agent: "codex", sessionId: "s", name: "Herdr sidebar plugin", model: "gpt-5.6-sol", effort: "high",
  permissionMode: "on-request", permissionModeIsGlobal: false, sandboxEnabled: true,
  context: { usedPercent: 82, windowSize: 258_400 }, outputPerSecond: 155, observedAt: Date.now(),
}

test("token counts abbreviate without noise", () => {
  assert.equal(abbreviate(258_400), "258K")
  assert.equal(abbreviate(1_000_000), "1M")
  assert.equal(abbreviate(1_500_000), "1.5M")
  assert.equal(abbreviate(940), "940")
})

test("model names lose their parenthetical asides", () => {
  assert.equal(cleanModelName("Opus 5 (1M context) (default)"), "Opus 5")
  assert.equal(cleanModelName("gpt-5.6-sol"), "gpt-5.6-sol")
  assert.equal(cleanModelName(null), null)
})

test("a name that is entirely parenthetical is kept rather than blanked", () => {
  assert.equal(cleanModelName("(unknown)"), "(unknown)")
})

test("a labelled row puts the label left and the value flush right", () => {
  const line = labelled("MODEL", [{ text: "Opus 5 | high" }], 30)
  assert.ok(line.startsWith("MODEL"))
  assert.ok(line.endsWith("Opus 5 | high"))
  assert.equal(line.length, 30)
})

test("painting a segment never changes the row's width", () => {
  const plain = labelled("CONTEXT", [{ text: "82%" }], 30)
  const painted = labelled("CONTEXT", [{ text: "82%", paint: (t) => `\x1b[31m${t}\x1b[0m` }], 30)
  assert.equal(strip(painted), plain)
})

test("the block is the four specified rows, titled, with no gauge", () => {
  const lines = sessionBlock(info, project, 30, PLAIN)
  assert.ok(lines[0].startsWith("SESSION"), "the heading leads, now carrying the name")
  assert.equal(lines[1], "")
  assert.ok(row(lines, "MODEL").endsWith("gpt-5.6-sol | high"))
  assert.ok(row(lines, "MODE").endsWith("● on-request"))
  assert.ok(row(lines, "CONTEXT").endsWith("82% | 258K"))
  assert.ok(row(lines, "SPEED").endsWith("155 t/s"))
  for (const l of lines) assert.ok(!l.includes("█") && !l.includes("░"), `gauge left in: ${l}`)
})

test("an unsandboxed agent shows an unlit dot, not a missing one", () => {
  const mode = row(sessionBlock({ ...info, sandboxEnabled: false }, project, 30, PLAIN), "MODE")
  assert.ok(mode.endsWith("○ on-request"), mode)
})

test("unknown sandbox state is a dash rather than a guessed dot", () => {
  const mode = row(sessionBlock({ ...info, sandboxEnabled: null }, project, 30, PLAIN), "MODE")
  assert.ok(mode.endsWith("— on-request"), mode)
})

test("context reaches red later than quota does", () => {
  // Quota at 82% means most of a period is gone with no recourse but to wait. Context at 82%
  // is ordinary working territory, so it stays orange and turns red only near compaction.
  const orange = row(sessionBlock(info, project, 30, TERMINAL), "CONTEXT")
  assert.match(orange, /\x1b\[38;5;208m82%/)

  const near = { ...info, context: { usedPercent: 90, windowSize: 258_400 } }
  const red = row(sessionBlock(near, project, 30, TERMINAL), "CONTEXT")
  assert.match(red, /\x1b\[38;5;203m90%/)
})

test("a low context reading is green, like a low quota reading", () => {
  const low = { ...info, context: { usedPercent: 12, windowSize: 1_000_000 } }
  const context = row(sessionBlock(low, project, 30, TERMINAL), "CONTEXT")
  assert.match(context, /\x1b\[38;5;41m12%/)
})

test("the sandbox dot is lit green and unlit dim", () => {
  const on = row(sessionBlock(info, project, 30, TERMINAL), "MODE")
  assert.match(on, /\x1b\[38;5;41m●/)
  const off = row(sessionBlock({ ...info, sandboxEnabled: false }, project, 30, TERMINAL), "MODE")
  assert.match(off, /\x1b\[2m○/)
})

test("half a two-part value still renders the other half", () => {
  const model = row(sessionBlock({ ...info, effort: null }, project, 30, PLAIN), "MODEL")
  assert.ok(model.endsWith("gpt-5.6-sol"), model)
  const partial = { ...info, context: { usedPercent: null, windowSize: 258_400 } }
  const context = row(sessionBlock(partial, project, 30, PLAIN), "CONTEXT")
  assert.ok(context.endsWith("— | 258K"), context)
})

test("no session means no block at all", () => {
  assert.deepEqual(sessionBlock(null, null, 30, PLAIN), [])
})

test("row labels are dimmed, values are not", () => {
  const model = row(sessionBlock(info, project, 30, TERMINAL), "MODEL")
  assert.match(model, /^\x1b\[38;5;250mMODEL\x1b\[0m/)
  assert.ok(model.endsWith("gpt-5.6-sol | high"), "the value keeps full strength")
})

test("styling leaves every row the same width", () => {
  const plain = sessionBlock(info, project, 30, PLAIN)
  const styled = sessionBlock(info, project, 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
})

test("the session name rides the heading, in bold, flush right", () => {
  const [heading] = sessionBlock(info, project, 34, TERMINAL)
  assert.match(strip(heading), /^SESSION\s+Herdr sidebar plugin$/)
  assert.match(heading, /\x1b\[1mHerdr sidebar plugin\x1b\[0m$/)
  assert.equal(strip(heading).length, 34)
})

test("an unnamed session leaves the heading bare rather than trailing a dash", () => {
  const [heading, , first] = sessionBlock({ ...info, name: null }, project, 30, PLAIN)
  assert.equal(heading, "SESSION")
  assert.ok(first.startsWith("MODEL"))
})

test("a long name is cut with an ellipsis, keeping its distinguishing start", () => {
  const long = { ...info, name: "Herdr sidebar plugin validation and rollout" }
  const [heading] = sessionBlock(long, project, 30, PLAIN)
  assert.equal(heading.length, 30)
  assert.ok(heading.endsWith("…"), heading)
  assert.ok(heading.includes("Herdr sidebar"))
})

test("project rows follow the session rows after a blank line", () => {
  const lines = sessionBlock(info, project, 34, PLAIN)
  const labels = lines.map((l) => l.split(" ")[0]).filter(Boolean)
  assert.deepEqual(labels, ["SESSION", "MODEL", "MODE", "CONTEXT", "SPEED", "WORKSPACE", "BRANCH", "WORKTREE", "DIFF"])
  // exactly one blank line inside the block, separating the two groups
  assert.equal(lines.filter((l) => l === "").length, 2)
  assert.equal(lines[1], "", "the heading's own blank row")
})

test("project values render flush right like the rest", () => {
  const lines = sessionBlock(info, project, 34, PLAIN)
  assert.ok(row(lines, "WORKSPACE").endsWith("herdr-sidebar-plugin"))
  assert.ok(row(lines, "BRANCH").endsWith("main"))
  assert.ok(row(lines, "DIFF").endsWith("↑2 ↓1"))
})

test("absent project values keep their row with a dash", () => {
  const lines = sessionBlock(info, { ...project, worktree: null, diff: "" }, 34, PLAIN)
  assert.ok(row(lines, "WORKTREE").endsWith("—"))
  assert.ok(row(lines, "DIFF").endsWith("—"))
})

test("the project half stands alone when there is no agent reading", () => {
  const lines = sessionBlock(null, project, 34, PLAIN)
  assert.equal(lines[0], "SESSION")
  assert.ok(row(lines, "WORKSPACE").endsWith("herdr-sidebar-plugin"))
  assert.equal(lines.filter((l) => l === "").length, 1, "no separator with nothing to separate")
})

test("divergence reads like herdr's own, and is silent when there is none", () => {
  assert.equal(divergence(2, 1), "↑2 ↓1")
  assert.equal(divergence(3, 0), "↑3")
  assert.equal(divergence(0, 4), "↓4")
  assert.equal(divergence(0, 0), "")
  assert.equal(divergence(null, null), "")
})
