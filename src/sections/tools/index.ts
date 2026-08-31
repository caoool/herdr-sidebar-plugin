import { execFile } from "node:child_process"
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

/** Run a command for its stdout, yielding null rather than throwing. */
function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => {
      // A non-zero exit still often carries usable output — grok's doctor logs to the same
      // stream — so stdout is preferred over the error when there is any.
      resolve(stdout ? String(stdout) : err ? null : "")
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
      return toolsBlock(calls, mcp, subject.agent, width, style)
    },
  }
}
