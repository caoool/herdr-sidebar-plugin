#!/usr/bin/env node
/**
 * Startup hook. herdr runs this once after restoring a session and again after a live
 * handoff — never on client attach. Plugin panes are not restored automatically, so we
 * drop the stale pane-id locks; the next pane.agent_detected re-opens the sidebars.
 */
import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"

const state = process.env.HERDR_PLUGIN_STATE_DIR
if (!state) process.exit(0)
const dir = join(state, "panes")
for (const f of await readdir(dir).catch(() => [])) {
  await unlink(join(dir, f)).catch(() => {})
}
