/**
 * Terminal styling.
 *
 * 256-colour codes rather than the basic eight, because the ramp needs an orange step and
 * the basic palette has none — using theme colours for three steps and a fixed colour for
 * the fourth would make the scale read unevenly across themes.
 */
const ESC = "\x1b["

const enabled = (): boolean => !process.env.NO_COLOR && process.env.TERM !== "dumb"

const wrap = (code: string, s: string): string => (enabled() ? `${ESC}${code}m${s}${ESC}0m` : s)

export const bold = (s: string): string => wrap("1", s)

const GREEN = "38;5;41"
const BLUE = "38;5;39"
const ORANGE = "38;5;208"
const RED = "38;5;203"
const DIM = "2"

/**
 * Utilisation ramp. The bands are contiguous so no value can fall between them — a
 * percentage may be fractional (Codex reports 4.0, Claude 22.5), and a gap would leave
 * those values silently unstyled.
 *
 *   <= 30  green    comfortable
 *   <= 60  blue     over a third gone
 *   <= 80  orange   worth pacing
 *   >  80  red      close to the wall
 *
 * A null percentage is dimmed rather than coloured: it is the absence of a reading, not a
 * low one, and painting it green would read as "plenty left".
 */
export function percentStyle(percent: number | null): string {
  if (percent === null) return DIM
  if (percent <= 30) return GREEN
  if (percent <= 60) return BLUE
  if (percent <= 80) return ORANGE
  return RED
}

export const paintPercent = (text: string, percent: number | null): string =>
  wrap(percentStyle(percent), text)

/** Injected rather than imported directly so tests can render unstyled and assert layout. */
export type Style = {
  bold: (s: string) => string
  paint: (text: string, percent: number | null) => string
}

export const PLAIN: Style = { bold: (s) => s, paint: (t) => t }
export const TERMINAL: Style = { bold, paint: paintPercent }
