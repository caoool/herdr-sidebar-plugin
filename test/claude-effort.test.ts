import { test } from "node:test"
import assert from "node:assert/strict"
import { newestIn, resolvePreset } from "../src/sections/session/sources/claude-effort.js"

const stdout = (text: string) =>
  JSON.stringify({ type: "user", message: { content: `<local-command-stdout>${text}</local-command-stdout>` } })

test("finds the effort line /effort writes into the transcript", () => {
  const line = stdout("Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration")
  assert.equal(newestIn([line]), "ultracode")
})

test("a later setting supersedes an earlier one", () => {
  const lines = [stdout("Set effort level to ultracode (this session only): xhigh"), stdout("Set effort level to high")]
  assert.equal(newestIn(lines), "high")
})

test("unrelated lines mentioning the word are ignored", () => {
  // This very conversation is full of the word "ultracode"; only the command's own line counts.
  const prose = JSON.stringify({ type: "user", message: { content: "my current effort is ultracode, can you show it" } })
  assert.equal(newestIn([prose]), null)
})

test("no effort line yields nothing", () => {
  assert.equal(newestIn([JSON.stringify({ type: "assistant" })]), null)
})

test("ultracode is shown while its underlying level still matches", () => {
  assert.equal(resolvePreset("ultracode", "xhigh"), "ultracode")
})

test("a preset whose level has diverged is stale and discarded", () => {
  // Effort changed by a route that left no transcript line; the level is authoritative.
  assert.equal(resolvePreset("ultracode", "high"), null)
})

test("a preset that merely names its own level adds nothing", () => {
  assert.equal(resolvePreset("high", "high"), null)
  assert.equal(resolvePreset("xhigh", "xhigh"), null)
})

test("nothing found means nothing shown", () => {
  assert.equal(resolvePreset(null, "xhigh"), null)
})
