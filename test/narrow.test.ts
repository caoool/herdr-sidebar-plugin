import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_COLS,
  layoutFromResponse,
  openWidthFlags,
  shrinkAmount,
  targetCols,
} from "../src/narrow.js"

const layout = (area: number, paneId: string, width: number) => ({
  area: { width: area },
  panes: [{ pane_id: paneId, rect: { width } }],
})

test("a 100-column pane in a 235-column tab shrinks by the fraction that lands on 34", () => {
  // The amount is a fraction of the TAB, not of the pane — verified live: 0.25 moved a
  // divider 59 columns in a 235-column tab. Targeting 34 from 100 is 66/235.
  const amount = shrinkAmount(layout(235, "w1:p2", 100), "w1:p2", 34)
  assert.equal(amount, 66 / 235)
})

test("a pane already at the target does not shrink", () => {
  assert.equal(shrinkAmount(layout(235, "w1:p2", 34), "w1:p2", 34), null)
})

test("one extra column is left alone, matching the open-time tolerance", () => {
  // delta<=1 is treated as already there: a 35-column pane against a 34 target is not worth
  // a resize, and fighting a one-column rounding error would jitter the divider.
  assert.equal(shrinkAmount(layout(235, "w1:p2", 35), "w1:p2", 34), null)
})

test("two extra columns are enough to shrink", () => {
  assert.equal(shrinkAmount(layout(200, "w1:p2", 36), "w1:p2", 34), 2 / 200)
})

test("a missing pane or a zero-width tab yields nothing rather than NaN", () => {
  assert.equal(shrinkAmount(layout(235, "w1:p2", 100), "w1:p9", 34), null)
  assert.equal(shrinkAmount(layout(0, "w1:p2", 100), "w1:p2", 34), null)
})

test("a pane narrower than the target is not expanded", () => {
  // Max-width, not a fight with a user who dragged the divider in.
  assert.equal(shrinkAmount(layout(235, "w1:p2", 20), "w1:p2", 34), null)
})

test("herdr's 0.8.2 open help does not advertise a width flag", () => {
  const help = `Usage: herdr plugin pane open [OPTIONS]
Options:
      --plugin <ID>
      --entrypoint <ID>
      --placement <PLACEMENT>
      --workspace <ID>
      --target-pane <PANE>
      --direction <DIRECTION>
      --cwd <PATH>
      --env <KEY=VALUE>
      --focus
      --no-focus
`
  assert.deepEqual(openWidthFlags(help, 34), [])
})

test("an advertised --width is passed as a cell count", () => {
  const help = "      --width <SIZE>\n      --height <SIZE>\n"
  assert.deepEqual(openWidthFlags(help, 34), ["--width", "34"])
})

test("an advertised --max-width is passed as well, and is not mistaken for --width", () => {
  const help = "      --max-width <SIZE>\n"
  assert.deepEqual(openWidthFlags(help, 34), ["--max-width", "34"])
})

test("both flags are passed when both are advertised", () => {
  const help = "      --width <SIZE>\n      --max-width <SIZE>\n"
  assert.deepEqual(openWidthFlags(help, 40), ["--width", "40", "--max-width", "40"])
})

test("prose mentioning width is not treated as a flag", () => {
  const help = "Width defaults to half the terminal. No size option on splits.\n"
  assert.deepEqual(openWidthFlags(help, 34), [])
})

test("the default target is 34 columns", () => {
  assert.equal(DEFAULT_COLS, 34)
  assert.equal(targetCols({}), 34)
})

test("HERDR_SIDEBAR_COLS overrides the default when it is a positive number", () => {
  assert.equal(targetCols({ HERDR_SIDEBAR_COLS: "40" }), 40)
  assert.equal(targetCols({ HERDR_SIDEBAR_COLS: "0" }), 34)
  assert.equal(targetCols({ HERDR_SIDEBAR_COLS: "nope" }), 34)
})

test("herdr's pane layout envelope is unwrapped before measuring", () => {
  const raw = JSON.stringify({
    result: { layout: layout(235, "w1:p2", 100) },
  })
  const got = layoutFromResponse(raw)
  assert.equal(got && shrinkAmount(got, "w1:p2", 34), 66 / 235)
})

test("a malformed layout response yields nothing", () => {
  assert.equal(layoutFromResponse("not json"), null)
  assert.equal(layoutFromResponse("{}"), null)
})
