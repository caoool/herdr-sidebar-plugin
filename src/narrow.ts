import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { herdrBin, selfPaneId } from "./herdr.js"
import { SAFE_CWD } from "./run.js"

const run = promisify(execFile)

/** Default sidebar width in columns. Override with HERDR_SIDEBAR_COLS. */
export const DEFAULT_COLS = 34

export function targetCols(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HERDR_SIDEBAR_COLS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_COLS
}

export type Layout = {
  area?: { width?: number }
  panes?: { pane_id?: string; rect?: { width?: number } }[]
}

/**
 * Fraction of the tab's width by which to move the right divider so this pane
 * lands on `target` columns. Null when no shrink is needed — already at or
 * below the target, one column of rounding error, or an unreadable layout.
 *
 * `pane resize --amount` is a fraction of the TAB, not of the pane. Growing a
 * pane that the user already made thinner is max-width's opposite, so a
 * shortfall is left alone.
 */
export function shrinkAmount(layout: Layout, paneId: string, target: number): number | null {
  const area = layout.area?.width
  const width = layout.panes?.find((p) => p.pane_id === paneId)?.rect?.width
  if (!area || width == null) return null
  const delta = width - target
  if (delta <= 1) return null
  return delta / area
}

export function layoutFromResponse(raw: string): Layout | null {
  try {
    const layout = JSON.parse(raw)?.result?.layout
    return layout && typeof layout === "object" ? layout as Layout : null
  } catch {
    return null
  }
}

/**
 * Flags herdr actually advertises on `plugin pane open`. Passing an unknown
 * flag fails the open, so the help text is the authority — `--width` exists
 * in the schema but 0.8.2's CLI does not list it, and `--max-width` does not
 * exist there at all.
 */
export function openWidthFlags(help: string, cols: number): string[] {
  const flags: string[] = []
  if (/(?:^|\s)--width(?:\s|=|$)/m.test(help)) flags.push("--width", String(cols))
  if (/(?:^|\s)--max-width(?:\s|=|$)/m.test(help)) flags.push("--max-width", String(cols))
  return flags
}

/**
 * Shrink this pane if it has grown past the target. A no-op when there is no
 * pane id, when the PTY is already at or under the cap, or when herdr has
 * nothing to say. Failures are swallowed: a missed shrink is a wide panel,
 * not a crash.
 */
export async function enforceMaxWidth(
  columns: number | undefined = process.stdout.columns,
): Promise<void> {
  const paneId = selfPaneId()
  const target = targetCols()
  if (!paneId || (columns ?? 0) <= target + 1) return
  const { stdout } = await run(herdrBin(), ["pane", "layout", "--pane", paneId], {
    cwd: SAFE_CWD,
    maxBuffer: 1 << 20,
  }).catch(() => ({ stdout: "" }))
  const layout = layoutFromResponse(stdout)
  const amount = layout ? shrinkAmount(layout, paneId, target) : null
  if (amount == null) return
  await run(
    herdrBin(),
    ["pane", "resize", "--pane", paneId, "--direction", "right", "--amount", amount.toFixed(4)],
    { cwd: SAFE_CWD },
  ).catch(() => {})
}
