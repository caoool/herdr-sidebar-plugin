#!/bin/bash
# Supervisor for the sidebar pane.
#
# herdr launches a pane once and never relaunches it, so a plugin reinstall replaces
# dist/pane.js on disk while every open sidebar keeps executing the code it started with.
# Fixes therefore did not reach panes that had been open since before the upgrade, silently
# and indefinitely.
#
# The pane exits 75 to ask for a restart, which is the only way to swap in new code while
# keeping the pane itself — and with it the tab position and the width the user chose.
set -u
BIN="${HERDR_PLUGIN_ROOT:-.}/dist/pane.js"
while :; do
  node "$BIN"
  [ $? -eq 75 ] || break
done
