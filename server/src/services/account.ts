import { confirmsDeletion } from "@shared/schemas/account";
import type { AccountDeletion, DeletionResponse } from "@shared/types/account";
import type { Db } from "../db/tx";
import { AppError } from "../http/errors";

/**
 * Account deletion for the signed-in member (Task 26, 02 section 8). The
 * rules live in the SQL functions `request_account_deletion` and
 * `cancel_account_deletion`; this module checks the typed confirmation and
 * reads the caller's open deletion through the owner policy on
 * `account_deletions`. Runs inside `withUser`, so nothing here can reach
 * another member's rows.
 */

interface DeletionRow {
  requested_at: Date;
  execute_after: Date;
  execute_on: string;
  immediate: boolean;
}

/** The caller's open deletion, or null. */
export async function getDeletion(db: Db): Promise<DeletionResponse> {
  const row = await db.maybeOne<DeletionRow>(
    `SELECT requested_at, execute_after,
            to_char(execute_after AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS execute_on,
            immediate
       FROM account_deletions
      WHERE profile_id = app_uid() AND canceled_at IS NULL AND executed_at IS NULL`,
  );
  return { deletion: row ? toDeletion(row) : null };
}

/**
 * Schedules the caller's deletion after checking that `confirmName` is
 * their first name (or "delete" for an account with none). Refused with
 * `409 deletion_scheduled` when one is already open.
 */
export async function requestDeletion(db: Db, confirmName: string): Promise<DeletionResponse> {
  const own = await db.maybeOne<{ first_name: string | null }>("SELECT first_name FROM profiles WHERE id = app_uid()");
  if (!own) throw new AppError(401, "unauthenticated", "no profile for the session");
  if (!confirmsDeletion(confirmName, own.first_name)) {
    throw new AppError(400, "confirm_mismatch", "the typed confirmation is not the member's first name");
  }
  await db.query("SELECT request_account_deletion(false, NULL)");
  return getDeletion(db);
}

/** Keeps the account: `cancel_account_deletion()`, then the (now empty) state. */
export async function cancelDeletion(db: Db): Promise<DeletionResponse> {
  await db.query("SELECT cancel_account_deletion()");
  return getDeletion(db);
}

function toDeletion(row: DeletionRow): AccountDeletion {
  return {
    requestedAt: row.requested_at.toISOString(),
    executeAfter: row.execute_after.toISOString(),
    executeOn: row.execute_on,
    immediate: row.immediate,
  };
}
