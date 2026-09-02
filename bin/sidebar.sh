#!/bin/bash
# Open / toggle the sidebar.
#
# In an ACTION or EVENT hook, HERDR_PANE_ID is the event target or focused pane — NOT this
# script's own pane (it has none). For pane.agent_detected that is exactly the pane that
# just gained an agent, which is what we want to sit beside.
set -eu
MODE="${1:-toggle}"
HERDR="${HERDR_BIN_PATH:-herdr}"
STATE="${HERDR_PLUGIN_STATE_DIR:?}"
TARGET="${HERDR_PANE_ID:-}"
TAB="${HERDR_TAB_ID:-}"
[ -n "$TARGET" ] || exit 0
mkdir -p "$STATE/panes"
LOCK="$STATE/panes/${TAB//:/_}"

# The sidebar is a fixed column count, not a split ratio. A 50/50 open is far too
# wide, and a ratio that lands on 34 columns today grows with the terminal tomorrow.
# Prefer herdr's own flags when the installed binary advertises them — `--width` is
# in the schema but 0.8.2's CLI does not list it (and passing an unknown flag fails
# the open); `--max-width` does not exist there at all. Probe help, never guess.
# Formula kept in lockstep with src/narrow.ts.
TARGET_COLS="${HERDR_SIDEBAR_COLS:-34}"
help=$("$HERDR" plugin pane open --help 2>&1 || true)
width_flags=""
printf '%s\n' "$help" | grep -Eq -- '(^|[[:space:]])--width([[:space:]]|=|$)' && \
  width_flags="$width_flags --width $TARGET_COLS"
printf '%s\n' "$help" | grep -Eq -- '(^|[[:space:]])--max-width([[:space:]]|=|$)' && \
  width_flags="$width_flags --max-width $TARGET_COLS"

narrow() {
  # Fallback when herdr opened a ratio split. `pane resize --amount` is a fraction
  # of the TAB's total width (verified: 0.25 shifted a divider 59 columns in a
  # 235-column tab). Skip when already at or under the cap, including one column
  # of rounding — shrinking a user-narrowed pane would be the opposite of max-width.
  "$HERDR" pane layout --pane "$1" 2>/dev/null | TARGET="$TARGET_COLS" PANE="$1" \
    /usr/bin/env python3 -c '
import json,os,sys
try: L=json.load(sys.stdin)["result"]["layout"]
except Exception: sys.exit(1)
area=L["area"]["width"]
me=next((p for p in L["panes"] if p["pane_id"]==os.environ["PANE"]), None)
if not me or not area: sys.exit(1)
delta=me["rect"]["width"]-int(os.environ["TARGET"])
if delta<=1: sys.exit(1)
print(f"{delta/area:.4f}")
' | while read -r amount; do
    "$HERDR" pane resize --pane "$1" --direction right --amount "$amount" >/dev/null 2>&1 || true
  done
}

live() { [ -f "$LOCK" ] && "$HERDR" pane get "$(cat "$LOCK")" >/dev/null 2>&1; }

open_pane() {
  # Tab-scoped idempotency. Without this, a second pane.agent_detected in the same tab
  # opens a second sidebar — and if our own pane were ever misdetected as an agent, the
  # hook would recurse.
  if live; then return 0; fi
  # $width_flags is empty or a pair of tokens we control (flag + integer).
  # shellcheck disable=SC2086
  id=$("$HERDR" plugin pane open --plugin caoool.sidebar --entrypoint sidebar \
        --placement split --direction right --target-pane "$TARGET" --no-focus \
        $width_flags 2>/dev/null \
      | /usr/bin/env python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["plugin_pane"]["pane"]["pane_id"])' 2>/dev/null) || return 0
  [ -n "$id" ] || return 0
  printf '%s' "$id" > "$LOCK"
  narrow "$id"
}

close_pane() {
  if live; then "$HERDR" plugin pane close "$(cat "$LOCK")" >/dev/null 2>&1 || true; fi
  rm -f "$LOCK"
}

# The collector is NOT installed here any more.
#
# This runs on pane.agent_detected — every time an agent session starts — and it wrote a
# statusLine into the user's settings each time. That made the plugin work the moment it was
# installed, back when the collector was the only channel reporting Claude quota. It no longer
# is: quota comes from the account's usage endpoint and the session block from the transcript.
#
# It also made the setting impossible to remove. A status line is not free — Claude draws it on
# its own row and puts the /rc badge there — so removing one is a deliberate choice, and this
# undid that choice on the very next session start. The symptom was maddening: the file would be
# clean, a new session would be opened, and the row would be back before it finished starting.
# The `connect-claude` action installs the collector for anyone who wants it.

case "$MODE" in
  auto-open) open_pane ;;
  open)      open_pane ;;
  close)     close_pane ;;
  toggle)    if live; then close_pane; else open_pane; fi ;;
esac
