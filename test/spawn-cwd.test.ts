import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { SAFE_CWD } from "../src/run.js"

/** Every source file, so a new spawn site cannot be added without this test seeing it. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (name.endsWith(".ts")) out.push(path)
  }
  return out
}

test("SAFE_CWD is a directory that exists", () => {
  assert.ok(statSync(SAFE_CWD).isDirectory())
})

test("every child process is spawned with an explicit cwd", () => {
  // herdr launches a pane inside the checkout it was installed from, and a later reinstall
  // deletes that directory. A spawn from a deleted cwd fails outright — it silently broke the
  // MCP check, the pane's auto-close and its label claim, each only on panes open long enough to
  // outlive an upgrade. A spawn without a cwd is therefore a defect, not a style preference.
  const offenders: string[] = []
  for (const file of sources("src")) {
    const text = readFileSync(file, "utf8")
    const lines = text.split("\n")
    lines.forEach((line, i) => {
      if (!/\b(execFile|spawn)\(/.test(line)) return
      if (/^\s*(import|const run = promisify|\*)/.test(line)) return
      // The options object may continue onto following lines.
      const window = lines.slice(i, i + 6).join("\n")
      if (!window.includes("cwd:")) offenders.push(`${file}:${i + 1} ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [], `spawn without cwd:\n${offenders.join("\n")}`)
})
