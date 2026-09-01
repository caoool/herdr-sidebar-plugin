import { execFile } from "node:child_process"
import { request } from "node:https"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { SAFE_CWD } from "../../../run.js"
import { stateDir } from "../../../herdr.js"
import type { QuotaSnapshot, QuotaWindow } from "../types.js"

const run = promisify(execFile)

const HOST = "api.anthropic.com"
const PATH = "/api/oauth/usage"
const TIMEOUT_MS = 8_000

/**
 * Subscription usage, read the way Claude Code's own status line tools read it.
 *
 * The statusLine payload is the only other source of `rate_limits`, and it costs a permanent row
 * of terminal: Claude renders the status line on its own line and puts the `/rc` badge there, so
 * configuring one changes the shape of the footer. This exists so the status line can be removed
 * without the sidebar losing Claude's quota.
 *
 * The credential never passes through anything that records it. It is read, used for one request
 * to Anthropic, and dropped; only the returned figures are cached. Nothing here logs it, writes
 * it, or sends it anywhere else — and this code runs in the sidebar's own process, under the same
 * account that owns the credential, exactly as ccstatusline does.
 */

/** Claude Code stores the credential per account, so the service name carries a suffix. */
const SERVICE_PREFIX = "Claude Code-credentials"
const DUMP_MAX_BUFFER = 8 * 1024 * 1024

/**
 * Candidate keychain entries, most specific first.
 *
 * The bare name is tried but is not enough: on the machine this was written against it held only
 * MCP tokens, and the account credential lived under a suffixed entry. The suffix is not
 * derivable from anything in the config, so the keychain is enumerated and every entry sharing
 * the prefix is considered.
 */
export function servicesIn(dump: string): string[] {
  const found = new Set<string>()
  const pattern = /"svce"<blob>="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(dump)) !== null) {
    if (m[1].startsWith(SERVICE_PREFIX)) found.add(m[1])
  }
  // Suffixed entries first: the bare one is the fallback, not the likely holder.
  return [...found].sort((a, b) => b.length - a.length)
}

/** The access token from a keychain payload, or null. Never returns anything else about it. */
export function tokenIn(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw)
    const oauth = parsed?.claudeAiOauth ?? parsed
    return typeof oauth?.accessToken === "string" ? oauth.accessToken : null
  } catch {
    return null
  }
}

async function accessToken(): Promise<string | null> {
  const dump = await run("security", ["dump-keychain"], {
    cwd: SAFE_CWD, timeout: 10_000, maxBuffer: DUMP_MAX_BUFFER,
  }).then((r) => r.stdout).catch(() => "")

  for (const service of [...servicesIn(dump), SERVICE_PREFIX]) {
    const raw = await run("security", ["find-generic-password", "-s", service, "-w"], {
      cwd: SAFE_CWD, timeout: 5_000, maxBuffer: 1 << 20,
    }).then((r) => r.stdout).catch(() => null)
    if (!raw) continue
    const token = tokenIn(raw)
    if (token) return token
  }
  return null
}

/** The endpoint's response, as ccstatusline's own schema describes it. */
type Bucket = { utilization?: number | null; resets_at?: string | null } | null

export type UsageResponse = {
  five_hour?: Bucket
  seven_day?: Bucket
  seven_day_sonnet?: Bucket
  seven_day_opus?: Bucket
}

const WINDOWS: Array<{ key: keyof UsageResponse; label: string; minutes: number }> = [
  { key: "five_hour", label: "5h", minutes: 300 },
  { key: "seven_day", label: "7d", minutes: 10080 },
]

/**
 * Turn the response into the windows the panel already renders.
 *
 * `resets_at` is an ISO timestamp here, where the statusLine payload gave epoch seconds — the
 * same fact in a different currency, and converting it wrongly would put every reset time a
 * lifetime out. A bucket missing its utilization is dropped rather than shown as zero, which
 * would read as "nothing used".
 */
export function toWindows(body: UsageResponse): QuotaWindow[] {
  const out: QuotaWindow[] = []
  for (const { key, label, minutes } of WINDOWS) {
    const bucket = body[key]
    const percent = typeof bucket?.utilization === "number" ? bucket.utilization : null
    if (percent === null) continue
    const resets = typeof bucket?.resets_at === "string" ? Date.parse(bucket.resets_at) : NaN
    out.push({
      id: key,
      label,
      percent,
      resetsAt: Number.isFinite(resets) ? Math.floor(resets / 1000) : null,
      windowMinutes: minutes,
      active: true,
    })
  }
  return out
}

function fetchUsage(token: string): Promise<UsageResponse | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: HOST,
        path: PATH,
        method: "GET",
        timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      },
      (res) => {
        let body = ""
        res.on("data", (chunk) => { body += chunk })
        res.on("end", () => {
          // Anything but a clean 200 is treated as no reading at all. A partial or error body
          // parsed leniently is how a wrong percentage reaches the screen.
          if (res.statusCode !== 200) return resolve(null)
          try { resolve(JSON.parse(body)) } catch { resolve(null) }
        })
      },
    )
    req.on("timeout", () => { req.destroy(); resolve(null) })
    req.on("error", () => resolve(null))
    req.end()
  })
}

/**
 * How long a reading is believed, and how long a failure is respected.
 *
 * The panel refreshes every few seconds; an account's usage does not move nearly that fast. Five
 * minutes keeps the figures current enough to act on while making the request rare. A failure is
 * remembered for a shorter period, so a transient error does not blank the panel for long, but
 * long enough that a revoked credential is not retried on every tick.
 */
const TTL_MS = 5 * 60_000
const RETRY_MS = 60_000
/** A lock older than this belonged to a pane that died mid-request. */
const LOCK_STALE_MS = 30_000

const cacheFile = () => join(stateDir(), "claude-usage.json")
const lockFile = () => join(stateDir(), "claude-usage.lock")

type Cached = { windows: QuotaWindow[]; observedAt: number; failedAt?: number }

async function readCache(): Promise<Cached | null> {
  const text = await readFile(cacheFile(), "utf8").catch(() => null)
  if (!text) return null
  try { return JSON.parse(text) as Cached } catch { return null }
}

async function writeCache(value: Cached): Promise<void> {
  await mkdir(stateDir(), { recursive: true }).catch(() => {})
  const target = cacheFile()
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value)).catch(() => {})
  await rename(tmp, target).catch(() => {})
}

/**
 * Take the right to make the request, or decline.
 *
 * Every sidebar pane runs this code. Without a claim they would each call the endpoint on the
 * same tick — the same stampede the MCP check is guarded against, and worse here because the far
 * end is a rate-limited service belonging to someone else.
 */
async function claim(now: number): Promise<boolean> {
  await mkdir(stateDir(), { recursive: true }).catch(() => {})
  const path = lockFile()
  const held = await stat(path).catch(() => null)
  if (held && now - held.mtimeMs < LOCK_STALE_MS) return false
  try {
    await writeFile(path, String(process.pid), { flag: "wx" })
    return true
  } catch {
    // Another pane created it between the check and the write, or it is stale: clear a stale one
    // and let the next tick take it, rather than racing for it now.
    if (held) await writeFile(path, String(process.pid)).catch(() => {})
    return false
  }
}

function snapshot(windows: QuotaWindow[], observedAt: number): QuotaSnapshot {
  return {
    agent: "claude",
    sessionId: null,
    plan: null,
    windows,
    credits: null,
    observedAt,
    source: "api",
  }
}

/**
 * The account's usage, or null when it cannot be established.
 *
 * Null rather than an empty reading: the panel renders a dash for null, and a dash is the honest
 * rendering of "not known right now". A cached reading past its TTL is equally not shown — an
 * expired figure is indistinguishable from a wrong one, which is the rule the rest of this panel
 * already follows.
 */
export async function readClaudeUsage(now: number = Date.now()): Promise<QuotaSnapshot | null> {
  const cached = await readCache()
  if (cached && !cached.failedAt && now - cached.observedAt < TTL_MS) {
    return snapshot(cached.windows, cached.observedAt)
  }

  const backingOff = cached?.failedAt !== undefined && now - cached.failedAt < RETRY_MS
  if (!backingOff && (await claim(now))) {
    const token = await accessToken()
    const body = token ? await fetchUsage(token) : null
    const windows = body ? toWindows(body) : []
    if (windows.length) {
      const at = Date.now()
      await writeCache({ windows, observedAt: at })
      return snapshot(windows, at)
    }
    await writeCache({
      windows: cached?.windows ?? [],
      observedAt: cached?.observedAt ?? 0,
      failedAt: Date.now(),
    })
  }

  return null
}
