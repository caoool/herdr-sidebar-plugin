import { tailLines } from "../../../tail.js"

/** Matches ccstatusline's default so the sidebar and the status line agree. */
export const WINDOW_SECONDS = 120

/** Enough tail to cover the window on any realistic session without reading the whole file. */
const TAIL_BYTES = 1024 * 1024

export type Interval = { startMs: number; endMs: number }
export type Request = { outputTokens: number; assistantMs: number | null; interval: Interval | null }

/**
 * Overlapping intervals are counted once.
 *
 * A single response can appear as several transcript entries — streaming updates and a
 * tool_use block share one message's usage — and summing their durations naively would inflate
 * the denominator. Merging first means concurrent or repeated records contribute the wall time
 * they actually occupied.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs)
  const merged: Interval[] = []
  for (const next of sorted) {
    const last = merged[merged.length - 1]
    if (last && next.startMs <= last.endMs) last.endMs = Math.max(last.endMs, next.endMs)
    else merged.push({ ...next })
  }
  return merged
}

/**
 * Pair each assistant message with the user or tool-result entry that prompted it.
 *
 * The gap between them is the time that response took. Idle time between turns falls outside
 * every interval and so never enters the denominator — which is the whole point: a rate that
 * counts thinking-about-what-to-type-next as generation time is not a generation rate.
 *
 * Sidechain entries are subagent traffic, and error entries never produced tokens; both would
 * distort the figure.
 */
export function collectRequests(lines: string[]): { requests: Request[]; latestMs: number | null } {
  const requests: Request[] = []
  let lastUserMs: number | null = null
  let latestMs: number | null = null

  for (const line of lines) {
    if (!line.startsWith("{")) continue
    let d: any
    try { d = JSON.parse(line) } catch { continue }
    if (d.isApiErrorMessage || d.isSidechain === true) continue

    const ts = Date.parse(d.timestamp ?? "")
    const at = Number.isFinite(ts) ? ts : null
    if (at !== null && (latestMs === null || at > latestMs)) latestMs = at

    if (d.type === "user" && at !== null) { lastUserMs = at; continue }

    const usage = d.type === "assistant" ? d.message?.usage : null
    if (!usage) continue
    requests.push({
      outputTokens: usage.output_tokens || 0,
      assistantMs: at,
      interval: at !== null && lastUserMs !== null && at > lastUserMs ? { startMs: lastUserMs, endMs: at } : null,
    })
  }
  return { requests, latestMs }
}

/**
 * Output tokens per second over the recent window.
 *
 * The window ends at the transcript's latest entry rather than at the wall clock, so an idle
 * session keeps reporting the rate of the work it last did instead of decaying toward zero as
 * time passes.
 */
export function speedFrom(
  requests: Request[],
  latestMs: number | null,
  windowSeconds = WINDOW_SECONDS,
): number | null {
  if (latestMs === null) return null
  const endMs = latestMs
  const startMs = endMs - windowSeconds * 1000

  let outputTokens = 0
  const intervals: Interval[] = []
  for (const r of requests) {
    if (r.assistantMs === null || r.assistantMs < startMs || r.assistantMs > endMs) continue
    outputTokens += r.outputTokens
    if (!r.interval) continue
    const clipped = {
      startMs: Math.max(r.interval.startMs, startMs),
      endMs: Math.min(r.interval.endMs, endMs),
    }
    if (clipped.endMs > clipped.startMs) intervals.push(clipped)
  }

  const durationMs = mergeIntervals(intervals).reduce((sum, i) => sum + (i.endMs - i.startMs), 0)
  if (durationMs === 0 || outputTokens === 0) return null
  return outputTokens / (durationMs / 1000)
}

/**
 * Read the rate from a session's transcript.
 *
 * Only the tail is read. Transcripts reach tens of megabytes and this runs every few seconds,
 * so reading the whole file — as the status line can afford to, running once per render — would
 * make the sidebar's cost scale with session length. A window that genuinely predates the tail
 * is under-counted rather than wrong, and only on sessions producing a megabyte of transcript
 * inside two minutes.
 */
export async function outputSpeed(transcriptPath: string): Promise<number | null> {
  const lines = await tailLines(transcriptPath, TAIL_BYTES)
  if (!lines.length) return null
  const { requests, latestMs } = collectRequests(lines)
  return speedFrom(requests, latestMs)
}
