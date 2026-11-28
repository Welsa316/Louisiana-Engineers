/**
 * Queries and actions for the administration screens, over `/api/admin/*`.
 * Every action invalidates the admin answers (and the directory, which an
 * approval or a hide changes), so each screen re-reads what moved.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminConfig,
  AdminDashboard,
  AdminMember,
  AdminMemberFilters,
  AdminReviewDetail,
  AdminReviewItem,
  AdminReviewStatus,
  AdminRole,
  AdminTag,
  AdminVocabularyLists,
} from "@shared/types/admin";
import type { Paged, TagStatus } from "@shared/types/common";
import { api, isApiError, type ApiInit } from "../../lib/api";
import { queryKeys } from "../../lib/query";

export const ADMIN_PAGE_SIZE = 20;

export const adminKeys = {
  all: ["admin"] as const,
  dashboard: ["admin", "dashboard"] as const,
  reviews: (status: AdminReviewStatus, page: number) => ["admin", "reviews", status, page] as const,
  review: (id: string) => ["admin", "review", id] as const,
  members: (filters: AdminMemberFilters, page: number) => ["admin", "members", filters, page] as const,
  admins: ["admin", "admins"] as const,
  tags: (status: TagStatus, page: number, q = "") => ["admin", "tags", status, page, q] as const,
  vocabulary: ["admin", "vocabulary"] as const,
  config: ["admin", "config"] as const,
};

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
};

export function useAdminDashboard() {
  return useQuery({ queryKey: adminKeys.dashboard, queryFn: () => api<AdminDashboard>("/admin/dashboard") });
}

export function useReviews(status: AdminReviewStatus, page = 1, size = ADMIN_PAGE_SIZE) {
  return useQuery({
    queryKey: [...adminKeys.reviews(status, page), size],
    queryFn: () => api<Paged<AdminReviewItem>>(`/admin/reviews?${qs({ status, page, size })}`),
    placeholderData: keepPreviousData,
  });
}

export function useReview(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.review(id ?? ""),
    queryFn: () => api<AdminReviewDetail>(`/admin/reviews/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
  });
}

export function useMembers(filters: AdminMemberFilters, page: number) {
  return useQuery({
    queryKey: adminKeys.members(filters, page),
    queryFn: () => api<Paged<AdminMember>>(`/admin/members?${qs({ ...filters, page, size: ADMIN_PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdmins() {
  return useQuery({ queryKey: adminKeys.admins, queryFn: () => api<Paged<AdminRole>>("/admin/admins?size=50") });
}

/** Tags in one status, paged; `q` narrows to labels containing it (the merge picker's search). */
export function useTags(status: TagStatus, page: number, size = ADMIN_PAGE_SIZE, q = "", enabled = true) {
  const search = q.trim();
  return useQuery({
    queryKey: [...adminKeys.tags(status, page, search), size],
    queryFn: () => api<Paged<AdminTag>>(`/admin/tags?${qs({ status, page, size, q: search })}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useVocabulary() {
  return useQuery({ queryKey: adminKeys.vocabulary, queryFn: () => api<AdminVocabularyLists>("/admin/vocabulary") });
}

export function useAdminConfig() {
  return useQuery({ queryKey: adminKeys.config, queryFn: () => api<AdminConfig>("/admin/config") });
}

/**
 * One administrator action: `method` to `path` with an optional body, then
 * every admin answer, the directory's and the session (an administrator
 * may have revoked their own role) are read again.
 */
export function useAdminAction<TVars = void, TResult = unknown>(
  request: (vars: TVars) => { path: string; method: "POST" | "PATCH" | "DELETE"; body?: ApiInit["body"] },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { path, method, body } = request(vars);
      return api<TResult>(path, { method, body });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.all }),
        client.invalidateQueries({ queryKey: ["directory"] }),
        // A renamed or retired topic changes what every picker offers.
        client.invalidateQueries({ queryKey: queryKeys.vocabulary }),
        client.invalidateQueries({ queryKey: queryKeys.session }),
      ]);
    },
  });
}

/** Plain-language text for a refused admin action or a failed read. */
export function adminErrorText(error: unknown): string {
  if (isApiError(error, "admin_minimum")) {
    return "At least two administrators must stay. Grant the role to someone else before removing this one.";
  }
  if (isApiError(error, "review_closed")) return "This submission was already decided, possibly by another administrator.";
  if (isApiError(error, "profile_incomplete")) {
    return "This profile has no work details or bio yet, so it cannot be listed. Decline it with a note instead.";
  }
  if (isApiError(error, "duplicate")) return "That id is already in use. Choose another.";
  if (isApiError(error, "invalid_config")) {
    return "That value is outside what the platform allows. Reminder days must come before the request expires.";
  }
  if (isApiError(error, "invalid_vocabulary")) return "Use a short lowercase id with hyphens and a label of 2 to 80 characters.";
  if (isApiError(error, "invalid_merge")) {
    return "Merge into a different, approved tag that has not itself been merged. Approve the tag you want to keep first.";
  }
  if (isApiError(error, "tag_merged")) return "That tag was merged into another one, so it can no longer change.";
  if (isApiError(error, "not_found")) return "That record no longer exists. It may have been removed.";
  if (isApiError(error, "not_admin")) return "Your administrator role has been removed.";
  if (isApiError(error, "validation")) {
    return error.issues[0]?.message ?? "Check the highlighted fields and try again.";
  }
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and nothing was changed. Try again in a few minutes.";
}

/** "Layla Haddad, PE", or a fallback for a profile that never finished onboarding. */
export function personName(p: { firstName: string | null; lastName: string | null; credentials?: string | null }): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (!name) return "Unnamed member";
  return p.credentials ? `${name}, ${p.credentials}` : name;
}

export function personInitials(p: { firstName: string | null; lastName: string | null }): string {
  return `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

/** Whole days since `iso`, at least zero. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}
