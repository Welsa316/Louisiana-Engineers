/**
 * A thin caller of the `write_audit` SQL function. The function records the
 * acting user (`app.user_id`, null in system context) and strips private
 * keys (`email`, `phone`, `why`, `goals`, `scheduling_note`, `mentor_note`)
 * from `detail` at any depth; nothing is filtered here, so the rule lives in
 * one place.
 *
 * `db` is anything with a `query(text, values)` method: a `pg` client, or
 * the `Db` wrapper from `withUser` / `withSystem`.
 */
export interface AuditQueryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export type AuditDetail = Record<string, unknown>;

/** Writes one audit entry and returns its id (a bigint, as a string). */
export async function audit(
  db: AuditQueryable,
  action: string,
  subjectType: string | null,
  subjectId: string | null,
  detail: AuditDetail = {},
): Promise<string> {
  const result = await db.query("SELECT write_audit($1, $2, $3, $4::jsonb)::text AS id", [
    action,
    subjectType,
    subjectId,
    JSON.stringify(detail),
  ]);
  const row = firstRow(result) as { id?: string } | undefined;
  if (!row?.id) throw new Error("write_audit returned no id");
  return row.id;
}

/** Accepts both a `pg` result (`{ rows }`) and a plain row array. */
function firstRow(result: unknown): unknown {
  if (Array.isArray(result)) return result[0];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows[0] : undefined;
  }
  return undefined;
}
