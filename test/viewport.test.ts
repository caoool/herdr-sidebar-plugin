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
