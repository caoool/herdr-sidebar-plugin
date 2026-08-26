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

/**
 * Dim + colour, then re-assert dim.
 *
 * An inactive block is dimmed as a whole, but the percentage still needs its band colour so
 * the ramp stays readable. The usual reset at the end of a painted span would cancel the
 * surrounding dim for the remainder of the line, so dim is turned back on immediately after.
 */
const paintPercentInactive = (text: string, percent: number | null): string => {
  if (!enabled()) return text
  const colour = percentStyle(percent)
  const code = colour === DIM ? DIM : `${DIM};${colour}`
  return `${ESC}${code}m${text}${ESC}0m${ESC}${DIM}m`
}

/** Injected rather than imported directly so tests can render unstyled and assert layout. */
export type Style = {
  bold: (s: string) => string
  paint: (text: string, percent: number | null) => string
  /** Applied to each finished line. Used to dim a whole block at once. */
  line?: (s: string) => string
  /** A two-state indicator: on reads as good, off as inert. */
  mark?: (text: string, on: boolean) => string
}

export const PLAIN: Style = { bold: (s) => s, paint: (t) => t }

/**
 * A lit indicator versus an unlit one. Colour and glyph both change, so the state survives a
 * terminal with colour disabled, where two differently-coloured dots would look identical.
 */
export const mark = (text: string, on: boolean): string => wrap(on ? GREEN : DIM, text)

/** The pane's own agent: bold name, full-strength ramp. */
export const TERMINAL: Style = { bold, paint: paintPercent, mark }

/**
 * Every other agent. Their figures are still worth showing — quota is account-wide — but they
 * are not what this pane is spending, so the whole block recedes: the name loses its weight
 * and the ramp keeps its hue at reduced intensity.
 */
export const TERMINAL_INACTIVE: Style = {
  bold: (s) => s,
  paint: paintPercentInactive,
  line: (s) => wrap(DIM, s),
}
