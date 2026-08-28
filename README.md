# herdr-sidebar-plugin

A right-hand sidebar for [herdr](https://github.com/herdrdev/herdr), showing information about
the coding agents you have running — Claude Code, Codex, and Grok.

The sidebar is a stack of independent **sections**. Today there is one:

| section | status | shows |
|---|---|---|
| **quota** | shipped | subscription utilisation and reset per agent |
| **session** | shipped | what the agent in this pane is doing, and where |
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
| **Codex** | its session rollout while it runs, else `codex app-server` → `account/rateLimits/read`, cached 10 min | `primary`/`secondary` `{used_percent, window_minutes, resets_at}`, `credits`, `plan_type` |
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

### Nothing stale reaches the screen

A window whose reset has passed describes a period that has ended: its percentage says nothing
about the current one and its countdown is meaningless. Such a window is dropped, and an agent
left with none renders `—`. The next boundary is never inferred — stepping the old reset
forward by the window length does not land where the server actually resets.

This is enforced in one place, over every source, and over remembered readings as well as
fresh ones. A reading is remembered so that a momentary failure does not blank the panel, but
it is re-checked each time; otherwise remembering would hand back exactly what expiry had just
discarded.

A reading that is old but still inside its window is kept. Usage only rises, so it understates
the truth rather than inventing it.

Reset renders as days remaining for a window of a day or more, and as a 24h clock time
otherwise — chosen from the reported window *duration*, not its label, because Codex changes
that duration server-side without notice. Percentages colour green ≤30, blue ≤60, orange ≤80,
red above; a missing reading is dimmed rather than coloured, because absence of a figure is not
a low figure.

### Why Codex sometimes needs a subprocess

Codex appends its rate-limit state to the session rollout as it works, so while it is running
the reading is current and free. But it writes nothing when it is not running, so a machine
that has not used it for a week still has a week-old rollout — and a reading whose window has
since closed says nothing about the current one. Stepping the old reset forward by the window
length does not land where the server actually resets, so an expired reading is discarded
rather than repaired.

When no rollout covers the current window, `codex app-server --stdio` answers
`account/rateLimits/read` in about a second, cached ten minutes per machine. Codex owns the
credential, so the sidebar never reads `~/.codex/auth.json`. If that token has been revoked
the call fails and Codex renders `—`; `codex login` restores it.

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

## The session section

Strictly per-pane, unlike quota: everything here belongs to the session in front of you. With no
agent in the tab there is nothing to describe, and the block is omitted rather than filled with
dashes.

```
  SESSION   Refactor the parser

  MODEL      gpt-5.6-sol | high
  MODE              ● on-request
  CONTEXT             72% | 258K
  SPEED                   41 t/s

  WORKSPACE          my-project
  BRANCH                   main
  WORKTREE            feature-x
  DIFF                    ↑2 ↓1
```

The session's name rides the heading rather than taking a row: it names the block, which is what
a heading is for, and every row below is a fact about it.

The context percentage uses the same ramp as quota, shifted: red starts at 90 rather than 80. A
context window and a quota window are not equally urgent at the same reading — quota at 80%
means most of a period's budget is gone with no recourse but to wait, while context at 80% is
ordinary working territory that only becomes pressing as compaction approaches.

Sandbox is a lit dot when the agent is sandboxed and an unlit one when it is not; the glyph
changes as well as the colour, so the state survives a terminal with colour disabled. Row labels
and provider names are dimmed — they say what a value *is*, and the figures are what is being
read.

The agents describe sandboxing differently — a Codex `sandbox_policy`, a Grok profile name, a
Claude boolean — so only on/off is shown, which is the one distinction common to all three. For
Codex every policy constrains the agent except `danger-full-access`; for Grok every profile
except `off`.

| | claude | codex | grok |
|---|---|---|---|
| model | `model.display_name` | `turn_context.model` | `summary.json` `current_model_id` |
| effort | `effort.level`, or the `/effort` preset from the transcript | `turn_context.effort` | `summary.json` `reasoning_effort` |
| context | `context_window.used_percentage` + `context_window_size` | `token_count.info` + `model_context_window` | `updates.jsonl` `_meta.totalTokens` ÷ `models_cache` `context_window` — **not** `usage.totalTokens` |
| speed | transcript, 120s window of request intervals | Δ`total_token_usage.output_tokens` ÷ Δtimestamp | `turn_completed` `usage.outputTokens ÷ apiDurationMs` |
| permission | the pane's footer, with a hook as fallback | `turn_context.approval_policy` | `config.toml` only, machine-wide |
| sandbox | layered settings `sandbox.enabled` | `turn_context.sandbox_policy.type` | `summary.json` `sandbox_profile` |

Codex needs nothing installed: its rollout already records a `turn_context` per turn carrying
model, effort, approval policy and sandbox, and `token_count` records carry cumulative output
tokens against `model_context_window`.

Claude is the awkward one. Its statusLine payload has model, effort and context but neither
permission mode nor sandbox — the payload builder takes `permissionMode` as an argument and uses
it only to decide which model id to report, and the documented field list has no sandbox entry.

**Permission mode** is read from the pane's own footer, because no hook fires when it is cycled:
`ConfigChange` covers configuration *files*, and shift+tab is in-memory. A hook on
`UserPromptSubmit` and `PostToolUse` is still installed as a fallback for when a dialog covers
the footer, but the screen is what makes the value live. No match returns nothing rather than
assuming "default", since an obscured footer is indistinguishable from an unset mode.

**Sandbox** is derived from the same layered settings Claude itself reads — `sandbox.enabled`,
nearest scope first, from the project's `.claude/settings.local.json` down to the user's
`settings.json`. This is the mechanism ccstatusline's indicator uses and it carries the same
caveat: managed policy or a CLI flag can override those files, so it describes configuration
rather than a guaranteed live state.

**Effort** shows the preset where one exists. `/effort ultracode` sets "xhigh + dynamic workflow
orchestration", so the payload reports `xhigh` and the preset name reaches no config file — it is
session-only state. It is recoverable because `/effort` echoes its result into the transcript as
command output, which the sidebar reads. The tail is checked first so a change is picked up
immediately; only if nothing is found there is the whole file scanned, once, and remembered per
session. A remembered preset is dropped if its underlying level stops matching what the payload
reports, since effort can be changed by routes that leave no transcript line.

Model names are shown without their parenthetical asides: Claude reports
"Opus 5 (1M context) (default)", and the context variant and default marker describe the
account rather than which model is answering.

Grok's permission mode is only in machine-wide config, so a session started with an overriding
flag would be misreported; it is carried as the weaker claim it is.

Claude's rate is computed the way its status line computes it, so the two agree: each assistant
message in the transcript is paired with the entry that prompted it, giving that response's
duration; tokens and durations are summed over a 120-second window ending at the transcript's
latest entry, with overlapping intervals merged so a streamed message counts its wall time once.

Idle time between turns falls outside every interval and so never enters the denominator — a
rate that counted the user's typing as generation time would not be a generation rate. Only the
tail of the transcript is read: these files reach tens of megabytes and this runs every few
seconds, where the status line can afford to read the whole file once per render.

The obvious cheaper route does not work. `context_window.total_output_tokens` is **not**
cumulative — it equals `current_usage.output_tokens` in every session observed — so differencing
it is meaningless, and dividing one response's tokens by the increase in
`cost.total_api_duration_ms` understates by roughly the number of API calls in the sampling
interval, which in a tool loop is several.

The last four rows describe where the pane is working. The workspace name and cwd come from the
context herdr injects at launch, so naming the project costs nothing; only the git facts are
asked for. herdr computes the same facts for its own sidebar rows but exposes them only for
worktree-backed workspaces — `workspace.get` carries no branch — so this asks git directly: two
invocations, the first batching three rev-parse queries, cached for fifteen seconds because git
state changes at human speed while the pane repaints every five.

`DIFF` is divergence from upstream in herdr's own shape, and reads as a dash when there is none:
printing `↑0 ↓0` would make the ordinary case the loudest thing on the row. A linked worktree is
identified by git's own layout, where a linked checkout keeps its git dir under
`<common>/worktrees/<name>`.

## Install

```sh
herdr plugin install caoool/herdr-sidebar-plugin
```

herdr clones the repo, runs the build, and registers it. There is no `plugin update` in v1 —
reinstall to pick up a new commit. npm is not an install path: `herdr plugin install` accepts
GitHub shorthand only.

Sidebars already open pick the new build up on their own. herdr launches a pane once and never
relaunches it, so a reinstall would otherwise replace the bundle on disk while every open
sidebar carried on running the code it started with — indefinitely, and with no sign that
anything was stale. The pane notices its own bundle has changed and restarts in place, keeping
its tab position and width.

That is all — there is nothing to invoke by hand. The plugin installs the Claude statusLine
collector itself, on the first agent detection and again on every server start. It is the
only user setting this plugin writes, it backs up `settings.json` first, and it is idempotent.

No third-party status line is required. If you already have one it is preserved and run after
the collector captures its payload; if you have none the collector runs alone and prints
nothing. `sidebar: reinstall Claude quota collector` repairs it if the settings file is later
edited by hand.

The sidebar opens automatically when herdr detects an agent (`pane.agent_detected`), one per
tab, and closes itself once that agent is gone.

Closing has to be noticed rather than received. Quitting an agent leaves its pane alive at a
shell prompt, so herdr fires no pane event — the pane simply drops out of `agents[]`. The
sidebar watches for that absence, and waits out a short grace period first, because detection
is screen-based and can lose an agent for a moment during a redraw or a restart. A sidebar
opened by hand in a tab where no agent has ever run stays put. Set
`HERDR_SIDEBAR_AUTO_CLOSE=0` to keep it open regardless.

`sidebar: toggle` opens and closes it by hand:

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
