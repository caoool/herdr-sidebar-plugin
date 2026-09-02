import { test } from "node:test"
import assert from "node:assert/strict"
import { runningIn as grokRunning } from "../src/sections/shells/sources/grok.js"
import { runningIn as codexRunning, commandIn as codexCommand } from "../src/sections/shells/sources/codex.js"
import { runningShells, commandIn as claudeCommand } from "../src/sections/shells/sources/claude.js"
import { shellItems, shellsTally } from "../src/sections/shells/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"
import { displayWidth } from "../src/width.js"
import type { Shell } from "../src/sections/shells/types.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")

// --- Grok ------------------------------------------------------------------------------------
// Records captured verbatim from a live session that backgrounded `sleep 300`, monitored it,
// and backgrounded `sleep 8`.

const bg = (taskId: string, command: string, monitor = false) =>
  JSON.stringify({ method: "_x.ai/session/update", params: { update: {
    sessionUpdate: "task_backgrounded", task_id: taskId, tool_call_id: `call-${taskId}`,
    command, cwd: "/private/tmp/bgtest", output_file: `/x/${taskId}.log`,
    ...(monitor ? { monitor_description: "Watch it" } : {}),
  } } })

const completed = (taskId: string) =>
  JSON.stringify({ method: "_x.ai/session/update", params: { update: {
    sessionUpdate: "task_completed",
    task_snapshot: { task_id: taskId, command: "x", exit_code: 0 },
  } } })

test("Grok: a backgrounded task with no completion is running", () => {
  assert.deepEqual(grokRunning([bg("t1", "sleep 300")]),
    [{ id: "t1", kind: "shell", command: "sleep 300" }])
})

test("Grok: a completed task is gone, matched through task_snapshot.task_id", () => {
  // The completion nests its id one level down. Reading the top level finds no completions at
  // all and reports every finished task as running — the exact lie this section must not tell.
  assert.deepEqual(grokRunning([bg("t1", "sleep 8"), completed("t1")]), [])
})

test("Grok: a monitor is distinguished by carrying its own description", () => {
  const out = grokRunning([bg("t1", "sleep 300"), bg("t2", 'tail -f /x.log', true)])
  assert.deepEqual(out.map((s) => s.kind), ["shell", "monitor"])
})

test("Grok: the live three-task case resolves exactly as the process table did", () => {
  const out = grokRunning([
    bg("a", "sleep 300"), bg("b", "tail -f /x.log", true), bg("c", "sleep 8"), completed("c"),
  ])
  assert.deepEqual(out.map((s) => s.command), ["sleep 300", "tail -f /x.log"])
})

// --- Codex -----------------------------------------------------------------------------------

const call = (id: string, cmd: string, status = "completed") =>
  JSON.stringify({ payload: {
    type: "custom_tool_call", name: "exec", call_id: id, status,
    input: `const r = await tools.exec_command({cmd:"${cmd}","workdir":"/private/tmp/bgtest","yield_time_ms":30000});`,
  } })

const output = (id: string) =>
  JSON.stringify({ payload: { type: "custom_tool_call_output", call_id: id, output: "done" } })

test("Codex: a call with no output is still running", () => {
  const out = codexRunning([call("c1", "sleep 45")])
  assert.deepEqual(out, [{ id: "c1", kind: "shell", command: "sleep 45" }])
})

test("Codex: status is ignored, because it says completed while the command is still running", () => {
  // Observed live: the running `sleep 45` call carried status "completed". Trusting it would
  // mark every live command as finished.
  assert.equal(codexRunning([call("c1", "sleep 45", "completed")]).length, 1)
})

test("Codex: an output closes its call", () => {
  assert.deepEqual(codexRunning([call("c1", "sleep 45"), output("c1")]), [])
})

test("Codex: the command is recovered from the code-mode wrapper", () => {
  assert.equal(codexCommand({ input: 'const r = await tools.exec_command({cmd:"sleep 45","workdir":"/x"});' }), "sleep 45")
})

test("Codex: JSON arguments are read too, and an unreadable call yields no command", () => {
  assert.equal(codexCommand({ arguments: '{"cmd":"ls -la"}' }), "ls -la")
  assert.equal(codexCommand({ arguments: '{"command":["git","status"]}' }), "git status")
  assert.equal(codexCommand({ input: "something unparseable" }), "")
})

// --- Claude ----------------------------------------------------------------------------------
// ps output in the exact shape `ps -Ao pid,ppid,args` produces.

const PS = [
  "  100     1 /usr/bin/somethingelse",
  "  200   100 claude",
  "  300   200 /bin/zsh -c source /Users/lu/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'npm test' < /dev/null && pwd -P",
  "  301   300 node /x/test.js",
  "  400   200 caffeinate -dims",
  "  500   200 npx some-mcp-server",
  "  600   999 /bin/zsh -c source /Users/lu/.claude/shell-snapshots/snapshot-zsh-2.sh && eval 'not ours' < /dev/null && pwd -P",
].join("\n")

test("Claude: only this session's shells are listed", () => {
  const out = runningShells(PS, 200)
  assert.deepEqual(out.map((s) => s.command), ["npm test"])
})

test("Claude: caffeinate and MCP servers are not shells the user ran", () => {
  // The session process parents them too; without the snapshot filter they would all be listed.
  const out = runningShells(PS, 200)
  assert.ok(!out.some((s) => s.command.includes("caffeinate")))
  assert.ok(!out.some((s) => s.command.includes("mcp-server")))
})

test("Claude: a shell under another session is not ours", () => {
  assert.equal(runningShells(PS, 200).find((s) => s.command === "not ours"), undefined)
})

test("Claude: the command is unwrapped from the snapshot boilerplate", () => {
  const args = "/bin/zsh -c source /Users/lu/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'git status\\012git log' < /dev/null && pwd -P"
  assert.equal(claudeCommand(args), "git status git log")
})

test("Claude: an unrecognisable wrapper yields no command rather than boilerplate", () => {
  assert.equal(claudeCommand("/bin/zsh -c something else entirely"), "")
})

test("Claude: nothing running is an empty list", () => {
  assert.deepEqual(runningShells("  100     1 init", 200), [])
})

// --- Rendering -------------------------------------------------------------------------------

const running: Shell[] = [
  { id: "1", kind: "shell", command: "npm test -- --watch" },
  { id: "2", kind: "monitor", command: "tail -f /var/log/x.log" },
]

test("nothing running renders no rows at all, not a dash", () => {
  // An empty list here is the ordinary state. A dash would suggest a reading failed.
  assert.deepEqual(shellItems(null, 30, PLAIN), [])
  assert.deepEqual(shellItems([], 30, PLAIN), [])
})

test("the shells tally is a dim title sitting on the list, like tools", () => {
  const line = shellsTally(running, 30, TERMINAL)
  assert.equal(strip(line).startsWith("shells"), true, strip(line))
  assert.ok(strip(line).endsWith("2"), strip(line))
  assert.match(line, /^\x1b\[2mshells\x1b\[0m/, "the name is dimmed")
  assert.match(line, /\x1b\[2m2\x1b\[0m$/, "so is the figure")
})

test("styling the shells tally never changes its width", () => {
  assert.equal(strip(shellsTally(running, 30, TERMINAL)), shellsTally(running, 30, PLAIN))
})

test("shells and monitors get different glyphs, and the monitor is the lit one", () => {
  const plain = shellItems(running, 30, PLAIN).map(strip)
  assert.ok(plain[0].startsWith("$ npm test"))
  assert.ok(plain[1].startsWith("⟳ tail -f"))
  const styled = shellItems(running, 30, TERMINAL)
  assert.match(styled[1], /\x1b\[38;5;41m⟳/)
  assert.ok(!/\x1b\[38;5;41m\$/.test(styled[0]))
})

test("a command that could not be recovered shows a dash, never a guess", () => {
  const [row] = shellItems([{ id: "1", kind: "shell", command: "" }], 30, TERMINAL)
  assert.ok(strip(row).startsWith("$ —"))
  assert.match(row, /\x1b\[2m—/)
})

test("every row fits its column budget, including a very long command", () => {
  const long = [{ id: "1", kind: "shell" as const, command: "x".repeat(400) }]
  for (const width of [20, 30, 34]) {
    for (const line of shellItems(long, width, PLAIN)) {
      if (!line) continue
      assert.ok(displayWidth(strip(line)) <= width, `width ${width}: ${JSON.stringify(line)}`)
    }
  }
})

test("styling never changes a row's width", () => {
  const snap = { agent: "grok" as const, running, observedAt: 0 }
  assert.deepEqual(shellItems(snap.running, 30, TERMINAL).map(strip), shellItems(snap.running, 30, PLAIN))
})
