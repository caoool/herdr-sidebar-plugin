import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isFresh, TTL, claimLock, readCached, writeCached } from "../src/sections/tools/cache.js"
import type { McpSnapshot } from "../src/sections/tools/types.js"

const snap = (at: number): McpSnapshot => ({ agent: "claude", servers: [], observedAt: at })
const NOW = 1_800_000_000_000

/**
 * Run `fn` with HERDR_PLUGIN_STATE_DIR pointed at a fresh OS temp dir, then clean up.
 *
 * Never the user's real state directory, and never a path hardcoded to one machine — this
 * repo is public and runs on more than one machine, and in CI.
 */
async function withTempState(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-sidebar-"))
  const prev = process.env.HERDR_PLUGIN_STATE_DIR
  process.env.HERDR_PLUGIN_STATE_DIR = dir
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR
    else process.env.HERDR_PLUGIN_STATE_DIR = prev
    await rm(dir, { recursive: true, force: true })
  }
}

test("Claude's reading is trusted for fifteen minutes", () => {
  assert.equal(TTL.claude, 15 * 60_000)
  assert.ok(isFresh(snap(NOW - 14 * 60_000), NOW, "claude"))
  assert.ok(!isFresh(snap(NOW - 16 * 60_000), NOW, "claude"))
})

test("the cheap agents are re-read every minute", () => {
  assert.equal(TTL.codex, 60_000)
  assert.equal(TTL.grok, 60_000)
  assert.ok(!isFresh(snap(NOW - 61_000), NOW, "codex"))
})

test("an expired reading is not fresh — it must render as a dash, never as current", () => {
  // The whole point of the section is that a wrong status is worse than no status.
  assert.ok(!isFresh(snap(NOW - 60 * 60_000), NOW, "claude"))
})

test("a missing reading is not fresh", () => {
  assert.ok(!isFresh(null, NOW, "claude"))
})

test("a reading from the future is not trusted", () => {
  // Clock changes happen; a timestamp ahead of now means the arithmetic cannot be relied on.
  assert.ok(!isFresh(snap(NOW + 60_000), NOW, "claude"))
})

test("writeCached and readCached round-trip a snapshot", async () => {
  await withTempState(async () => {
    const written: McpSnapshot = {
      agent: "codex",
      servers: [{ name: "files", status: "enabled" }],
      observedAt: NOW,
    }
    await writeCached(written)
    const read = await readCached("codex")
    assert.deepEqual(read, written)
  })
})

test("readCached yields null when nothing has been written for that agent", async () => {
  await withTempState(async () => {
    assert.equal(await readCached("grok"), null)
  })
})

// claimLock's own freshness check compares the passed `now` against the lock file's real
// mtime (set by the OS when the file is written), so these tests use the real clock rather
// than the arbitrary fixture NOW used above for isFresh.

test("claimLock is exclusive: two concurrent claims cannot both succeed", async () => {
  await withTempState(async () => {
    const now = Date.now()
    const [a, b] = await Promise.all([
      claimLock("claude", now),
      claimLock("claude", now),
    ])
    // Exactly one of the two racing claims wins.
    assert.equal([a, b].filter(Boolean).length, 1)
  })
})

test("claimLock refuses a second claim while the first is still fresh", async () => {
  await withTempState(async () => {
    const now = Date.now()
    assert.equal(await claimLock("claude", now), true)
    assert.equal(await claimLock("claude", now), false)
  })
})

test("a stale lock is reclaimable", async () => {
  await withTempState(async () => {
    const now = Date.now()
    assert.equal(await claimLock("claude", now), true)
    // Well past LOCK_STALE (60s): the pane that held it is assumed dead.
    assert.equal(await claimLock("claude", now + 5 * 60_000), true)
  })
})
