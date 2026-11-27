import { eachRow } from "./each-row";
import type { Job } from "./scheduler";

export interface DeletionsResult {
  deleted: number;
  errored: number;
}

/**
 * Daily: every open account deletion past its `execute_after` goes to
 * `execute_account_deletion`, which turns the profile into a "Former member"
 * tombstone, deletes the member's own tables, empties their request text
 * and removes the address (02 section 8, step 4). Each account is swept in
 * its own short transaction, so one failure never undoes another; the job
 * only selects ids.
 */
export const deletionsJob: Job = {
  name: "deletions",
  everyMs: 86_400_000,
  transaction: false,
  async run(db, now): Promise<DeletionsResult> {
    const due = await db.query<{ id: string }>(
      `SELECT id FROM account_deletions
        WHERE canceled_at IS NULL AND executed_at IS NULL AND execute_after <= $1
        ORDER BY execute_after, id`,
      [now],
    );
    const totals = await eachRow(
      "deletions",
      due,
      (row) => `deletion ${row.id}`,
      async (tx, row) =>
        (await tx.one<{ moved: boolean }>("SELECT execute_account_deletion($1, $2) AS moved", [row.id, now])).moved,
    );
    return { deleted: totals.moved, errored: totals.errored };
  },
};
