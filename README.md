# herdr-quota-sidebar

A right-hand herdr sidebar showing subscription quota for the coding agent running in the
current pane — Claude Code, Codex, or Grok.

Port of [`opencode-cpa-quota-plugin`](https://github.com/caoool/opencode-cpa-quota-plugin),
with two differences: no CLI Proxy API dependency, and quota is **read**, not fetched.

## How it gets the numbers

Two of three agents already pull their own utilisation as a side effect of ordinary work and
leave it on disk. The sidebar watches those files. Nothing polls an API, so there is no
credential handling, no rate-limit exposure, and no reauth path.

| | channel | payload |
|---|---|---|
| **Claude** | a `statusLine` command that prints nothing — invisible, fires ~10s even when idle | `rate_limits.five_hour` / `.seven_day` → `{used_percentage, resets_at}` |
| **Codex** | `~/.codex/sessions/**/rollout-<ts>-<session-uuid>.jsonl`, appended live per turn | `rate_limits.primary{used_percent, window_minutes, resets_at}`, `.secondary`, `credits`, `plan_type` |
| **Grok** | `~/.grok/logs/unified.jsonl`, line `msg: "billing: fetched credits config"` | `subscriptionTier`, `currentPeriod{type,end}` — **no utilisation percent** on unified-billing accounts |

Codex needs no setup at all. Claude needs the collector installed once
(`quota: connect Claude`), which is the only user setting this plugin writes — it chains any
existing `statusLine` rather than replacing it.

### The Grok caveat

On a unified-billing account the logged config carries no `creditUsagePercent`. The window is
emitted with `percent: null` and renders as a period with a reset time and no bar. It is
never coerced to `0` — a permanent, confident zero is worse than an honest blank.

## Install

```sh
herdr plugin install caoool/herdr-sidebar-plugin     # or: herdr plugin link .
herdr plugin action invoke caoool.quota-sidebar.connect-claude   # optional, Claude only
```

The sidebar opens automatically when herdr detects an agent (`pane.agent_detected`), one per
tab. `quota: toggle sidebar` opens and closes it manually; bind it if you like:

```toml
[[keys.command]]
key = "prefix+q"
type = "plugin_action"
command = "caoool.quota-sidebar.toggle"
description = "toggle quota sidebar"
```

Width defaults to 34 columns; override with `QUOTA_SIDEBAR_COLS`.

## Layout

```
herdr-plugin.toml            manifest: pane, actions, pane.agent_detected hook, startup
bin/sidebar.sh               tab-scoped idempotent open/close + width computation
bin/statusline-collector.sh  the silent Claude collector (prints nothing, chains)
bin/install-collector.mjs    chain-safe installer, backs up settings.json
bin/restore.mjs              startup hook: clears stale pane locks after a herdr restart
src/herdr.ts                 snapshot client, pane identity, subject resolution
src/sources/{claude,codex,grok}.ts
src/pane.ts                  the pane process: watch files, render
```

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
