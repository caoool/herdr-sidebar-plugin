import { test } from "node:test"
import assert from "node:assert/strict"
import { displayWidth, truncateToWidth } from "../src/width.js"
import { labelled } from "../src/sections/session/format.js"
import { sessionBlock } from "../src/sections/session/format.js"
import { PLAIN } from "../src/ansi.js"
import type { ProjectInfo, SessionInfo } from "../src/sections/session/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

test("a CJK name is measured in columns, not characters", () => {
  // The real session name that wrapped the sidebar: 8 characters, 14 columns.
  assert.equal("AI使用分享文档".length, 8)
  assert.equal(displayWidth("AI使用分享文档"), 14)
})

test("ASCII is one column per character, and escapes occupy none", () => {
  assert.equal(displayWidth("Bash"), 4)
  assert.equal(displayWidth("\x1b[38;5;250mBash\x1b[0m"), 4)
})

test("truncation never splits a wide character across the boundary", () => {
  // Cutting 使 in half would leave a row one column over, which is the bug being fixed.
  for (let budget = 1; budget <= 14; budget++) {
    const cut = truncateToWidth("AI使用分享文档", budget)
    assert.ok(displayWidth(cut) <= budget, `budget ${budget} produced ${displayWidth(cut)} columns`)
  }
})

test("a string already inside the budget is left alone", () => {
  assert.equal(truncateToWidth("使用", 4), "使用")
  assert.equal(truncateToWidth("Bash", 10), "Bash")
})

test("a labelled row with a CJK value is exactly the requested width", () => {
  const line = labelled("SESSION", [{ text: "使用分享文档" }], 30)
  assert.equal(displayWidth(line), 30)
})

const project: ProjectInfo = { workspace: "dotfiles", branch: "main", worktree: null, diff: "" }
const info: SessionInfo = {
  agent: "grok", sessionId: "s", name: "AI使用分享文档", model: "grok-4.6", effort: "xhigh",
  permissionMode: "always-approve", permissionModeIsGlobal: false, sandboxEnabled: false,
  context: { usedPercent: 62, windowSize: 500_000 }, outputPerSecond: 40, observedAt: Date.now(),
}

test("every row of a CJK-named session fits its column budget", () => {
  // A row over budget wraps, which pushes the frame past the pane height and makes the whole
  // sidebar scroll — the symptom this measures against.
  for (const width of [20, 30, 34]) {
    for (const line of sessionBlock(info, project, width, PLAIN)) {
      if (!line) continue
      assert.ok(displayWidth(strip(line)) <= width,
        `width ${width}: ${displayWidth(strip(line))} columns in ${JSON.stringify(line)}`)
    }
  }
})

test("the heading keeps the name on one row rather than wrapping it", () => {
  const [heading] = sessionBlock(info, project, 30, PLAIN)
  assert.ok(!heading.includes("\n"))
  assert.equal(displayWidth(heading), 30)
})
