import { test } from "node:test"
import assert from "node:assert/strict"
import { parseClaudeMcp, shortenServer } from "../src/sections/tools/sources/claude.js"
import { parseCodexMcp } from "../src/sections/tools/sources/codex.js"
import { parseGrokMcp } from "../src/sections/tools/sources/grok.js"

// Captured verbatim from `claude mcp list` on 2026-08-31.
const CLAUDE = `Checking MCP server health…

claude.ai Context7: https://mcp.context7.com/mcp - ✔ Connected
plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✔ Connected
plugin:huggingface-skills:huggingface-skills: https://huggingface.co/mcp?login (HTTP) - ! Needs authentication
plugin:playwright:playwright: npx @playwright/mcp@latest - ✗ Failed to connect
plugin:local:pending: ./x - ⏸ Pending approval
`

test("every status Claude can report is recognised", () => {
  const servers = parseClaudeMcp(CLAUDE)
  assert.deepEqual(servers.map((s) => s.status), [
    "connected", "connected", "needs-auth", "failed", "pending",
  ])
})

test("a server name containing colons survives the split", () => {
  // "plugin:github:github: https://…" — splitting on the first colon would truncate the name.
  const servers = parseClaudeMcp(CLAUDE)
  assert.equal(servers[1].name, "github")
})

test("names shorten for a 30-column sidebar", () => {
  assert.equal(shortenServer("plugin:cloudflare:cloudflare-docs"), "cloudflare-docs")
  assert.equal(shortenServer("claude.ai Context7"), "Context7")
  assert.equal(shortenServer("mongodb"), "mongodb")
})

test("the health-check preamble and blank lines are not servers", () => {
  assert.equal(parseClaudeMcp(CLAUDE).length, 5)
})

test("unparseable output yields no servers rather than a guess", () => {
  assert.deepEqual(parseClaudeMcp("some unrelated error text"), [])
})

// Captured verbatim from `codex mcp list --json` on 2026-08-31.
const CODEX = JSON.stringify([
  { name: "codex_app", enabled: false, auth_status: "unsupported" },
  { name: "node_repl", enabled: true, auth_status: "unsupported" },
])

test("Codex reports configuration only — never connectivity", () => {
  const servers = parseCodexMcp(CODEX)
  assert.deepEqual(servers, [
    { name: "codex_app", status: "disabled" },
    { name: "node_repl", status: "enabled" },
  ])
  for (const s of servers) {
    assert.ok(s.status !== "connected", "Codex must never claim a live connection")
    assert.ok(s.status !== "failed", "Codex cannot know a connection failed")
  }
})

test("Codex with nothing configured yields an empty list, not an error", () => {
  assert.deepEqual(parseCodexMcp("[]"), [])
})

test("Grok with no servers configured yields nothing", () => {
  assert.deepEqual(parseGrokMcp("[]", null), [])
})

test("Grok falls back to configuration when the doctor could not run", () => {
  // `grok mcp doctor` needs auth and can fail outright; config state is still true.
  const list = JSON.stringify([{ name: "files", enabled: true }])
  assert.deepEqual(parseGrokMcp(list, null), [{ name: "files", status: "enabled" }])
})

test("Grok uses connectivity when the doctor did run", () => {
  const list = JSON.stringify([{ name: "files", enabled: true }])
  const doctor = JSON.stringify([{ name: "files", ok: true }])
  assert.deepEqual(parseGrokMcp(list, doctor), [{ name: "files", status: "connected" }])
})

test("Grok's doctor output survives the log noise it prints first", () => {
  // It emits ANSI-coloured ERROR lines before any JSON.
  const list = JSON.stringify([{ name: "files", enabled: true }])
  const noisy = `\x1b[2m2026-08-31T11:06:31Z\x1b[0m \x1b[31mERROR\x1b[0m worker quit\n[{"name":"files","ok":false}]`
  assert.deepEqual(parseGrokMcp(list, noisy), [{ name: "files", status: "failed" }])
})
