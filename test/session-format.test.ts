import { test } from "node:test"
import assert from "node:assert/strict"
import { abbreviate, labelled, sessionBlock, cleanModelName } from "../src/sections/session/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import type { SessionInfo } from "../src/sections/session/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

const info: SessionInfo = {
  agent: "codex", sessionId: "s", model: "gpt-5.6-sol", effort: "high",
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
  const line = labelled("Model", [{ text: "Opus 5 | high" }], 30)
  assert.ok(line.startsWith("Model"))
  assert.ok(line.endsWith("Opus 5 | high"))
  assert.equal(line.length, 30)
})

test("painting a segment never changes the row's width", () => {
  const plain = labelled("Context", [{ text: "82%" }], 30)
  const painted = labelled("Context", [{ text: "82%", paint: (t) => `\x1b[31m${t}\x1b[0m` }], 30)
  assert.equal(strip(painted), plain)
})

test("the block is the four specified rows, titled, with no gauge", () => {
  const lines = sessionBlock(info, 30, PLAIN)
  assert.equal(lines.length, 6)
  assert.equal(lines[0], "SESSION")
  assert.equal(lines[1], "")
  assert.ok(lines[2].startsWith("Model") && lines[2].endsWith("gpt-5.6-sol | high"))
  assert.ok(lines[3].startsWith("Mode") && lines[3].endsWith("SB ● on-request"))
  assert.ok(lines[4].startsWith("Context") && lines[4].endsWith("82% | 258K"))
  assert.ok(lines[5].startsWith("Speed") && lines[5].endsWith("155 t/s"))
  for (const l of lines) assert.ok(!l.includes("█") && !l.includes("░"), `gauge left in: ${l}`)
})

test("an unsandboxed agent shows an unlit dot, not a missing one", () => {
  const [, , , mode] = sessionBlock({ ...info, sandboxEnabled: false }, 30, PLAIN)
  assert.ok(mode.endsWith("SB ○ on-request"), mode)
})

test("unknown sandbox state is a dash rather than a guessed dot", () => {
  const [, , , mode] = sessionBlock({ ...info, sandboxEnabled: null }, 30, PLAIN)
  assert.ok(mode.endsWith("SB — on-request"), mode)
})

test("the context percentage carries the same ramp as quota", () => {
  // 82% is the red band; a reader who learned the ramp on quota reads it here unchanged.
  const [, , , , context] = sessionBlock(info, 30, TERMINAL)
  assert.match(context, /\x1b\[38;5;203m82%/)
})

test("a low context reading is green, like a low quota reading", () => {
  const low = { ...info, context: { usedPercent: 12, windowSize: 1_000_000 } }
  const [, , , , context] = sessionBlock(low, 30, TERMINAL)
  assert.match(context, /\x1b\[38;5;41m12%/)
})

test("the sandbox dot is lit green and unlit dim", () => {
  const [, , , on] = sessionBlock(info, 30, TERMINAL)
  assert.match(on, /\x1b\[38;5;41m●/)
  const [, , , off] = sessionBlock({ ...info, sandboxEnabled: false }, 30, TERMINAL)
  assert.match(off, /\x1b\[2m○/)
})

test("half a two-part value still renders the other half", () => {
  const [, , model] = sessionBlock({ ...info, effort: null }, 30, PLAIN)
  assert.ok(model.endsWith("gpt-5.6-sol"), model)
  const partial = { ...info, context: { usedPercent: null, windowSize: 258_400 } }
  const [, , , , context] = sessionBlock(partial, 30, PLAIN)
  assert.ok(context.endsWith("— | 258K"), context)
})

test("no session means no block at all", () => {
  assert.deepEqual(sessionBlock(null, 30, PLAIN), [])
})

test("styling leaves every row the same width", () => {
  const plain = sessionBlock(info, 30, PLAIN)
  const styled = sessionBlock(info, 30, TERMINAL).map(strip)
  assert.deepEqual(styled, plain)
})
