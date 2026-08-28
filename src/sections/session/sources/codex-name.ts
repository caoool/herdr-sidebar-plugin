import { join } from "node:path"
import { homedir } from "node:os"

const DB = join(homedir(), ".codex", "state_5.sqlite")

/**
 * Codex's session title, which lives only in its database.
 *
 * The rollout's session_meta carries no name, but the `threads` table has both a user-set
 * `name` and a generated `title` — the latter is what Codex shows in its own picker, and is the
 * first message on short threads. Opened read-only so a session actively writing to the
 * database is never blocked or corrupted by this.
 */
export async function codexSessionName(sessionId: string): Promise<string | null> {
  let DatabaseSync: any
  try { ({ DatabaseSync } = await import("node:sqlite")) } catch { return null }

  let db: any
  try {
    db = new DatabaseSync(DB, { readOnly: true })
    const row = db.prepare("select name, title from threads where id = ?").get(sessionId)
    const value = row?.name || row?.title
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null
  } catch {
    return null
  } finally {
    try { db?.close() } catch { /* already gone */ }
  }
}
