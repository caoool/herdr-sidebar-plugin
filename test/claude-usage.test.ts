import { test } from "node:test"
import assert from "node:assert/strict"
import { servicesIn, tokenIn, toWindows } from "../src/sections/quota/sources/claude-usage.js"

// The keychain dump's shape, as `security dump-keychain` prints it.
const DUMP = `
    "svce"<blob>="Claude Safe Storage"
    "svce"<blob>="Claude Code-credentials"
    "svce"<blob>="Claude Code-credentials-323552e8"
    "svce"<blob>="com.apple.something"
`

test("every Claude credential entry is found, suffixed ones first", () => {
  // The bare entry is not enough: on the machine this was written against it held only MCP
  // tokens, and the account credential lived under the suffixed name. The suffix cannot be
  // derived from the config, so the keychain is enumerated instead of guessed at.
  const found = servicesIn(DUMP)
  assert.deepEqual(found, ["Claude Code-credentials-323552e8", "Claude Code-credentials"])
})

test("unrelated keychain entries are ignored", () => {
  assert.ok(!servicesIn(DUMP).includes("Claude Safe Storage"))
  assert.ok(!servicesIn(DUMP).includes("com.apple.something"))
})

test("a dump with no Claude entries yields nothing", () => {
  assert.deepEqual(servicesIn('"svce"<blob>="com.apple.something"'), [])
})

test("the token is read from either credential shape", () => {
  assert.equal(tokenIn(JSON.stringify({ claudeAiOauth: { accessToken: "tok" } })), "tok")
  assert.equal(tokenIn(JSON.stringify({ accessToken: "tok" })), "tok")
})

test("a credential holding no access token yields null, never a partial value", () => {
  // The entry named `Claude Code-credentials` on this machine holds only MCP tokens; reading it
  // must produce nothing rather than something token-shaped.
  assert.equal(tokenIn(JSON.stringify({ mcpOAuth: { some: "thing" } })), null)
  assert.equal(tokenIn("not json"), null)
  assert.equal(tokenIn(JSON.stringify({ claudeAiOauth: {} })), null)
})

// The endpoint's response, per the schema ccstatusline validates against.
const BODY = {
  five_hour: { utilization: 7, resets_at: "2026-09-01T18:00:00.000Z" },
  seven_day: { utilization: 21.5, resets_at: "2026-09-07T00:00:00.000Z" },
  seven_day_opus: { utilization: 3, resets_at: "2026-09-07T00:00:00.000Z" },
}

test("the two windows the panel renders are mapped, with resets in seconds", () => {
  // The endpoint gives an ISO timestamp where the statusLine payload gave epoch seconds — the
  // same fact in a different currency, and mixing them would put every reset a lifetime out.
  const windows = toWindows(BODY)
  assert.deepEqual(windows.map((w) => w.label), ["5h", "7d"])
  assert.equal(windows[0].percent, 7)
  assert.equal(windows[0].resetsAt, Math.floor(Date.parse("2026-09-01T18:00:00.000Z") / 1000))
  assert.equal(windows[1].windowMinutes, 10080)
})

test("a window with no utilization is dropped rather than shown as zero", () => {
  // Zero would read as "nothing used", which is a claim; absence is not.
  const windows = toWindows({ five_hour: { utilization: null, resets_at: "2026-09-01T18:00:00Z" } })
  assert.deepEqual(windows, [])
})

test("a missing or malformed reset time leaves the window without one", () => {
  const [win] = toWindows({ five_hour: { utilization: 5, resets_at: "not a date" } })
  assert.equal(win.percent, 5)
  assert.equal(win.resetsAt, null)
})

test("an empty response yields no windows at all", () => {
  assert.deepEqual(toWindows({}), [])
  assert.deepEqual(toWindows({ five_hour: null, seven_day: null }), [])
})
