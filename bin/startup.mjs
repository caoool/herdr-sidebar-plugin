#!/usr/bin/env node
/**
 * Startup hook. herdr runs this once after restoring a session, and again after a live
 * handoff — never on client attach.
 *
 * Two jobs, both idempotent, because the plugin must be usable the moment it is installed:
 *
 *  1. Drop stale pane-id locks. Plugin panes are not restored automatically, so the ids
 *     recorded before the restart no longer exist; the next pane.agent_detected re-opens.
 *  2. Ensure the Claude statusLine collector is installed. It is the only channel that
 *     reports Claude quota — no hook payload carries rate_limits, and the cached copy in
 *     ~/.claude.json does not refresh with ordinary session activity.
 */
import { readdir, unlink, stat } from "node:fs/promises"
import { join } from "node:path"
import { ensureCollector } from "./install-collector.mjs"

const state = process.env.HERDR_PLUGIN_STATE_DIR
if (!state) process.exit(0)

for (const f of await readdir(join(state, "panes")).catch(() => [])) {
  await unlink(join(state, "panes", f)).catch(() => {})
}

// The collector writes one file per Claude session and nothing ever removes them. Reconciling
// by reset time already ignores stale ones, so this is only about keeping the directory
// bounded; a week is far longer than the longest window we read.
const WEEK = 7 * 24 * 60 * 60 * 1000
const claude = join(state, "claude")
for (const f of await readdir(claude).catch(() => [])) {
  const p = join(claude, f)
  const info = await stat(p).catch(() => null)
  if (info && Date.now() - info.mtimeMs > WEEK) await unlink(p).catch(() => {})
}

// Never let a settings problem stop the sidebar from coming up.
await ensureCollector().catch((err) => {
  console.error(`collector not installed: ${err?.message ?? err}`)
})
