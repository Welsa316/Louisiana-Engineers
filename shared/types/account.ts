/**
 * Account deletion (Task 26, 02 section 8): `GET`, `POST` and
 * `DELETE /api/me/deletion`. Every answer is the caller's open deletion, or
 * null when none is open.
 */

export interface AccountDeletion {
  /** When the member (or an administrator) asked. ISO timestamp. */
  requestedAt: string;
  /** When the sweep may delete the account. ISO timestamp. */
  executeAfter: string;
  /** `executeAfter` as a calendar day in America/Chicago (YYYY-MM-DD), for "deleted on [date]". */
  executeOn: string;
  /** An administrator removed the account: no grace period, and it cannot be kept. */
  immediate: boolean;
}

export interface DeletionResponse {
  deletion: AccountDeletion | null;
}

/**
 * Refusals besides the guards' 401: `confirm_mismatch` (400, the typed
 * name is not the member's first name), and as 409 `deletion_scheduled`
 * (already asked), `no_deletion` (nothing to keep) and `removed_by_admin`
 * (an administrator's removal cannot be undone from the grace screen).
 */
export type DeletionErrorCode = "confirm_mismatch" | "deletion_scheduled" | "no_deletion" | "removed_by_admin";
