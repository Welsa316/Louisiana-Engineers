import type { PageQuery } from "@shared/types/common";
import type { SavedResponse } from "@shared/types/saved";
import type { Db } from "../db/tx";
import { ENTRY_COLUMNS, toEntry, type EntryRow } from "./directory";

/**
 * The caller's saved profiles (Task 22). `saved_profiles` is readable by
 * the saver only, and `directory_entries` keeps its own listing rule and
 * row policies, so a save of a profile that has since been hidden or
 * declined simply drops out of the list (the row stays, and the profile
 * comes back if it is listed again).
 */
export async function listSaved(db: Db, { page, size }: PageQuery): Promise<SavedResponse> {
  const rows = await db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM saved_profiles s
       JOIN directory_entries e ON e.id = s.saved_id
      WHERE s.saver_id = app_uid()
      ORDER BY s.created_at DESC, e.id
      LIMIT $1 OFFSET $2`,
    [size, (page - 1) * size],
  );
  const { total } = await db.one<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM saved_profiles s
       JOIN directory_entries e ON e.id = s.saved_id
      WHERE s.saver_id = app_uid()`,
  );
  return { items: rows.map(toEntry), total };
}
