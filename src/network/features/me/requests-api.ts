/**
 * Queries and actions behind the mentee's request screens, over
 * `/api/requests`, `/api/mentors/:id/availability`, `/api/me/mentorship`,
 * `/api/me/suggested-mentors` and `/api/me/saved`. Every key carries the
 * viewer's id, so answers never cross accounts. After any request action
 * the request lists, the mentorship counts, the availability answers and
 * the suggestions are re-read, since each can change with it.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CreateRequestInput } from "@shared/schemas/request";
import type { RequestStatus } from "@shared/types/common";
import type {
  MentorAvailability,
  MyMentorship,
  RequestDetail,
  RequestRole,
  RequestsResponse,
  SuggestedMentorsResponse,
} from "@shared/types/requests";
import type { SavedResponse } from "@shared/types/saved";
import type { SaveResponse } from "@shared/types/directory";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";

/** Open requests hold a pair; closed ones are history. */
export const OPEN_STATUSES: RequestStatus[] = ["pending", "accepted"];
export const CLOSED_STATUSES: RequestStatus[] = ["declined", "completed", "canceled", "expired"];

export const REQUESTS_PAGE_SIZE = 20;
export const SAVED_PAGE_SIZE = 24;

export const requestKeys = {
  all: ["requests"] as const,
  list: (viewer: string, role: RequestRole, statuses: RequestStatus[], page: number, size: number) =>
    ["requests", "list", viewer, role, statuses.join(","), page, size] as const,
  detail: (viewer: string, id: string) => ["requests", "detail", viewer, id] as const,
  availability: (viewer: string, id: string) => ["mentors", "availability", viewer, id] as const,
  mentorship: ["me", "mentorship"] as const,
  suggested: (viewer: string, topic: string | null) => ["me", "suggested-mentors", viewer, topic ?? ""] as const,
  saved: (viewer: string, page: number) => ["me", "saved", viewer, page] as const,
};

function useViewer(): { viewer: string; signedIn: boolean } {
  const { user } = useSession();
  return { viewer: user?.id ?? "anon", signedIn: user !== null };
}

function listPath(role: RequestRole, statuses: RequestStatus[], page: number, size: number): string {
  const search = new URLSearchParams({ role, page: String(page), size: String(size) });
  if (statuses.length > 0) search.set("status", statuses.join(","));
  return `/requests?${search.toString()}`;
}

/** `GET /api/requests?role&status&page&size`. */
export function useRequestList(
  role: RequestRole,
  statuses: RequestStatus[],
  page = 1,
  size = REQUESTS_PAGE_SIZE,
  enabled = true,
) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: requestKeys.list(viewer, role, statuses, page, size),
    queryFn: ({ signal }) => api<RequestsResponse>(listPath(role, statuses, page, size), { signal }),
    enabled: signedIn && enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * The caller's open requests as a mentee (at most the pending cap plus the
 * accepted ones, so one page of 50 holds them), to tell whether a profile
 * already has a request from them.
 */
export function useOpenMenteeRequests() {
  return useRequestList("mentee", OPEN_STATUSES, 1, 50);
}

/** `GET /api/requests/:id`; a 404 (not a party, or no such request) arrives as the error. */
export function useRequest(id: string) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: requestKeys.detail(viewer, id),
    queryFn: ({ signal }) => api<RequestDetail>(`/requests/${encodeURIComponent(id)}`, { signal }),
    enabled: signedIn && id !== "",
  });
}

/** `GET /api/mentors/:id/availability`. */
export function useAvailability(mentorId: string) {
  const { viewer } = useViewer();
  return useQuery({
    queryKey: requestKeys.availability(viewer, mentorId),
    queryFn: ({ signal }) => api<MentorAvailability>(`/mentors/${encodeURIComponent(mentorId)}/availability`, { signal }),
    enabled: mentorId !== "",
  });
}

/** `GET /api/me/mentorship`: the caller's pending counts (and, for mentors, capacity). */
export function useMyMentorship() {
  const { signedIn } = useViewer();
  return useQuery({
    queryKey: requestKeys.mentorship,
    queryFn: ({ signal }) => api<MyMentorship>("/me/mentorship", { signal }),
    enabled: signedIn,
  });
}

/** `GET /api/me/suggested-mentors?topic=`: up to three mentors taking requests. */
export function useSuggestedMentors(topic: string | null, enabled: boolean) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: requestKeys.suggested(viewer, topic),
    queryFn: ({ signal }) =>
      api<SuggestedMentorsResponse>(`/me/suggested-mentors${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`, {
        signal,
      }),
    enabled: signedIn && enabled,
  });
}

/** `GET /api/me/saved?page&size`. */
export function useSavedProfiles(page: number) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: requestKeys.saved(viewer, page),
    queryFn: ({ signal }) =>
      api<SavedResponse>(`/me/saved?page=${page}&size=${SAVED_PAGE_SIZE}`, { signal }),
    enabled: signedIn,
    placeholderData: keepPreviousData,
  });
}

/** Everything a request action can change. */
function refreshAfterAction(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: requestKeys.all }),
    client.invalidateQueries({ queryKey: requestKeys.mentorship }),
    client.invalidateQueries({ queryKey: ["mentors"] }),
    client.invalidateQueries({ queryKey: ["me", "suggested-mentors"] }),
    client.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
}

/** `POST /api/requests`. The answer is the new request's detail. */
export function useCreateRequest() {
  const client = useQueryClient();
  const { viewer } = useViewer();
  return useMutation({
    mutationFn: (input: CreateRequestInput) =>
      api<RequestDetail>("/requests", { method: "POST", body: input as unknown as Record<string, unknown> }),
    onSuccess: (detail) => {
      client.setQueryData(requestKeys.detail(viewer, detail.id), detail);
    },
    onSettled: () => refreshAfterAction(client),
  });
}

/** `POST /api/requests/:id/cancel` or `/complete`. The answer is the request as it now stands. */
export function useRequestAction(id: string, action: "cancel" | "complete") {
  const client = useQueryClient();
  const { viewer } = useViewer();
  return useMutation({
    mutationFn: () => api<RequestDetail>(`/requests/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
    onSuccess: (detail) => {
      client.setQueryData(requestKeys.detail(viewer, id), detail);
    },
    onSettled: () => refreshAfterAction(client),
  });
}

/** Removes a profile from the saved list (the Saved page's bookmark). */
export function useUnsave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<SaveResponse>(`/profiles/${encodeURIComponent(id)}/save`, { method: "DELETE" }),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["me", "saved"] }),
        client.invalidateQueries({ queryKey: ["directory"] }),
      ]),
  });
}
