#!/usr/bin/env node
/**
 * Installs the silent statusLine collector into the user's settings.json.
 *
 * Deliberately an explicit action, not something the sidebar does on first render: writing
 * to a user's settings is invasive, and on macOS an unexpected mutation while they are
 * mid-task is worse than an extra keystroke.
 *
 * The statusLine slot holds exactly one command. If one is already configured we do not
 * clobber it — we record it and the collector execs it after capturing the payload.
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const settingsPath = join(homedir(), ".claude", "settings.json")
const root = process.env.HERDR_PLUGIN_ROOT ?? process.cwd()
const state = process.env.HERDR_PLUGIN_STATE_DIR
if (!state) { console.error("HERDR_PLUGIN_STATE_DIR is unset; run this through herdr"); process.exit(1) }

const collector = join(root, "bin", "statusline-collector.sh")

let settings = {}
try { settings = JSON.parse(await readFile(settingsPath, "utf8")) } catch { /* first run */ }

const existing = settings.statusLine
if (existing?.command?.includes("statusline-collector.sh")) {
  console.log("collector already installed")
  process.exit(0)
}

await copyFile(settingsPath, `${settingsPath}.bak`).catch(() => {})
await mkdir(join(state, "claude"), { recursive: true })

const chain = existing?.type === "command" && existing.command ? existing.command : ""
if (chain) console.log(`chaining existing statusLine: ${chain}`)

settings.statusLine = {
  type: "command",
  command:
    `QUOTA_SIDEBAR_STATE_DIR=${JSON.stringify(state)} ` +
    (chain ? `QUOTA_SIDEBAR_CHAIN=${JSON.stringify(chain)} ` : "") +
    `bash ${JSON.stringify(collector)}`,
  // Claude Code re-invokes on this interval even while idle, which is what keeps quota
  // fresh without anyone polling an API.
  refreshInterval: 10,
}

await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n")
console.log(`installed. backup at ${settingsPath}.bak`)
console.log("quota appears once each Claude session makes its first API response.")
