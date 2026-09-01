import { test } from "node:test"
import assert from "node:assert/strict"
import {
  abbreviate, best, cleanModelName, divergence, labelled, modelRows,
  sessionBanner, spread, tally, workspaceRows,
} from "../src/sections/session/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"
import type { ProjectInfo, SessionInfo } from "../src/sections/session/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

const project: ProjectInfo = {
  workspace: "herdr-sidebar-plugin", branch: "main", worktree: null, diff: "↑2 ↓1",
}

const info: SessionInfo = {
  agent: "codex", sessionId: "s", name: "Herdr sidebar plugin", model: "gpt-5.6-sol", effort: "high",
  permissionMode: "on-request", permissionModeIsGlobal: false, sandboxEnabled: true,
  context: { usedPercent: 82, windowSize: 258_400 }, outputPerSecond: 155, observedAt: Date.now(),
}

const model = (over: Partial<SessionInfo> = {}, width = 34, style = PLAIN): string =>
  modelRows({ ...info, ...over }, width, style)[0]
const context = (over: Partial<SessionInfo> = {}, width = 34, style = PLAIN): string =>
  modelRows({ ...info, ...over }, width, style)[1]

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

test("spread puts one value left and the other flush right", () => {
  const line = spread([[{ text: "Opus 5 | high" }]], [{ text: "● on-request" }], 34)
  assert.ok(line.startsWith("Opus 5 | high"))
  assert.ok(line.endsWith("● on-request"))
  assert.equal(displayWidth(line), 34)
})

test("a cramped two-part value drops its second half rather than cutting the separator", () => {
  // "Opus 5 | " with a separator joining nothing reads as a rendering bug, not as a value that
  // did not fit.
  const full = [{ text: "gpt-5.6-sol" }, { text: " | " }, { text: "high" }]
  const bare = [{ text: "gpt-5.6-sol" }]
  assert.deepEqual(best([full, bare], 30), full, "it fits whole, so it is used whole")
  assert.deepEqual(best([full, bare], 12), bare, "it does not, so the second half goes")
})

test("the last candidate is still cut when even it will not fit", () => {
  const only = [{ text: "a-very-long-model-identifier" }]
  const got = best([only], 8)
  assert.ok(displayWidth(got.map((s) => s.text).join("")) <= 8)
})

test("the model row is model, effort and mode — no labels", () => {
  const line = model()
  assert.ok(line.startsWith("gpt-5.6-sol | high"), line)
  assert.ok(line.endsWith("● on-request"), line)
  assert.doesNotMatch(line, /MODEL|MODE\b/)
  assert.equal(displayWidth(line), 34)
})

test("the context row is usage and speed — no labels, no gauge", () => {
  const line = context()
  assert.ok(line.startsWith("82% | 258K"), line)
  assert.ok(line.endsWith("155 t/s"), line)
  assert.ok(!line.includes("█") && !line.includes("░"), `gauge left in: ${line}`)
  assert.equal(displayWidth(line), 34)
})

test("an unsandboxed agent shows an unlit dot, not a missing one", () => {
  assert.ok(model({ sandboxEnabled: false }).endsWith("○ on-request"))
})

test("unknown sandbox state is a dash rather than a guessed dot", () => {
  assert.ok(model({ sandboxEnabled: null }).endsWith("— on-request"))
})

test("context reaches red later than quota does", () => {
  // Quota at 82% means most of a period is gone with no recourse but to wait. Context at 82%
  // is ordinary working territory, so it stays orange and turns red only near compaction.
  assert.match(context({}, 34, TERMINAL), /\x1b\[38;5;208m82%/)
  assert.match(
    context({ context: { usedPercent: 90, windowSize: 258_400 } }, 34, TERMINAL),
    /\x1b\[38;5;203m90%/)
})

test("a low context reading is green, like a low quota reading", () => {
  assert.match(
    context({ context: { usedPercent: 12, windowSize: 1_000_000 } }, 34, TERMINAL),
    /\x1b\[38;5;41m12%/)
})

test("the sandbox dot is lit green and unlit dim", () => {
  assert.match(model({}, 34, TERMINAL), /\x1b\[38;5;41m●/)
  assert.match(model({ sandboxEnabled: false }, 34, TERMINAL), /\x1b\[2m○/)
})

test("half a two-part value still renders the other half", () => {
  assert.ok(model({ effort: null }).startsWith("gpt-5.6-sol"))
  assert.ok(context({ context: { usedPercent: null, windowSize: 258_400 } }).startsWith("— | 258K"))
})

test("no session means no model rows at all", () => {
  assert.deepEqual(modelRows(null, 30, PLAIN), [])
})

test("no project means no workspace rows at all", () => {
  assert.deepEqual(workspaceRows(null, 30, PLAIN), [])
})

test("styling leaves every row the same width", () => {
  assert.deepEqual(modelRows(info, 34, TERMINAL).map(strip), modelRows(info, 34, PLAIN))
  assert.deepEqual(workspaceRows(project, 34, TERMINAL).map(strip), workspaceRows(project, 34, PLAIN))
})

test("the session name is the banner, alone at the top of the pane", () => {
  const [banner] = sessionBanner(info, 34, PLAIN)
  assert.equal(banner, "Herdr sidebar plugin")
  assert.doesNotMatch(banner, /SESSION/)
})

test("an unnamed session has no banner rather than an empty one", () => {
  assert.deepEqual(sessionBanner({ ...info, name: null }, 30, PLAIN), [])
  assert.deepEqual(sessionBanner(null, 30, PLAIN), [])
})

test("a long name is cut with an ellipsis, keeping its distinguishing start", () => {
  const [banner] = sessionBanner({ ...info, name: "Herdr sidebar plugin validation and rollout" }, 30, PLAIN)
  assert.ok(displayWidth(banner) <= 30)
  assert.ok(banner.endsWith("…"), banner)
  assert.ok(banner.includes("Herdr sidebar"))
})

test("the workspace block is the name, then the branch with its divergence", () => {
  const [name, branch] = workspaceRows(project, 34, PLAIN)
  assert.equal(name, "herdr-sidebar-plugin")
  assert.ok(branch.startsWith("main"))
  assert.ok(branch.endsWith("↑2 ↓1"))
  assert.doesNotMatch(branch, /WORKSPACE|BRANCH|DIFF/)
})

test("a worktree rides the branch behind a slash", () => {
  const [, branch] = workspaceRows({ ...project, worktree: "feature-x" }, 34, PLAIN)
  assert.ok(branch.startsWith("main/feature-x"), branch)
})

test("a cramped branch row drops the worktree, never the branch", () => {
  const [, branch] = workspaceRows({ ...project, worktree: "a-long-worktree-name" }, 20, PLAIN)
  assert.ok(strip(branch).startsWith("main"), branch)
  assert.ok(!branch.includes("main/a-long"), "the worktree gave way whole")
  assert.equal(displayWidth(branch), 20)
})

test("no divergence prints nothing rather than zeros", () => {
  // A branch level with its upstream has nothing to report, and zeros would make the ordinary
  // case the loudest row.
  const [, branch] = workspaceRows({ ...project, diff: "" }, 34, PLAIN)
  assert.equal(branch.trimEnd(), "main")
})

test("divergence reads like herdr's own, and is silent when there is none", () => {
  assert.equal(divergence(2, 1), "↑2 ↓1")
  assert.equal(divergence(3, 0), "↑3")
  assert.equal(divergence(0, 4), "↓4")
  assert.equal(divergence(0, 0), "")
  assert.equal(divergence(null, null), "")
})

test("every stand-in dash is dimmed, wherever it appears", () => {
  const bare = modelRows(
    { ...info, model: null, effort: null, permissionMode: null, sandboxEnabled: null,
      context: { usedPercent: null, windowSize: null }, outputPerSecond: null },
    34, TERMINAL,
  ).concat(workspaceRows({ workspace: null, branch: null, worktree: null, diff: "" }, 34, TERMINAL))
  for (const line of bare) {
    assert.ok(strip(line).includes("—"), `should show a dash: ${JSON.stringify(strip(line))}`)
    assert.match(line, /\x1b\[2m—/, `dash should be dimmed: ${JSON.stringify(line)}`)
  }
})

test("dimming a dash does not change the row's width", () => {
  const bare = { model: null, effort: null }
  assert.equal(strip(model(bare, 34, TERMINAL)), model(bare, 34, PLAIN))
})

test("a tally is dimmed throughout — it is context for a list, not a reading", () => {
  const line = tally("tools", "108", 30, TERMINAL)
  assert.equal(strip(line), labelled("tools", [{ text: "108" }], 30))
  assert.match(line, /^\x1b\[2mtools\x1b\[0m/, "the name is dimmed")
  assert.match(line, /\x1b\[2m108\x1b\[0m$/, "so is the figure")
})

test("a tally with nothing to count shows a dash", () => {
  assert.ok(strip(tally("mcp", null, 30, PLAIN)).endsWith("—"))
})
