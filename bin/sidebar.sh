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

# `plugin pane open` has no width option and a split defaults to 50/50 — far too wide.
# `pane resize --amount` is a fraction of the TAB's total width by which the divider moves
# (verified: amount 0.25 shifted a divider 59 columns in a 235-column tab), so the amount
# needed depends on the current layout. Read it, then move the divider once.
TARGET_COLS="${HERDR_SIDEBAR_COLS:-34}"
narrow() {
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
  id=$("$HERDR" plugin pane open --plugin caoool.sidebar --entrypoint sidebar \
        --placement split --direction right --target-pane "$TARGET" --no-focus 2>/dev/null \
      | /usr/bin/env python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["plugin_pane"]["pane"]["pane_id"])' 2>/dev/null) || return 0
  [ -n "$id" ] || return 0
  printf '%s' "$id" > "$LOCK"
  narrow "$id"
}

close_pane() {
  if live; then "$HERDR" plugin pane close "$(cat "$LOCK")" >/dev/null 2>&1 || true; fi
  rm -f "$LOCK"
}

case "$MODE" in
  auto-open) open_pane ;;
  open)      open_pane ;;
  close)     close_pane ;;
  toggle)    if live; then close_pane; else open_pane; fi ;;
esac
