import { homedir } from "node:os"

/**
 * The working directory every child process is spawned from.
 *
 * Not a detail. herdr launches a plugin pane inside the checkout it was installed from, and every
 * later reinstall deletes that directory — so a sidebar left open across an upgrade is running
 * with a working directory that no longer exists. A process cannot be spawned from a deleted
 * directory: the child fails immediately, and on macOS several CLIs refuse to start at all
 * ("The current working directory was deleted, so that command didn't work").
 *
 * This is not hypothetical. It silently broke the MCP health check, the pane's own auto-close,
 * and the label it claims at startup — each failing only on the panes that had been open longest,
 * which is precisely when the failure is hardest to reproduce.
 *
 * Every spawn in this codebase therefore passes an explicit cwd. Nothing here needs the pane's
 * directory: the herdr and agent CLIs are indifferent to it, and git is always given `-C`.
 */
export const SAFE_CWD = homedir()
