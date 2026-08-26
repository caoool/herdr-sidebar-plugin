# herdr-sidebar-plugin

A right-hand sidebar for [herdr](https://github.com/herdrdev/herdr), showing information about
the coding agents you have running — Claude Code, Codex, and Grok.

The sidebar is a stack of independent **sections**. Today there is one:

| section | status | shows |
|---|---|---|
| **quota** | shipped | subscription utilisation and reset per agent |
| mcp | planned | connected MCP servers and their status |
| tasks | planned | the agent's current task list |

Descended from [`opencode-cpa-quota-plugin`](https://github.com/caoool/opencode-cpa-quota-plugin),
with the CLI Proxy API dependency removed.

## The quota section

Two of three agents already pull their own utilisation as a side effect of ordinary work and
leave it on disk, so the sidebar **reads** rather than fetches. No credential handling, no API
call, no rate-limit exposure.

| | channel | payload |
|---|---|---|
| **Claude** | a `statusLine` command that prints nothing — invisible, fires ~10s even when idle | `rate_limits.five_hour` / `.seven_day` → `{used_percentage, resets_at}` |
| **Codex** | `~/.codex/sessions/**/rollout-<ts>-<session-uuid>.jsonl`, appended live per turn | `rate_limits.primary{used_percent, window_minutes, resets_at}`, `.secondary`, `credits`, `plan_type` |
| **Grok** | `GET cli-chat-proxy.grok.com/v1/billing?format=credits`, cached 10 min per machine | `creditUsagePercent` (or `totalUsed`/`monthlyLimit`), `currentPeriod`, `subscriptionTier` |

Readings are account-wide: quota belongs to an account, not a session, so every agent's figures
appear in every sidebar. Reads are bounded to the tail of the file, so cost does not scale with
session length.

Claude needs reconciling across sessions, because each live session caches `rate_limits` from
*its own* last API response — an idle session holds a staler figure, and one that has not made
its first call carries none. Usage only rises within a window, so the largest reading of a
window is necessarily the latest; a window is identified by its `resets_at`, so only the
current one is considered and yesterday's high-water mark cannot bleed into today.

Codex and Claude need no setup — the collector installs itself on the first server start
after install. Grok is the one agent that will not give its figure away for free; see below.

```
  CLAUDE
  5h   15%              00:10
  7d   11%                 6D

  CODEX
  7d    4%                 0D

  GROK
  7d     —                 1D
```

The agent running in this pane leads and renders at full strength — bold name, full-intensity
ramp. Every other agent's block recedes: the name loses its weight and its rows are dimmed,
keeping the band hue at reduced intensity. Their figures are still worth showing, since quota
is account-wide, but they are not what this pane is spending.

Reset renders as days remaining for a window of a day or more, and as a 24h clock time
otherwise — chosen from the reported window *duration*, not its label, because Codex changes
that duration server-side without notice. Percentages colour green ≤30, blue ≤60, orange ≤80,
red above; a missing reading is dimmed rather than coloured, because absence of a figure is not
a low figure.

### Why Grok costs a request, and why it may read 0%

Grok has no statusLine equivalent and caches nothing to disk, so its figure needs the same
call `/usage` makes. Its `billing: fetched credits config` log line looks like a free
substitute but is a hand-built summary — it prints `historyLen` where the payload has
`history` and drops `topUpMethod` — so it serves only as a fallback for tier and period.

Overhead is one request per ten minutes for the whole machine: the result is cached in the
plugin state directory, so extra panes cost nothing and a restart starts warm. The token is
read from `~/.grok/auth.json` fresh on each call and never written back — that file holds a
`refresh_token`, and rotating it would log you out of your own CLI.

On a flat subscription with no pay-as-you-go spend the response carries no utilisation field
at all, and the sidebar reports **0%** — the same thing Grok's own `/usage` prints from the
identical payload:

```
Weekly limit: 0%
Next reset: August 27, 06:45
```

There is nothing metered to report on such an account: `onDemandCap` and `onDemandUsed` are
both zero. Only a genuinely unreadable account — no billing response at all — renders without
a figure.

## Install

```sh
herdr plugin install caoool/herdr-sidebar-plugin
```

herdr clones the repo, runs the build, and registers it. There is no `plugin update` in v1 —
reinstall to pick up a new commit. npm is not an install path: `herdr plugin install` accepts
GitHub shorthand only.

That is all — there is nothing to invoke by hand. The plugin installs the Claude statusLine
collector itself, on the first agent detection and again on every server start. It is the
only user setting this plugin writes, it backs up `settings.json` first, and it is idempotent.

No third-party status line is required. If you already have one it is preserved and run after
the collector captures its payload; if you have none the collector runs alone and prints
nothing. `sidebar: reinstall Claude quota collector` repairs it if the settings file is later
edited by hand.

The sidebar opens automatically when herdr detects an agent (`pane.agent_detected`), one per
tab. `sidebar: toggle` opens and closes it by hand:

```toml
[[keys.command]]
key = "prefix+q"
type = "plugin_action"
command = "caoool.sidebar.toggle"
description = "toggle sidebar"
```

Width defaults to 34 columns; override with `HERDR_SIDEBAR_COLS`.

## Layout

```
herdr-plugin.toml            manifest: pane, actions, pane.agent_detected hook, startup
bin/sidebar.sh               tab-scoped idempotent open/close + width computation
bin/statusline-collector.sh  the silent Claude collector (prints nothing, chains)
bin/install-collector.mjs    chain-safe installer, backs up settings.json
bin/startup.mjs              startup hook: clears stale pane locks, ensures the collector
src/pane.ts                  resolves the pane's agent, drives sections, stacks output
src/herdr.ts                 snapshot client, pane identity, subject resolution
src/ansi.ts                  styling primitives and the utilisation colour ramp
src/tail.ts                  bounded reads of append-only logs
src/sections/types.ts        the Section interface
src/sections/quota/          the quota section: sources, formatting, types
```

Adding a section is a directory under `src/sections` and one entry in `SECTIONS` in
`src/pane.ts`. Sections own their sources and rendering; the pane owns neither.

## Two things that are easy to get wrong

**`HERDR_PANE_ID` means two different things.** In a *pane* process it is that pane's own id
(`src/pane.rs`, `PaneLaunchIdentity::Managed`). In an *action or event hook* it is the event
target or focused pane (`src/app/api/plugins/runtime.rs`, from `context.focused_pane_id`).
Reading it as "self" inside a hook is a real bug.

**Never derive the subject from focus.** Focusing the sidebar sets `focused_pane_id` to the
sidebar's own pane, so focus-driven identity blanks the panel the moment anyone clicks it.
`resolveSubject` reads `session.snapshot.agents[]` — which herdr already filters to real agent
panes — scopes to the sidebar's own tab, and keeps the last subject as a fallback.

## Development

```sh
npm install
npm run check     # typecheck + tests + build
herdr plugin link .
```

Installing over a linked plugin is refused, and vice versa — `uninstall` before `link`.
