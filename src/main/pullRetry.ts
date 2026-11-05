/**
 * Helpers for the /pull change feed that are worth testing on their own:
 * the failed-change store, deleting another till's order, and the rule for
 * when a full /bootstrap is due. All take the database as a parameter.
 */

export const MAX_FAILED_ATTEMPTS = 10;
export const BOOTSTRAP_EVERY_MS = 6 * 60 * 60 * 1000;
export const MAX_PULL_PAGES = 10;

export const FAILED_CHANGES_DDL = `
  CREATE TABLE IF NOT EXISTS sync_failed_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    payload    TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
`;

export type FailedChange = { id: number; change: any };

/** Changes that failed to apply earlier, oldest first. */
export function loadFailedChanges(db: any): FailedChange[] {
  const rows = db
    .prepare('SELECT id, payload FROM sync_failed_changes ORDER BY id ASC')
    .all() as Array<{ id: number; payload: string }>;
  const out: FailedChange[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, change: JSON.parse(r.payload) });
    } catch {
      db.prepare('DELETE FROM sync_failed_changes WHERE id = ?').run(r.id);
    }
  }
  return out;
}

/** A change from the feed failed: keep it for the next pull. */
export function recordFailedChange(db: any, change: any, error: string) {
  db.prepare(
    `INSERT INTO sync_failed_changes (payload, attempts, last_error, created_at)
     VALUES (?, 1, ?, ?)`
  ).run(JSON.stringify(change), error, Date.now());
}

/** A stored change was tried again. Returns 'applied' | 'kept' | 'dropped'. */
export function settleReplay(
  db: any,
  id: number,
  error: string | null
): 'applied' | 'kept' | 'dropped' {
  if (error == null) {
    db.prepare('DELETE FROM sync_failed_changes WHERE id = ?').run(id);
    return 'applied';
  }
  const attempts =
    (db
      .prepare('SELECT attempts FROM sync_failed_changes WHERE id = ?')
      .pluck()
      .get(id) as number | undefined) ?? 0;
  if (attempts + 1 >= MAX_FAILED_ATTEMPTS) {
    db.prepare('DELETE FROM sync_failed_changes WHERE id = ?').run(id);
    console.warn('[sync] giving up on a change after repeated failures', {
      id,
      error,
    });
    return 'dropped';
  }
  db.prepare(
    'UPDATE sync_failed_changes SET attempts = attempts + 1, last_error = ? WHERE id = ?'
  ).run(error, id);
  return 'kept';
}

/**
 * Remove an order the server deleted — but never this till's own sale (a UUID
 * id; the server's ids are plain integers). Returns true if a row was removed.
 * order_lines / active_orders go with it by ON DELETE CASCADE.
 */
export function removeServerOrder(db: any, pk: unknown): boolean {
  const id = pk == null ? '' : String(pk);
  if (!/^\d+$/.test(id)) return false;
  db.prepare('DELETE FROM order_lines_pending WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM order_paid_actions WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(id);
  db.prepare('DELETE FROM active_orders WHERE order_id = ?').run(id);
  return db.prepare('DELETE FROM orders WHERE id = ?').run(id).changes > 0;
}

/**
 * Is a full /bootstrap due? Yes with no cursor yet (first sync after pairing
 * or a wipe), on the first sync after app start, and then every 6 hours.
 */
export function bootstrapDue(o: {
  hasCursor: boolean;
  lastAt: number;
  now: number;
  doneThisRun: boolean;
}): boolean {
  if (!o.hasCursor) return true;
  if (!o.doneThisRun) return true;
  return !o.lastAt || o.now - o.lastAt >= BOOTSTRAP_EVERY_MS;
}
