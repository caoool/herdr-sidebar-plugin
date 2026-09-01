/**
 * Terminal display width, in columns rather than characters.
 *
 * Every row in the sidebar is built to an exact column count, and until now that count was
 * `String.length` — which is a character count, not a width. A CJK session name is the case that
 * exposes it: "AI使用分享文档" is eight characters and fourteen columns, so its row was built six
 * columns too wide, wrapped, and pushed the whole frame past the pane's height. The terminal then
 * scrolled, which is why the sidebar appeared to scroll as a whole and why the previous frame's
 * heading stayed visible above the current one.
 *
 * This is the minimum correct model, not a full implementation of UAX #11: wide where East Asian
 * Wide or Fullwidth, wide for the emoji ranges that render double, zero for combining marks and
 * the joiners that glue sequences together, one otherwise. Ambiguous-width characters — the em
 * dash and the arrows this sidebar uses — are treated as single, which is how they render in the
 * terminals herdr runs in.
 */

const ANSI = /\x1b\[[0-9;]*m/g

/** Ranges that occupy two columns. */
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f],   // Hangul Jamo initial consonants
  [0x2e80, 0x303e],   // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff],   // Hiragana, Katakana, CJK compatibility
  [0x3400, 0x4dbf],   // CJK extension A
  [0x4e00, 0x9fff],   // CJK unified ideographs
  [0xa000, 0xa4cf],   // Yi
  [0xac00, 0xd7a3],   // Hangul syllables
  [0xf900, 0xfaff],   // CJK compatibility ideographs
  [0xfe10, 0xfe19],   // vertical forms
  [0xfe30, 0xfe6f],   // CJK compatibility forms
  [0xff00, 0xff60],   // fullwidth forms
  [0xffe0, 0xffe6],   // fullwidth signs
  [0x1f300, 0x1f64f], // emoji: symbols and pictographs, emoticons
  [0x1f680, 0x1f6ff], // emoji: transport and map
  [0x1f900, 0x1f9ff], // emoji: supplemental
  [0x20000, 0x3fffd], // CJK extensions B and beyond
]

/** Ranges that occupy no columns: combining marks, joiners, variation selectors. */
const ZERO: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
]

const inRanges = (cp: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi)

/** Columns one character occupies. */
export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (inRanges(cp, ZERO)) return 0
  return inRanges(cp, WIDE) ? 2 : 1
}

/** Columns a string occupies, ignoring any ANSI escapes it carries. */
export function displayWidth(text: string): number {
  let total = 0
  for (const ch of text.replace(ANSI, "")) total += charWidth(ch.codePointAt(0)!)
  return total
}

/**
 * Cut to a column budget, marking the cut with an ellipsis.
 *
 * Cutting by columns rather than characters means a wide character is never split across the
 * boundary: it is dropped whole, leaving a column short rather than a column over.
 */
export function truncateToWidth(text: string, maxColumns: number): string {
  if (maxColumns <= 0) return ""
  if (displayWidth(text) <= maxColumns) return text
  if (maxColumns === 1) return "…"
  let out = ""
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!)
    if (used + w > maxColumns - 1) break
    out += ch
    used += w
  }
  return out.trimEnd() + "…"
}

/** Pad to a column count, so a row of wide characters still lands on the same boundary. */
export const padToWidth = (text: string, columns: number): string =>
  text + " ".repeat(Math.max(0, columns - displayWidth(text)))
