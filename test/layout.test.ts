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
