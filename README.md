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
| **Grok** | `~/.grok/logs/unified.jsonl`, line `msg: "billing: fetched credits config"` | `subscriptionTier`, `currentPeriod{type,end}` — **no utilisation percent** on unified-billing accounts |

Readings are account-wide: quota belongs to an account, not a session, so each source takes its
newest reading across all sessions and every agent's figures appear in every sidebar. Reads are
bounded to the tail of the file, so cost does not scale with session length.

Codex needs no setup. Claude needs the collector installed once. Grok needs nothing and gives
no percentage — see below.

```
  CLAUDE
  5h   15%              00:10
  7d   11%                 6D

  CODEX
  7d    4%                 0D

  GROK
  7d     —                 1D
```

Reset renders as days remaining for a window of a day or more, and as a 24h clock time
otherwise — chosen from the reported window *duration*, not its label, because Codex changes
that duration server-side without notice. Percentages colour green ≤30, blue ≤60, orange ≤80,
red above; a missing reading is dimmed rather than coloured, because absence of a figure is not
a low figure.

### Why Grok shows a dash

On a `isUnifiedBillingUser` account the billing response carries no `creditUsagePercent` —
that key, and `productUsage`, `usagePercent`, `monthlyLimit`, appear nowhere in Grok's logs.
Grok's own client parses those fields, so they exist for some account types, but the server
does not send them here. The sidebar shows the period and its reset and leaves the figure
blank rather than substituting `0`, which is what the predecessor did and which renders as a
confident, permanent zero.

## Install

```sh
herdr plugin install caoool/herdr-sidebar-plugin
```

herdr clones the repo, runs the build, and registers it. There is no `plugin update` in v1 —
reinstall to pick up a new commit. npm is not an install path: `herdr plugin install` accepts
GitHub shorthand only.

Claude quota additionally needs its collector, which is the only user setting this plugin
writes. It backs up `settings.json` and chains any existing `statusLine` rather than replacing
it:

```sh
herdr plugin action invoke caoool.sidebar.connect-claude
```

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
bin/restore.mjs              startup hook: clears stale pane locks after a herdr restart
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
