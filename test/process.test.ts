import { test } from "node:test"
import assert from "node:assert/strict"
import { foregroundIsAgent, parseForeground, processIsAgent } from "../src/process.js"

const grok = {
  argv: ["/opt/homebrew/bin/grok"],
  argv0: "grok",
  cmdline: "/opt/homebrew/bin/grok",
  name: "grok-1.0.13-mac",
}

const zsh = {
  argv: ["/bin/zsh", "-l"],
  argv0: "zsh",
  cmdline: "/bin/zsh -l",
  name: "zsh",
}

test("a live Grok TUI is recognised even when the binary is versioned", () => {
  assert.equal(processIsAgent("grok", grok), true)
  assert.equal(foregroundIsAgent("grok", [grok]), true)
})

test("a shell prompt after Grok exits is not an agent", () => {
  // OSC title often still ends in " - grok", so herdr keeps the pane in agents[].
  // The foreground process is the truth: zsh means the session is gone.
  assert.equal(processIsAgent("grok", zsh), false)
  assert.equal(foregroundIsAgent("grok", [zsh]), false)
})

test("Claude and Codex match their own binaries, not each other", () => {
  assert.equal(processIsAgent("claude", { argv0: "claude", name: "claude" }), true)
  assert.equal(processIsAgent("codex", { argv0: "codex", name: "codex" }), true)
  assert.equal(processIsAgent("claude", grok), false)
  assert.equal(processIsAgent("codex", grok), false)
})

test("an empty process list is treated as unknown, not gone", () => {
  // A failed process-info must not dismiss a live sidebar.
  assert.equal(foregroundIsAgent("grok", []), true)
})

test("herdr's process-info envelope is unwrapped", () => {
  const raw = JSON.stringify({
    result: { process_info: { foreground_processes: [grok], pane_id: "w1:pA" } },
  })
  assert.deepEqual(parseForeground(raw), [grok])
})

test("malformed process-info yields no processes (unknown, not gone)", () => {
  assert.deepEqual(parseForeground("not json"), [])
  assert.deepEqual(parseForeground("{}"), [])
})
