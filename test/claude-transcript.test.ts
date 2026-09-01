import { test } from "node:test"
import assert from "node:assert/strict"
import { displayName, latestIn, windowFor } from "../src/sections/session/sources/claude-transcript.js"

const turn = (model: string, effort: string, usage: Record<string, number>) =>
  JSON.stringify({
    cwd: "/Users/lu/project", effort,
    message: { model, usage },
  })

test("the newest turn's model and effort win", () => {
  const out = latestIn([
    turn("claude-opus-5", "high", { input_tokens: 1 }),
    turn("claude-sonnet-5", "xhigh", { input_tokens: 2 }),
  ])
  assert.equal(out.model, "claude-sonnet-5")
  assert.equal(out.effort, "xhigh")
})

test("context used counts the input side only", () => {
  // Output tokens are what the model produced, not what the window is holding. Counting them
  // would overstate usage on a long reply.
  const out = latestIn([turn("claude-opus-5", "high", {
    input_tokens: 2, cache_creation_input_tokens: 3217, cache_read_input_tokens: 616583,
    output_tokens: 1443,
  })])
  assert.equal(out.usedTokens, 2 + 3217 + 616583)
})

test("a turn with no usage leaves the token count unknown", () => {
  const out = latestIn([turn("claude-opus-5", "high", {})])
  assert.equal(out.usedTokens, null)
})

test("lines that are not model turns are ignored", () => {
  const out = latestIn(['{"type":"user","message":{"content":"hello"}}', "not json"])
  assert.equal(out.model, null)
})

test("model ids become the display names the payload used to give", () => {
  assert.equal(displayName("claude-opus-5"), "Opus 5")
  assert.equal(displayName("claude-sonnet-4.5"), "Sonnet 4.5")
  assert.equal(displayName(null), null)
})

test("an unfamiliar model id is passed through rather than mangled", () => {
  // Inventing a tidy name for something unrecognised would make a guess look official.
  assert.equal(displayName("some-future-model"), "some-future-model")
})

test("the long-context variant changes the denominator", () => {
  assert.equal(windowFor("claude-opus-5", false), 200_000)
  assert.equal(windowFor("claude-opus-5", true), 1_000_000)
})

test("an unrecognised model yields no window, so no percentage is computed", () => {
  // A wrong denominator would put every percentage out; a dash is the honest rendering.
  assert.equal(windowFor("some-future-model", false), null)
  assert.equal(windowFor(null, false), null)
})
