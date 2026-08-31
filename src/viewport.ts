/**
 * A window onto a list too long to show at once.
 *
 * The offset is clamped rather than trusted, because the list changes underneath it: a server
 * disconnects, a tool is called for the first time, the terminal is resized. An offset that was
 * valid one frame ago can point past the end of the next one, and scrolling into blank space
 * reads as a bug even though the data is fine.
 */
export type Window = {
  lines: string[]
  /** The offset actually used, after clamping. Callers store this back. */
  offset: number
  above: number
  below: number
}

export function window(lines: string[], height: number, offset: number): Window {
  if (height <= 0) return { lines: [], offset: 0, above: 0, below: lines.length }
  const max = Math.max(0, lines.length - height)
  const at = Math.min(Math.max(0, offset), max)
  const shown = lines.slice(at, at + height)
  return { lines: shown, offset: at, above: at, below: Math.max(0, lines.length - at - shown.length) }
}
