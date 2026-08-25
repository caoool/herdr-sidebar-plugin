#!/bin/bash
# Silent statusLine collector.
#
# Claude Code renders whatever this prints. It prints nothing, so it is invisible — the
# footer keeps /rc and the auto-mode row — while still receiving the full session payload
# every ~10s, including rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}.
#
# If a previous statusLine was configured, install-collector.mjs records it as
# CHAIN and we exec it so the user keeps their status line.
set -u
STATE_DIR="${QUOTA_SIDEBAR_STATE_DIR:?}"
CHAIN="${QUOTA_SIDEBAR_CHAIN:-}"

payload=$(cat)
mkdir -p "$STATE_DIR/claude"

sid=$(printf '%s' "$payload" | /usr/bin/env python3 -c 'import json,sys;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)
if [ -n "$sid" ]; then
  tmp="$STATE_DIR/claude/.$sid.tmp"
  printf '%s' "$payload" | /usr/bin/env python3 -c '
import json,sys,time
d=json.load(sys.stdin); d["_collected_at"]=int(time.time()*1000)
json.dump(d,sys.stdout)' > "$tmp" 2>/dev/null && mv -f "$tmp" "$STATE_DIR/claude/$sid.json"
fi

# Preserve whatever status line the user already had.
if [ -n "$CHAIN" ]; then printf '%s' "$payload" | eval "$CHAIN"; fi
exit 0
