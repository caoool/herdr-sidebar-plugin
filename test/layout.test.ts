import { test } from "node:test"
import assert from "node:assert/strict"
import { compose, natural, live, FLEX_FLOOR, type Frame, type Region } from "../src/layout.js"
import { PLAIN } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"

const rows = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`)
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")
const region = (p: string, n: number, cap?: number): Region =>
  ({ head: [`${p}-head`], body: rows(p, n), cap })
const frame = (over: Partial<Frame> = {}): Frame =>
  ({ banner: [], top: [], flex: null, bottom: [], ...over })

const bodyOf = (lines: string[], p: string): string[] =>
  lines.filter((l) => new RegExp(`^${p}\\d+$`).test(strip(l)))

test("a cap counts items shown, and the marker is an extra row", () => {
  // Raising the cap by one must show one more item. Spending a capped row on the marker was
  // the earlier reading, and it made "cap at 3" show two.
  const r = region("t", 40, 3)
  assert.equal(natural(r), 1 + 3 + 1)
  const { lines } = compose(frame({ bottom: [r] }), 200, 20, [0], PLAIN)
  assert.equal(bodyOf(lines, "t").length, 3)
})

test("a body inside its cap needs no marker", () => {
  const r = region("t", 3, 5)
  assert.equal(natural(r), 1 + 3)
  const { lines } = compose(frame({ bottom: [r] }), 200, 20, [0], PLAIN)
  assert.ok(!lines.some((l) => strip(l).includes("↓") || strip(l).includes("↑")))
})

test("an empty region is not live and costs nothing", () => {
  assert.ok(!live({ head: [], body: [] }))
  assert.ok(live({ head: ["x"], body: [] }))
  assert.ok(live({ head: [], body: ["x"] }))
})

test("the frame is exactly the height it was given, blanks and all", () => {
  for (const height of [6, 12, 20, 40, 80]) {
    const { lines } = compose(
      frame({ banner: ["name"], top: [region("q", 3)], flex: region("d", 24),
              bottom: [region("t", 40, 3), region("w", 2)] }),
      height, 20, [], PLAIN,
    )
    assert.ok(lines.length <= height, `height ${height} produced ${lines.length} rows`)
  }
})

test("the bottom band sits against the foot of the pane", () => {
  const { lines } = compose(
    frame({ top: [region("q", 3)], flex: region("d", 2), bottom: [region("w", 2)] }),
    30, 20, [], PLAIN,
  )
  assert.equal(strip(lines[lines.length - 1]), "w1", "the last row is the last bottom row")
  assert.equal(strip(lines[0]), "q-head", "the top band is still at the top")
})

test("slack shows as blank between the flexible band and the foot", () => {
  const { lines } = compose(
    frame({ top: [region("q", 2)], flex: region("d", 2), bottom: [region("w", 2)] }),
    30, 20, [], PLAIN,
  )
  const firstBlank = lines.indexOf("", lines.indexOf("d1"))
  assert.ok(firstBlank > 0)
  assert.ok(lines.slice(firstBlank, lines.length - 3).every((l) => l === ""))
})

test("the flexible region expands to fill the pane", () => {
  const short = compose(frame({ flex: region("d", 40) }), 12, 20, [0], PLAIN)
  const tall = compose(frame({ flex: region("d", 40) }), 30, 20, [0], PLAIN)
  assert.ok(bodyOf(tall.lines, "d").length > bodyOf(short.lines, "d").length,
    "a taller pane shows more of the flexible list")
})

test("the flexible region is the only one that grows with the pane", () => {
  const tall = compose(
    frame({ flex: region("d", 40), bottom: [region("t", 40, 3)] }), 60, 20, [], PLAIN)
  assert.equal(bodyOf(tall.lines, "t").length, 3, "the capped list keeps its cap")
})

test("a short pane drops whole bottom regions, never part of one", () => {
  // Trimming a region by rows strands its overflow marker: a row claiming to hide items from a
  // list that is no longer on screen.
  const { lines } = compose(
    frame({ top: [region("q", 3)], flex: region("d", 24),
            bottom: [region("t", 40, 3), region("m", 40, 3), region("w", 2)] }),
    16, 20, [], PLAIN,
  )
  const heads = lines.map(strip).filter((l) => l.endsWith("-head"))
  for (const head of heads) {
    const prefix = head.split("-")[0]
    assert.ok(lines.some((l) => strip(l).startsWith(`${prefix}0`)),
      `${prefix} kept its head but lost its body`)
  }
})

test("the workspace block is the last thing to go", () => {
  const { lines } = compose(
    frame({ top: [region("q", 3)], flex: region("d", 24),
            bottom: [region("t", 40, 3), region("m", 40, 3), region("w", 2)] }),
    14, 20, [], PLAIN,
  )
  assert.ok(lines.some((l) => strip(l) === "w-head"), "the last bottom region survives")
})

test("the flexible region keeps a floor rather than being squeezed to nothing", () => {
  // A capped list holding three rows while the section that is meant to expand shows none is
  // the exact inversion of what makes it flexible.
  const { lines } = compose(
    frame({ top: [region("q", 3)], flex: region("d", 24),
            bottom: [region("t", 40, 3), region("m", 40, 3), region("w", 2)] }),
    16, 20, [], PLAIN,
  )
  assert.ok(bodyOf(lines, "d").length >= FLEX_FLOOR - 2, "the flexible list still has rows")
})

test("the top band gives way from its foot, so the banner survives", () => {
  const { lines } = compose(
    frame({ banner: ["name"], top: [region("q", 3), region("s", 20)], bottom: [region("w", 2)] }),
    10, 20, [], PLAIN,
  )
  assert.equal(strip(lines[0]), "name")
  assert.ok(lines.some((l) => strip(l) === "w-head"), "the foot survives too")
})

test("a clipped region declares what it is hiding, flush right", () => {
  const { lines } = compose(frame({ bottom: [region("t", 60, 3)] }), 20, 20, [0], PLAIN)
  const markers = lines.filter((l) => strip(l).includes("↓") || strip(l).includes("↑"))
  assert.equal(markers.length, 1)
  assert.equal(displayWidth(strip(markers[0])), 20, "the marker spans the width")
  assert.match(strip(markers[0]), /↓57$/)
})

test("each region scrolls on its own offset", () => {
  const f = frame({ flex: region("d", 60), bottom: [region("t", 60, 3)] })
  const a = compose(f, 24, 20, [0, 0], PLAIN)
  const b = compose(f, 24, 20, [5, 0], PLAIN)
  assert.notDeepEqual(bodyOf(a.lines, "d"), bodyOf(b.lines, "d"), "the flexible list moved")
  assert.deepEqual(bodyOf(a.lines, "t"), bodyOf(b.lines, "t"), "the capped list did not")
})

test("a region's head stays put while its body scrolls", () => {
  const f = frame({ bottom: [region("t", 40, 3)] })
  const top = compose(f, 200, 20, [0], PLAIN)
  const down = compose(f, 200, 20, [6], PLAIN)
  const headAt = (ls: string[]) => ls.findIndex((l) => strip(l) === "t-head")
  assert.equal(headAt(top.lines), headAt(down.lines), "the head did not move")
  assert.notDeepEqual(bodyOf(top.lines, "t"), bodyOf(down.lines, "t"), "the body did")
})

test("an out-of-range offset clamps and is returned for the caller to store", () => {
  const { offsets } = compose(frame({ bottom: [region("t", 60, 3)] }), 24, 20, [999], PLAIN)
  assert.ok(offsets[0] < 999)
  assert.equal(offsets[0], 57, "clamped to the last full screen, not past the end")
})

test("spans locate every region, indexed in visual order", () => {
  const { lines, spans } = compose(
    frame({ banner: ["name"], top: [region("q", 3)], flex: region("d", 20),
            bottom: [region("t", 40, 3), region("w", 2)] }),
    40, 20, [], PLAIN,
  )
  assert.equal(spans.length, 4, "one span per region: top, flex, then bottom")
  for (const s of spans) {
    assert.ok(s.start >= 0 && s.end >= s.start, `bad span ${JSON.stringify(s)}`)
    assert.ok(s.end < lines.length, "a span cannot point past the output")
  }
  // Ordered down the screen, and never overlapping.
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i - 1].end < spans[i].start, `spans ${i - 1} and ${i} overlap`)
  }
  // Every row the flex span covers belongs to the flex region.
  for (let i = spans[1].start; i <= spans[1].end; i++) {
    const line = strip(lines[i])
    assert.ok(line === "d-head" || /^d\d+$/.test(line) || line.includes("↓"),
      `row ${i} is not part of the flexible region: ${JSON.stringify(line)}`)
  }
})

test("a region pushed off the pane reports no span, keeping the indices aligned", () => {
  const { spans } = compose(
    frame({ top: [region("q", 3)], flex: region("d", 24),
            bottom: [region("t", 40, 3), region("w", 2)] }),
    12, 20, [], PLAIN,
  )
  assert.equal(spans.length, 4)
  assert.deepEqual(spans[2], { start: -1, end: -1 }, "the dropped region has no span")
  assert.ok(spans[3].start >= 0, "the surviving one still does")
})

test("the banner is outside every span", () => {
  const { spans } = compose(
    frame({ banner: ["name", ""], top: [region("q", 3)] }), 40, 20, [], PLAIN)
  assert.ok(spans[0].start >= 2, "spans begin after the banner")
})

test("nothing to draw renders nothing", () => {
  const { lines, spans } = compose(frame(), 40, 20, [], PLAIN)
  assert.deepEqual(lines, [])
  assert.deepEqual(spans, [])
})

test("a banner alone renders alone", () => {
  const { lines } = compose(frame({ banner: ["name"] }), 40, 20, [], PLAIN)
  assert.deepEqual(lines, ["name"])
})

test("regions are separated by a single blank row and no rule", () => {
  const { lines } = compose(
    frame({ top: [region("a", 2), region("b", 2)] }), 40, 20, [], PLAIN)
  assert.deepEqual(lines.map(strip), ["a-head", "a0", "a1", "", "b-head", "b0", "b1"])
})
