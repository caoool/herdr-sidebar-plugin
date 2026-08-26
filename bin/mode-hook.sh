#!/bin/bash
# Captures Claude's permission mode, which nothing else exposes.
#
# The statusLine payload does not carry it: the builder takes permissionMode as an argument but
# only uses it to choose which model id to report. Hook payloads do carry it, so this records it
# beside the collector's file for the same session.
#
# It follows that the value is only as fresh as the session's last activity — toggling with
# shift+tab and then sitting still leaves it stale until the next prompt or tool call.
set -u
STATE_DIR="${SIDEBAR_STATE_DIR:?}"
payload=$(cat)
mkdir -p "$STATE_DIR/claude"

printf '%s' "$payload" | STATE_DIR="$STATE_DIR" /usr/bin/env python3 -c '
import json, os, sys, time
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
sid = d.get("session_id")
mode = d.get("permission_mode")
if not sid or not mode:
    raise SystemExit(0)
base = os.path.join(os.environ["STATE_DIR"], "claude")
tmp = os.path.join(base, ".%s.mode.tmp" % sid)
with open(tmp, "w") as fh:
    json.dump({"permission_mode": mode, "at": int(time.time() * 1000)}, fh)
os.replace(tmp, os.path.join(base, "%s.mode.json" % sid))
' 2>/dev/null
exit 0
