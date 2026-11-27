/**
 * Queries and actions for the in-app notification list, over
 * `/api/notifications`. The unread count behind the bell and the tab badge
 * is the `unread` field of a one-item list, re-read every minute while the
 * app is open; marking anything read refreshes every notification answer.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarkAllReadResponse, MarkReadResponse, NotificationsResponse } from "@shared/types/notifications";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";

export const NOTIFICATIONS_PAGE_SIZE = 20;

/** How often the unread count is re-read while the app is open. */
const UNREAD_POLL_MS = 60_000;

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (unreadOnly: boolean, page: number, size: number) => ["notifications", "list", unreadOnly, page, size] as const,
  unread: ["notifications", "unread"] as const,
};

function listPath(unreadOnly: boolean, page: number, size: number): string {
  const search = new URLSearchParams({ page: String(page), size: String(size) });
  if (unreadOnly) search.set("unread", "1");
  return `/notifications?${search.toString()}`;
}

export function useNotifications(unreadOnly = false, page = 1, size = NOTIFICATIONS_PAGE_SIZE) {
  const { user } = useSession();
  return useQuery({
    queryKey: notificationKeys.list(unreadOnly, page, size),
    queryFn: () => api<NotificationsResponse>(listPath(unreadOnly, page, size)),
    enabled: user !== null,
    placeholderData: keepPreviousData,
  });
}

/** The signed-in account's unread count, or undefined until it is known (or when signed out). */
export function useUnreadCount(): number | undefined {
  const { user } = useSession();
  const query = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: () => api<NotificationsResponse>(listPath(true, 1, 1)),
    enabled: user !== null,
    refetchInterval: UNREAD_POLL_MS,
    staleTime: 15_000,
  });
  return user ? query.data?.unread : undefined;
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MarkReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<MarkAllReadResponse>("/notifications/read-all", { method: "POST" }),
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/**
 * A notification's link inside the router, whose basename is `/network`:
 * `/network/me` becomes `/me`. Anything outside the network app (the column
 * only holds root-relative paths) is returned as is, flagged for a plain
 * anchor.
 */
export function appPath(link: string): { to: string; inRouter: boolean } {
  const rest = link.startsWith("/network") ? link.slice("/network".length) : null;
  if (rest === null || (rest !== "" && !/^[/?#]/.test(rest))) return { to: link, inRouter: false };
  return { to: rest.startsWith("/") ? rest : `/${rest}`, inRouter: true };
}
