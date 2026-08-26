import type { QuotaSnapshot, QuotaWindow } from "./types.js"

/**
 * A window whose reset has already passed describes a period that has ended. Its percentage
 * says nothing about the current period, and its countdown is meaningless.
 *
 * This is not hypothetical. Codex only writes a rollout while it runs, so an unused machine
 * still has a week-old rollout; the sidebar rendered its "4%" against a reset six days gone
 * as a current figure with a "0D" countdown. Claude can do the same: a session sitting idle
 * keeps the rate_limits from its last API response, so its five-hour window can close while
 * the file keeps being rewritten every ten seconds.
 *
 * The next boundary cannot be inferred — stepping the old reset forward by the window length
 * does not land where the server actually resets — so an expired window is dropped, never
 * repaired.
 */
export const isExpired = (win: QuotaWindow, now: number): boolean =>
  win.resetsAt !== null && win.resetsAt * 1000 <= now

/**
 * Enforce, in one place, that nothing stale reaches the screen.
 *
 * Every source is subject to this, not just the one that exposed the problem, and it is
 * applied to remembered readings as well as fresh ones — otherwise the stickiness that
 * protects against a momentary read failure would quietly resurrect a reading that expiry
 * had just discarded.
 *
 * A reading that is old but still inside its window is kept. Usage only rises, so such a
 * figure is a lower bound on the truth rather than a fabrication — understating by a little
 * is honest in a way that reporting a closed window is not.
 */
export function sanitize(snap: QuotaSnapshot | null, now: number): QuotaSnapshot | null {
  if (!snap) return null
  const windows = snap.windows.filter((w) => !isExpired(w, now))
  if (!windows.length) return null
  return windows.length === snap.windows.length ? snap : { ...snap, windows }
}
