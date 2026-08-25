import { open, stat } from "node:fs/promises"

/** Read at most this much from the end of a file. */
const TAIL_BYTES = 256 * 1024

/**
 * Read the tail of a file as lines, newest last.
 *
 * These logs are append-only and can be very large — Claude transcripts reach tens of
 * megabytes and Codex rollouts grow all session — while the reading we want is always the
 * last one written. Reading the whole file to find it would make the sidebar's cost scale
 * with session length.
 *
 * The first line of the window is dropped when the file is longer than the window, since it
 * is almost certainly a partial record.
 */
export async function tailLines(path: string, bytes = TAIL_BYTES): Promise<string[]> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return []
  const start = Math.max(0, info.size - bytes)
  const handle = await open(path, "r").catch(() => null)
  if (!handle) return []
  try {
    const buf = Buffer.alloc(Math.min(bytes, info.size))
    await handle.read(buf, 0, buf.length, start)
    const lines = buf.toString("utf8").split("\n")
    if (start > 0) lines.shift()
    return lines
  } finally {
    await handle.close().catch(() => {})
  }
}
