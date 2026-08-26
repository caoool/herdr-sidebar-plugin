import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { stateDir } from "./herdr.js"

/**
 * Disk-backed memo for readings that cost something to obtain.
 *
 * Two agents cannot be read for free — Grok needs an HTTPS request, Codex needs a subprocess
 * when its rollout has gone stale — and every sidebar pane would otherwise pay separately.
 * Caching in the plugin state directory makes the cost per machine rather than per pane, and
 * leaves a warm value behind for the next pane that starts.
 *
 * Only successes are stored, so a failed request retries on the next refresh instead of
 * pinning an error for the whole interval.
 */
export async function cached<T>(
  name: string,
  maxAgeMs: number,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  const path = join(stateDir(), name)

  const info = await stat(path).catch(() => null)
  if (info && Date.now() - info.mtimeMs < maxAgeMs) {
    const text = await readFile(path, "utf8").catch(() => null)
    if (text) {
      try { return JSON.parse(text) as T } catch { /* corrupt: fall through and refetch */ }
    }
  }

  const fresh = await fetcher().catch(() => null)
  if (fresh === null || fresh === undefined) return null

  // Written through a temporary name so a concurrent reader never sees a partial file.
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(fresh)).catch(() => {})
  await rename(tmp, path).catch(() => {})
  return fresh
}
