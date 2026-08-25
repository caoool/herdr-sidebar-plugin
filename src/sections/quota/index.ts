import { join } from "node:path"
import { homedir } from "node:os"
import { stateDir } from "../../herdr.js"
import type { Style } from "../../ansi.js"
import type { ProviderKind } from "../../types.js"
import type { Section, SectionContext } from "../types.js"
import type { QuotaSnapshot } from "./types.js"
import { block } from "./format.js"
import { readClaude, claudeDir } from "./sources/claude.js"
import { readCodex } from "./sources/codex.js"
import { readGrok, GROK_LOG } from "./sources/grok.js"

const ORDER: ProviderKind[] = ["claude", "codex", "grok"]

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
      snapshots = { claude, codex, grok }
      subject = ctx.subject
    },

    render(width, style) {
      const order = subject
        ? [subject.agent, ...ORDER.filter((a) => a !== subject!.agent)]
        : ORDER
      const out: string[] = []
      for (const agent of order) {
        if (out.length) out.push("")
        out.push(...block(agent, snapshots[agent] ?? null, width, Date.now(), style))
      }
      return out
    },
  }
}
