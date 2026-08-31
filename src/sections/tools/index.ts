import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { ProviderKind } from "../../types.js"
import type { McpServer, McpSnapshot, ToolCall } from "./types.js"
import { toolsBlock } from "./format.js"
import { countCalls, transcriptFor } from "./sources/calls.js"
import { parseClaudeMcp } from "./sources/claude.js"
import { parseCodexMcp } from "./sources/codex.js"
import { parseGrokMcp } from "./sources/grok.js"
import { claimLock, isFresh, mcpDir, readCached, writeCached } from "./cache.js"

/**
 * Run a command for its stdout, yielding null rather than throwing.
 *
 * Deliberately `spawn` + the `exit` event rather than `execFile`. execFile's callback fires when
 * the child's stdout reaches EOF, not when the child exits — and `claude mcp list` starts every
 * configured stdio MCP server as a grandchild, each inheriting that same pipe. The child exits,
 * the grandchildren keep the write end open, EOF never arrives, and the callback never runs. The
 * timeout does not save it either: it kills the child, which was already gone. Live panes sat
 * with a held lock and no reading for as long as they were open, while the identical command run
 * by hand returned in nine seconds.
 *
 * `exit` fires when the child itself exits, whatever its descendants are still holding. stdin is
 * detached because the pane keeps its TTY in raw mode for the scroll keys, and stderr is
 * discarded so a chatty server cannot fill a buffer nobody reads.
 */
// TEMPORARY DIAGNOSTIC
function dbg(o: unknown) {
  try {
    mkdirSync(mcpDir(), { recursive: true })
    appendFileSync(join(mcpDir(), "debug.log"), JSON.stringify({ t: new Date().toISOString(), ...(o as object) }) + "\n")
  } catch { /* diagnostic only */ }
}

const OUTPUT_CAP = 4 << 20
/** After the child exits, how long to keep draining stdout before giving up on the rest. */
const DRAIN_MS = 250

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      return resolve(null)
    }

    let out = ""
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(killer)
      resolve(value)
    }

    const killer = setTimeout(() => {
      dbg({ ev: "timeout", cmd })
      child.kill("SIGKILL")
      finish(null)
    }, timeout)

    child.stdout?.on("data", (d: Buffer) => {
      if (out.length < OUTPUT_CAP) out += String(d)
    })
    child.stdout?.on("error", () => {})
    // A command that cannot be spawned at all — not on PATH, not executable.
    child.on("error", (e) => { dbg({ ev: "spawn-error", cmd, msg: String(e).slice(0,150) }); finish(null) })
    child.on("exit", (code) => {
      dbg({ ev: "exit", cmd, code, outLen: out.length })
      // Give the pipe a moment to deliver anything already written, then take what we have. A
      // non-zero exit still yields its output on purpose: grok's `mcp doctor` logs to stdout and
      // exits non-zero, and its JSON is perfectly usable.
      const settle = () => finish(out || (code === 0 ? "" : null))
      const drain = setTimeout(settle, DRAIN_MS)
      child.stdout?.once("end", () => { clearTimeout(drain); settle() })
    })
  })
}

async function check(agent: ProviderKind): Promise<McpServer[] | null> {
  if (agent === "claude") {
    const out = await run("claude", ["mcp", "list"], 30_000)
    return out === null ? null : parseClaudeMcp(out)
  }
  if (agent === "codex") {
    const out = await run("codex", ["mcp", "list", "--json"], 10_000)
    return out === null ? null : parseCodexMcp(out)
  }
  const list = await run("grok", ["mcp", "list", "--json"], 10_000)
  if (list === null) return null
  const configured = parseGrokMcp(list, null)
  // The doctor is slow and needs auth; there is nothing for it to check when nothing is set up.
  if (!configured.length) return []
  const doctor = await run("grok", ["mcp", "doctor", "--json"], 20_000)
  return parseGrokMcp(list, doctor)
}

/**
 * The tools this session has called, and the MCP servers this agent has configured.
 *
 * Unlike quota, both belong to one session and one provider, so only the pane's own agent is
 * shown. The section is scrollable because the lists are unbounded — thirteen servers and two
 * dozen tools is ordinary — while quota and context above it must stay in view.
 */
export function toolsSection(): Section {
  let calls: ToolCall[] = []
  let mcp: McpSnapshot | null = null
  let subject: SectionContext["subject"] = null
  let checking = false

  return {
    id: "tools",
    scrollable: true,

    watch: () => [
      mcpDir(),
      join(homedir(), ".claude.json"),
      join(homedir(), ".codex", "config.toml"),
      join(homedir(), ".grok", "config.toml"),
    ],

    async refresh(ctx) {
      subject = ctx.subject
      if (!subject) {
        calls = []
        mcp = null
        return
      }
      const agent = subject.agent
      const now = Date.now()

      const transcript = subject.sessionId
        ? await transcriptFor(agent, subject.sessionId).catch(() => null)
        : null
      calls = transcript ? await countCalls(agent, transcript).catch(() => []) : []

      const cached = await readCached(agent)
      mcp = isFresh(cached, now, agent) ? cached : null
      if (mcp && mcp.agent !== agent) mcp = null

      // Refresh in the background: a nine-second health check must never block a render.
      const claimed = !mcp && !checking ? await claimLock(agent, now) : false
      dbg({ ev: "refresh", agent, hasMcp: !!mcp, checking, claimed })
      if (claimed) {
        checking = true
        void check(agent)
          .then(async (servers) => {
            dbg({ ev: "check-done", agent, servers: servers ? servers.length : null })
            if (servers) await writeCached({ agent, servers, observedAt: Date.now() })
            dbg({ ev: "wrote", agent })
          })
          .catch((e) => dbg({ ev: "check-threw", agent, msg: String(e).slice(0,200) }))
          .finally(() => { checking = false })
      }
    },

    render(width, style) {
      if (!subject) return []
      return toolsBlock(calls, mcp, subject.agent, width, style)
    },
  }
}
