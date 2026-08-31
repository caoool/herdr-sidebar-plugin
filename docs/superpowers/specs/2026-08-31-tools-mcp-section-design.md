# TOOLS / MCP section — design

Date: 2026-08-31
Status: approved for implementation

## Purpose

A third sidebar section showing, **for the pane's own agent only**, every tool the current
session has called and every MCP server that agent has configured, with each server's status.

Scope is deliberately narrower than QUOTA. Quota belongs to an account, so every provider's
figures are shown in every pane. Tool calls and MCP servers belong to a *session* and a
*provider*, so a Claude pane shows Claude's and nothing else.

## Layout

One section, two blocks, TOOLS above MCP. Both live inside the scroll region; QUOTA and
SESSION stay pinned above it.

```
  QUOTA                          <- pinned
  CLAUDE           12% · 5h
  SESSION       Herdr side…      <- pinned
  CONTEXT           98% | 1M
  SPEED              168 t/s
  ───────────────── ↑3/28 ──     <- scroll region begins
  TOOLS            47 calls
  Bash                    21
  github:search_code       6
  MCP                   7/13
  context7                 ●
  github                   ● ▾
```

Every tool and every server is listed — no top-N truncation. The list is as long as it is;
the scroll region is what makes that affordable.

Widths, dimming and the blank-row-after-title convention follow the existing sections: labels
in grey 250, absent values as a dim `—`, all widths measured before painting.

## Scrolling

`Section` gains an optional `scrollable?: boolean`. The pane renders pinned sections in full,
subtracts their height from the viewport, and asks the scrollable section for a window of
exactly the remaining rows at the current offset. QUOTA and SESSION are untouched.

A new pure module `src/viewport.ts` owns the arithmetic:

```ts
window(lines: string[], height: number, offset: number)
  -> { lines: string[]; offset: number; above: number; below: number }
```

It clamps the offset into range, so a shrinking list or a resized terminal can never scroll
past the end. The pane holds the offset; the section holds no scroll state.

Keys, read from stdin in raw mode only when stdin is a TTY, and restored on exit:

| key | action |
|---|---|
| `↑` / `k` | up one row |
| `↓` / `j` | down one row |
| `g` / `G` | top / bottom |

PageUp and PageDown are **not** used: herdr reserves them. This was verified empirically — a
pane process received `↑` as `\x1b[A` and `j` as itself, while `PageDown` never arrived.

Edge cases:

- The scroll region has a floor of 5 rows. On a terminal too short for the pinned sections,
  the pinned block truncates from the bottom rather than the list vanishing.
- Offset resets to 0 when the subject agent changes; otherwise it survives refreshes, so a
  5-second tick never yanks the view back to the top while you are reading.
- `above`/`below` render as `↑n/total` in the divider and `▾` on the last row.

## Ordering and empty states

- TOOLS header counts **total calls**, not distinct tools. Rows are sorted by count descending,
  ties broken alphabetically so the order is stable between refreshes.
- MCP rows keep the order the agent's own command reports, so the sidebar agrees with what
  `claude mcp list` prints. The header is `connected/total` for Claude and Grok, and
  `enabled/total` for Codex.
- A session that has made no tool calls renders `TOOLS` with a dim `—`, not an empty block.
- A provider with no MCP servers configured renders `MCP` with a dim `—`. Grok is in exactly
  this state today.

## Sources

Every record shape below was verified against live files on 2026-08-31.

### Tool calls — current session only

| agent | file | record | name field |
|---|---|---|---|
| Claude | `transcript_path` (JSONL) | `message.content[]` block with `type == "tool_use"` | `.name` |
| Codex | rollout JSONL | `payload.type` in `custom_tool_call`, `function_call`, `local_shell_call` | `payload.name` |
| Grok | `updates.jsonl` | `params.update.sessionUpdate == "tool_call"` | `_meta["x.ai/tool"].name` |

Grok's `title` is a *rendered* string (``Read `/Users/…` ``), not a tool name, so `_meta` is
authoritative and `title` is only a fallback. This is the same trap as `_meta.totalTokens`
versus `usage.totalTokens` in the context reading.

Grok's `tool_call_update` records are status transitions for calls already counted and must be
ignored, or every call is counted several times.

MCP tool names collapse for display: `mcp__github__search_code` -> `github:search_code`.

### MCP servers

| agent | command | what status means | cost | JSON |
|---|---|---|---|---|
| Claude | `claude mcp list` | real health check | **9.5s**, spawns every stdio server | no |
| Codex | `codex mcp list --json` | `enabled` / `disabled` only | 0.04s | yes |
| Grok | `grok mcp list --json`, `grok mcp doctor --json` | list is config; doctor is connectivity | 0.14s | yes |

Claude's output is text, parsed per line as `name: target - status`, with statuses
`✔ Connected`, `! Needs authentication`, `✗ Failed`, `⏸ Pending approval`.

Server names shorten for display: `plugin:cloudflare:cloudflare-docs` -> `cloudflare-docs`,
`claude.ai Context7` -> `Context7`.

## Honesty rules

These follow the standing rule that a wrong value is worse than no value.

- **Codex never claims connectivity.** It only knows configuration, so its glyphs are `●`
  enabled / `○` disabled and its header counts enabled servers. No `✔`, no "connected".
- Claude and Grok, which do check, use `●` connected, `◐` needs auth, `✗` failed,
  `⏸` pending.
- A command that fails, times out, or returns nothing renders `—`, never a stale figure
  presented as current.
- A cached reading is shown only inside its TTL. Past it, the row is `—` until the refresh
  lands — the same expiry discipline as `quota/freshness.ts`.

## Caching and single-flight

Claude's 9.5-second health check cannot run on the 5-second refresh loop, and thirteen
sidebars must not each spawn it. Per the standing rule that the plugin keeps the state and
panes only read it:

- State at `<stateDir>/mcp/<provider>.json`, written atomically via tmp + rename, carrying
  `_collected_at`.
- TTL: **15 minutes** for Claude, **60 seconds** for Codex and Grok.
- Single-flight via `<stateDir>/mcp/<provider>.lock` holding pid and start time; a lock older
  than 60s is treated as abandoned.
- A refresh runs in the background; the pane renders the cached value meanwhile and never
  blocks on it.
- Watching `~/.claude.json`, `.mcp.json`, `~/.codex/config.toml` and `~/.grok/config.toml`
  invalidates the cache immediately, so an added server appears without waiting out the TTL.
- A `refresh-mcp` action forces a re-check, for when a server has just been authenticated.

## Files

```
src/viewport.ts                     window arithmetic (pure)
src/sections/tools/index.ts         Section, watch targets, cache orchestration
src/sections/tools/format.ts        TOOLS and MCP blocks
src/sections/tools/types.ts         ToolCall, McpServer, McpStatus
src/sections/tools/cache.ts         TTL, lock, atomic write
src/sections/tools/sources/calls.ts      per-agent tool-call counting
src/sections/tools/sources/claude.ts     parse `claude mcp list`
src/sections/tools/sources/codex.ts      parse `codex mcp list --json`
src/sections/tools/sources/grok.ts       parse grok list + doctor
```

Changed: `src/sections/types.ts` (`scrollable?`), `src/pane.ts` (pinned/scroll split, key
handling), `herdr-plugin.toml` (`refresh-mcp` action).

## Testing

Pure functions, in the existing `node:test` style, with fixtures captured from the live
outputs above:

- `claude mcp list` parser, including all four statuses and a malformed line.
- Codex and Grok JSON parsers, including "no servers configured".
- Tool-call counting per agent, including Grok's `tool_call_update` exclusion and the
  `mcp__a__b` shortening.
- `window()`: clamping, offset past end, list shorter than height, height of zero.
- Formatter: widths identical painted and unpainted, `—` for every absent value, Codex never
  rendering a connected glyph.
- Cache: expiry, and that an expired entry renders `—` rather than a stale value.

## Out of scope

- The todos section.
- Splitting sections into separate herdr panes. This stays available later as a
  manifest-only change, because the viewport logic lives in `src/viewport.ts` rather than in
  the pane.
