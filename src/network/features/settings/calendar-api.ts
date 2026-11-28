/**
 * The member's calendar feed, over `/api/me/calendar` (Task 37). The address
 * comes back once, in the answer to `POST`; the cache keeps only whether the
 * feed is on, so the address never outlives the screen that asked for it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalendarFeedResponse, CreatedCalendarFeedResponse } from "@shared/types/calendar";
import { api, isApiError } from "../../lib/api";

export const calendarKeys = { feed: ["me", "calendar"] as const };

export function useCalendarFeed() {
  return useQuery({ queryKey: calendarKeys.feed, queryFn: () => api<CalendarFeedResponse>("/me/calendar") });
}

/** `POST /api/me/calendar`: turns the feed on, or replaces its address. */
export function useCreateCalendarFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<CreatedCalendarFeedResponse>("/me/calendar", { method: "POST" }),
    onSuccess: (data) => client.setQueryData<CalendarFeedResponse>(calendarKeys.feed, { feed: data.feed }),
  });
}

/** `DELETE /api/me/calendar`: turns the feed off. */
export function useTurnOffCalendarFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<CalendarFeedResponse>("/me/calendar", { method: "DELETE" }),
    onSuccess: (data) => client.setQueryData<CalendarFeedResponse>(calendarKeys.feed, data),
  });
}

/** Plain-language text for a refused change. */
export function calendarErrorText(error: unknown): string {
  if (isApiError(error, "not_member")) return "Confirm your email address before turning on a calendar feed.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and nothing was changed. Try again in a few minutes.";
}
