import { join } from "node:path"
import { homedir } from "node:os"
import { stateDir } from "../../herdr.js"
import { TERMINAL, TERMINAL_INACTIVE, type Style } from "../../ansi.js"
import type { ProviderKind } from "../../types.js"
import type { Section, SectionContext } from "../types.js"
import type { QuotaSnapshot } from "./types.js"
import { block } from "./format.js"
import { sanitize } from "./freshness.js"
import { readClaude, claudeDir } from "./sources/claude.js"
import { readCodex } from "./sources/codex.js"
import { readGrok, GROK_LOG } from "./sources/grok.js"

const ORDER: ProviderKind[] = ["claude", "codex", "grok"]

/**
 * Prefer a reading with figures over one without — but never at the cost of showing something
 * untrue.
 *
 * A source can momentarily come back empty: a log rotating, a directory read losing a race, a
 * request timing out. Replacing good figures with a blank for one refresh is worse than
 * briefly showing values a few seconds old, so the previous reading is remembered.
 *
 * Both sides are sanitized first. Without that, remembering would defeat expiry — the moment
 * a source correctly reported "this window has closed, I have nothing current", the stale
 * snapshot it had just replaced would come straight back.
 */
export function keepBest(
  previous: QuotaSnapshot | null | undefined,
  next: QuotaSnapshot | null,
  now: number,
): QuotaSnapshot | null {
  const fresh = sanitize(next, now)
  if (fresh) return fresh
  return sanitize(previous ?? null, now)
}

/**
 * Subscription quota for every agent, in every pane.
 *
 * Quota belongs to an account rather than to a session, so a Claude pane shows the Codex and
 * Grok figures too, and each source takes its newest reading across all sessions. The pane's
 * own agent affects presentation only: its block leads, so the agent you are working with
 * sits where your eye starts.
 */
export function quotaSection(): Section {
  let snapshots: Partial<Record<ProviderKind, QuotaSnapshot | null>> = {}
  let subject: SectionContext["subject"] = null

  return {
    id: "quota",

    watch: () => [
      claudeDir(),
      GROK_LOG,
      stateDir(),
      join(homedir(), ".codex", "sessions"),
    ],

    async refresh(ctx) {
      const [claude, codex, grok] = await Promise.all([
        readClaude().catch(() => null),
        readCodex().catch(() => null),
        readGrok().catch(() => null),
      ])
      const now = Date.now()
      snapshots = {
        claude: keepBest(snapshots.claude, claude, now),
        codex: keepBest(snapshots.codex, codex, now),
        grok: keepBest(snapshots.grok, grok, now),
      }
      subject = ctx.subject
    },

    render(width, style) {
      const order = subject
        ? [subject.agent, ...ORDER.filter((a) => a !== subject!.agent)]
        : ORDER
      const out: string[] = []
      for (const agent of order) {
        if (out.length) out.push("")
        // With no agent in this tab there is nothing to be secondary to, so everything reads
        // at full strength rather than the whole panel receding.
        const forAgent =
          style === TERMINAL && subject && agent !== subject.agent ? TERMINAL_INACTIVE : style
        out.push(...block(agent, snapshots[agent] ?? null, width, Date.now(), forAgent))
      }
      return out
    },
  }
}
