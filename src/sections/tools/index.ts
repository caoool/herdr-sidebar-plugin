import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Section, SectionContext } from "../types.js"
import type { ProviderKind } from "../../types.js"
import type { McpServer, McpSnapshot, ToolCall } from "./types.js"
import { mcpHead, mcpItems, mcpRows, toolItems, toolsHead, toolsRows } from "./format.js"
import { countCalls, transcriptFor } from "./sources/calls.js"
import { parseClaudeMcp } from "./sources/claude.js"
import { parseCodexMcp } from "./sources/codex.js"
import { parseGrokMcp } from "./sources/grok.js"
import { claimLock, isFresh, mcpDir, readCached, writeCached } from "./cache.js"
import { SAFE_CWD } from "../../run.js"

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
 *
 * The working directory is set explicitly, and that is not incidental. herdr launches a pane in
 * the plugin checkout it was installed from, and every later reinstall deletes that directory —
 * so a long-lived sidebar ends up running with a working directory that no longer exists. Both
 * `claude` and `grok` refuse to start at all in that state ("The current working directory was
 * deleted"), exiting non-zero within milliseconds, which made every check fail on exactly the
 * panes that had been open longest while the same command by hand always worked. The home
 * directory always exists, and these lists are user-scoped anyway.
 */
const OUTPUT_CAP = 4 << 20
/** After the child exits, how long to keep draining stdout before giving up on the rest. */
const DRAIN_MS = 250

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { cwd: SAFE_CWD, stdio: ["ignore", "pipe", "ignore"] })
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
      child.kill("SIGKILL")
      finish(null)
    }, timeout)

    child.stdout?.on("data", (d: Buffer) => {
      if (out.length < OUTPUT_CAP) out += String(d)
    })
    child.stdout?.on("error", () => {})
    // A command that cannot be spawned at all — not on PATH, not executable.
    child.on("error", () => finish(null))
    child.on("exit", (code) => {
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
/** Items shown per region before the rest becomes scrollable. */
const VISIBLE = 5

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
      // Refresh in the background: a nine-second health check must never block a render.
      if (!mcp && !checking && (await claimLock(agent, now))) {
        checking = true
        void check(agent)
          .then(async (servers) => {
            if (servers) await writeCached({ agent, servers, observedAt: Date.now() })
          })
          .catch(() => {})
          .finally(() => { checking = false })
      }
    },

    render(width, style) {
      if (!subject) return []
      return [...toolsRows(calls, width, style), "", ...mcpRows(mcp, width, style)]
    },

    regions(width, style) {
      if (!subject) return []
      // Five items each, the rest reachable by scrolling. The heading rides in `head` so it
      // stays put while its list moves; MCP's leading blank separates the two blocks and belongs
      // to the region rather than sitting between them.
      return [
        { head: toolsHead(calls, width, style), body: toolItems(calls, width, style), maxBody: VISIBLE },
        { head: ["", ...mcpHead(mcp, width, style)], body: mcpItems(mcp, width, style), maxBody: VISIBLE },
      ]
    },
  }
}
