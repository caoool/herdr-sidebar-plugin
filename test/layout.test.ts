import { test } from "node:test"
import assert from "node:assert/strict"
import { allocate, compose, MIN_REGION } from "../src/layout.js"
import { PLAIN } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"

const rows = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`)
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")
const region = (p: string, n: number, maxBody?: number) =>
  ({ head: [`${p}-head`, ""], body: rows(p, n), maxBody })

test("allocate gives every region its floor before anyone gets seconds", () => {
  // The whole point: a 40-tool list must not take rows the server list has not been offered.
  const got = allocate([40, 13], 20)
  assert.ok(got[1] >= MIN_REGION, `MCP got ${got[1]} rows`)
  assert.equal(got[0] + got[1], 20)
})

test("allocate never hands out more than it has", () => {
  for (const available of [0, 1, 5, 9, 50]) {
    const got = allocate([40, 13], available)
    assert.ok(got.reduce((a, b) => a + b, 0) <= available)
  }
})

test("allocate does not waste rows on a region wanting less than the floor", () => {
  const got = allocate([2, 40], 20)
  assert.equal(got[0], 2, "a two-row region takes two rows, not the floor")
  assert.equal(got[1], 18)
})

test("allocate splits the surplus evenly rather than first-come", () => {
  const got = allocate([100, 100], 20)
  assert.deepEqual(got, [10, 10])
})

test("with room for everything there are no dividers and no scrolling", () => {
  const { lines, offsets } = compose(rows("p", 3), [region("t", 4), region("m", 3)], 40, 20, [0, 0], 0, PLAIN)
  assert.deepEqual(lines, [...rows("p", 3), "t-head", "", ...rows("t", 4), "m-head", "", ...rows("m", 3)])
  assert.deepEqual(offsets, [0, 0])
})

test("the composed block never exceeds the height it was given", () => {
  for (const height of [6, 10, 20, 40]) {
    const { lines } = compose(rows("p", 5), [region("t", 50), region("m", 13)], height, 20, [0, 0], 0, PLAIN)
    assert.ok(lines.length <= height, `height ${height} produced ${lines.length} rows`)
  }
})

test("both regions stay on screen no matter how long the first one is", () => {
  const { lines } = compose(rows("p", 4), [region("t", 200), region("m", 13)], 24, 20, [0, 0], 0, PLAIN)
  assert.ok(lines.some((l) => strip(l).startsWith("t")), "TOOLS is present")
  assert.ok(lines.some((l) => strip(l).startsWith("m")), "MCP is present")
})

test("a clipped region declares what it is hiding", () => {
  const { lines } = compose(rows("p", 2), [region("t", 60), region("m", 13)], 20, 20, [0, 0], 0, PLAIN)
  const dividers = lines.filter((l) => strip(l).includes("↓") || strip(l).includes("↑"))
  assert.ok(dividers.length >= 1, "at least one region shows an overflow marker")
  for (const d of dividers) assert.equal(displayWidth(strip(d)), 20, "the divider spans the width")
})

test("each region scrolls on its own offset", () => {
  const a = compose(rows("p", 2), [region("t", 60), region("m", 60)], 24, 20, [0, 0], 0, PLAIN)
  const b = compose(rows("p", 2), [region("t", 60), region("m", 60)], 24, 20, [5, 0], 0, PLAIN)
  // Body rows only — the heading is pinned inside its region and must not move either way.
  const bodyA = a.lines.filter((l) => /^t\d+$/.test(strip(l)))
  const bodyB = b.lines.filter((l) => /^t\d+$/.test(strip(l)))
  assert.notDeepEqual(bodyA, bodyB, "scrolling region 0 moved region 0")
  const mcpA = a.lines.filter((l) => /^m\d+$/.test(strip(l)))
  const mcpB = b.lines.filter((l) => /^m\d+$/.test(strip(l)))
  assert.deepEqual(mcpA, mcpB, "scrolling region 0 left region 1 untouched")
})

test("an out-of-range offset clamps and is returned for the caller to store", () => {
  const { offsets } = compose(rows("p", 2), [region("t", 60), region("m", 13)], 24, 20, [999, 0], 0, PLAIN)
  assert.ok(offsets[0] < 999)
})

test("the focused region's marker is distinguishable from the unfocused one", () => {
  const style = { bold: (s: string) => `\x1b[1m${s}\x1b[0m`, paint: (t: string) => t,
                  muted: (s: string) => `\x1b[2m${s}\x1b[0m` }
  const first = compose(rows("p", 2), [region("t", 60), region("m", 60)], 24, 20, [0, 0], 0, style)
  const second = compose(rows("p", 2), [region("t", 60), region("m", 60)], 24, 20, [0, 0], 1, style)
  assert.notDeepEqual(first.lines, second.lines, "moving focus changes which marker is bright")
})

test("a short pane sacrifices pinned rows rather than the regions", () => {
  const { lines } = compose(rows("p", 20), [region("t", 30), region("m", 30)], 12, 20, [0, 0], 0, PLAIN)
  assert.ok(lines.some((l) => strip(l).startsWith("t")))
  assert.ok(lines.some((l) => strip(l).startsWith("m")))
  assert.equal(strip(lines[0]), "p0", "the top of the pinned block survives")
})

test("no regions at all still renders the pinned block", () => {
  const { lines } = compose(rows("p", 3), [], 40, 20, [], 0, PLAIN)
  assert.deepEqual(lines, rows("p", 3))
})

test("a capped region shows only its cap, however much room the pane has", () => {
  // Five items each is the point: the sidebar stays compact even on a tall terminal.
  const { lines } = compose([], [region("t", 40, 5)], 200, 20, [0], 0, PLAIN)
  const items = lines.filter((l) => /^t\d+$/.test(strip(l)))
  assert.equal(items.length, 5)
})

test("a region's head stays put while its body scrolls", () => {
  const top = compose([], [region("t", 40, 5)], 200, 20, [0], 0, PLAIN)
  const down = compose([], [region("t", 40, 5)], 200, 20, [6], 0, PLAIN)
  assert.equal(strip(top.lines[0]), "t-head")
  assert.equal(strip(down.lines[0]), "t-head", "the heading does not scroll away")
  assert.notEqual(strip(top.lines[2]), strip(down.lines[2]), "the body did move")
})

test("a capped region still declares the rest is there", () => {
  const { lines } = compose([], [region("t", 40, 5)], 200, 20, [0], 0, PLAIN)
  assert.ok(lines.some((l) => strip(l).includes("↓")), "an overflow marker is shown")
})

test("a body inside the cap needs no marker", () => {
  const { lines } = compose([], [region("t", 3, 5)], 200, 20, [0], 0, PLAIN)
  assert.ok(!lines.some((l) => strip(l).includes("↓") || strip(l).includes("↑")))
})

test("both capped regions fit together on a tall pane", () => {
  const { lines } = compose(rows("p", 5), [region("t", 40, 5), region("m", 13, 5)], 76, 20, [0, 0], 0, PLAIN)
  assert.equal(lines.filter((l) => /^t\d+$/.test(strip(l))).length, 5)
  assert.equal(lines.filter((l) => /^m\d+$/.test(strip(l))).length, 5)
  assert.ok(lines.length <= 76)
})
