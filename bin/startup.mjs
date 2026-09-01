#!/usr/bin/env node
/**
 * Startup hook. herdr runs this once after restoring a session, and again after a live
 * handoff — never on client attach.
 *
 * Housekeeping only. It drops stale pane-id locks: plugin panes are not restored automatically,
 * so the ids recorded before the restart no longer exist, and the next pane.agent_detected
 * re-opens. It also trims the collector's leftovers.
 *
 * It deliberately does NOT install the Claude statusLine collector any more. That used to happen
 * here, because the collector was the only channel reporting Claude quota — but quota now comes
 * from the account's usage endpoint and the session block from the transcript, so the collector
 * buys nothing that is not already available.
 *
 * Reinstalling it was actively wrong: a status line is not free. Claude draws it on its own row
 * and puts the `/rc` badge there, so configuring one changes the shape of the footer. A user who
 * removes their status line has made a choice, and every `herdr plugin install` was silently
 * undoing it. The `connect-claude` action still installs the collector for anyone who wants it.
 */
import { readdir, unlink, stat } from "node:fs/promises"
import { join } from "node:path"

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
