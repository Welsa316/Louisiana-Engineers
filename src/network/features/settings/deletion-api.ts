/**
 * Account deletion over `/api/me/deletion` (Task 26): the open deletion (for
 * the grace screen's date), asking for one, and keeping the account. Each
 * change re-reads the session, whose `hasDeletionScheduled` decides whether
 * the app or the grace screen shows, and forgets every other cached answer.
 */

import { hashKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeletionResponse } from "@shared/types/account";
import { api, isApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query";

export const deletionKey = ["me", "deletion"] as const;

export function useDeletion(enabled = true) {
  return useQuery({
    queryKey: deletionKey,
    queryFn: () => api<DeletionResponse>("/me/deletion"),
    enabled,
    staleTime: 0,
  });
}

function useAfterChange() {
  const client = useQueryClient();
  return async (answer: DeletionResponse) => {
    client.setQueryData(deletionKey, answer);
    // Every other answer was read under the old state (a hidden profile, closed
    // requests); drop them, then re-read who is signed in.
    const keep = new Set([hashKey(queryKeys.session), hashKey(deletionKey)]);
    client.removeQueries({ predicate: (query) => !keep.has(query.queryHash) });
    await client.invalidateQueries({ queryKey: queryKeys.session });
  };
}

/** `POST /api/me/deletion { confirmName }`. */
export function useRequestDeletion() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: (confirmName: string) =>
      api<DeletionResponse>("/me/deletion", { method: "POST", body: { confirmName } }),
    onSuccess: after,
  });
}

/** `DELETE /api/me/deletion`: keep the account. */
export function useKeepAccount() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: () => api<DeletionResponse>("/me/deletion", { method: "DELETE" }),
    onSuccess: after,
  });
}

/** Plain words for every refusal the deletion endpoints give. */
export function deletionErrorText(error: unknown): string {
  if (isApiError(error, "confirm_mismatch")) return "That is not the first name on your profile. Type it exactly as it appears there.";
  if (isApiError(error, "deletion_scheduled")) return "Your account is already scheduled for deletion.";
  if (isApiError(error, "admin_minimum")) {
    return "MEST Network needs at least two administrators. Ask another member to take on the role before you delete your account.";
  }
  if (isApiError(error, "last_global_admin")) {
    return "MEST Network needs at least one administrator for every region. Ask another administrator to take on every region before you delete your account.";
  }
  if (isApiError(error, "no_deletion")) return "Your account is not scheduled for deletion, so there is nothing to keep.";
  if (isApiError(error, "removed_by_admin")) {
    return "An administrator removed this account, so it cannot be kept from here. Write to the MEST team if you think this is a mistake.";
  }
  if (isApiError(error, "validation")) return "Type your first name to confirm.";
  if (isApiError(error, "unauthenticated")) return "Your session has ended. Sign in again to continue.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and nothing was changed. Try again in a few minutes.";
}

/** "Thursday, December 11, 2026" for a YYYY-MM-DD day, read as that calendar day wherever the reader is. */
export function formatDeletionDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
