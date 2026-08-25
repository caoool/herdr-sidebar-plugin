#!/usr/bin/env node
/**
 * Installs the silent Claude statusLine collector.
 *
 * Claude Code renders whatever the statusLine command prints, so a command that prints
 * nothing is invisible while still receiving the full session payload — including
 * rate_limits — about every ten seconds, even while idle. That is the only channel: no hook
 * payload carries rate_limits, and ~/.claude.json's cached copy does not refresh with
 * ordinary session activity.
 *
 * Runs automatically from the startup hook so the sidebar works as soon as it is installed,
 * and is also exposed as an action for repair. Both paths are idempotent.
 *
 * The statusLine slot holds exactly one command, so an existing one is never clobbered: it
 * is recorded and the collector execs it after capturing the payload.
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const SETTINGS = join(homedir(), ".claude", "settings.json")

export async function ensureCollector() {
  const state = process.env.HERDR_PLUGIN_STATE_DIR
  if (!state) throw new Error("HERDR_PLUGIN_STATE_DIR is unset; run this through herdr")

  const root = process.env.HERDR_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)))
  const collector = join(root, "bin", "statusline-collector.sh")

  let settings = {}
  try { settings = JSON.parse(await readFile(SETTINGS, "utf8")) } catch { /* first run */ }

  const existing = settings.statusLine
  if (typeof existing?.command === "string" && existing.command.includes("statusline-collector.sh")) {
    // Already ours. Rewrite anyway so a reinstall at a new managed path keeps working.
    if (existing.command.includes(root)) return "unchanged"
  }

  await mkdir(join(state, "claude"), { recursive: true })
  await copyFile(SETTINGS, `${SETTINGS}.bak`).catch(() => {})

  // Only chain a command that is not already a collector, or we would nest ourselves.
  const prior = typeof existing?.command === "string" ? existing.command : ""
  const chain = prior && !prior.includes("statusline-collector.sh") ? prior : ""

  settings.statusLine = {
    type: "command",
    command:
      `SIDEBAR_STATE_DIR=${JSON.stringify(state)} ` +
      (chain ? `SIDEBAR_CHAIN=${JSON.stringify(chain)} ` : "") +
      `bash ${JSON.stringify(collector)}`,
    // Claude Code re-invokes on this interval even while idle, which is what keeps the
    // figure fresh without anyone polling an API.
    refreshInterval: 10,
  }

  await writeFile(SETTINGS, JSON.stringify(settings, null, 2) + "\n")
  return chain ? `installed, chaining ${chain}` : "installed"
}

// Direct invocation via the repair action.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await ensureCollector())
}
