/**
 * Queries and actions behind the scheduling screens (Task 31), over Task
 * 30's endpoints (shared/types/meetings.ts):
 *
 *   GET  /api/relationships/:requestId/slots      proposed times
 *   POST /api/relationships/:requestId/slots      propose one to three
 *   GET  /api/relationships/:requestId/meetings   the pair's meetings
 *   POST /api/relationships/:requestId/meetings   choose a proposed time
 *   GET  /api/meetings?when=upcoming|past         the caller's log, both roles
 *   POST /api/meetings/:id/cancel | /outcome
 *
 * Every key carries the viewer's id. After any action every meetings query
 * and the notifications are re-read, since the other party's view, the log
 * and the bell all change with it.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChooseTime, ProposeTimes } from "@shared/schemas/meetings";
import type {
  Meeting,
  MeetingActionErrorCode,
  MeetingLogResponse,
  MeetingLogScope,
  MeetingsResponse,
  ProposeTimesResponse,
  SlotsResponse,
} from "@shared/types/meetings";
import { api, isApiError } from "../../lib/api";
import { useSession } from "../../lib/session";

export const MEETINGS_PAGE_SIZE = 20;
/** A relationship's own lists are short; one page of the maximum holds them. */
const RELATIONSHIP_PAGE_SIZE = 50;

export const meetingKeys = {
  all: ["meetings"] as const,
  slots: (viewer: string, requestId: string) => ["meetings", "slots", viewer, requestId] as const,
  forRelationship: (viewer: string, requestId: string) => ["meetings", "relationship", viewer, requestId] as const,
  log: (viewer: string, when: MeetingLogScope, page: number) => ["meetings", "log", viewer, when, page] as const,
};

function useViewer(): { viewer: string; signedIn: boolean } {
  const { user } = useSession();
  return { viewer: user?.id ?? "anon", signedIn: user !== null };
}

const relationshipPath = (requestId: string, what: "slots" | "meetings") =>
  `/relationships/${encodeURIComponent(requestId)}/${what}`;

/** The relationship's open proposals (both parties'). */
export function useOpenSlots(requestId: string, enabled = true) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: meetingKeys.slots(viewer, requestId),
    queryFn: ({ signal }) =>
      api<SlotsResponse>(`${relationshipPath(requestId, "slots")}?status=proposed&size=${RELATIONSHIP_PAGE_SIZE}`, { signal }),
    enabled: signedIn && enabled && requestId !== "",
  });
}

/** The relationship's meetings, newest first. */
export function useRelationshipMeetings(requestId: string, enabled = true) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: meetingKeys.forRelationship(viewer, requestId),
    queryFn: ({ signal }) =>
      api<MeetingsResponse>(`${relationshipPath(requestId, "meetings")}?size=${RELATIONSHIP_PAGE_SIZE}`, { signal }),
    enabled: signedIn && enabled && requestId !== "",
  });
}

/** `GET /api/meetings?when&page&size`: the caller's meetings in both roles. */
export function useMeetingLog(when: MeetingLogScope, page: number) {
  const { viewer, signedIn } = useViewer();
  return useQuery({
    queryKey: meetingKeys.log(viewer, when, page),
    queryFn: ({ signal }) =>
      api<MeetingLogResponse>(`/meetings?when=${when}&page=${page}&size=${MEETINGS_PAGE_SIZE}`, { signal }),
    enabled: signedIn,
    placeholderData: keepPreviousData,
  });
}

function refreshAfterAction(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: meetingKeys.all }),
    client.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
}

export function useProposeTimes(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProposeTimes) =>
      api<ProposeTimesResponse>(relationshipPath(requestId, "slots"), {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }),
    onSettled: () => refreshAfterAction(client),
  });
}

export function useChooseTime(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ChooseTime) =>
      api<Meeting>(relationshipPath(requestId, "meetings"), {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }),
    onSettled: () => refreshAfterAction(client),
  });
}

export function useCancelMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Meeting>(`/meetings/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    onSettled: () => refreshAfterAction(client),
  });
}

export function useMeetingOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, met }: { id: string; met: boolean }) =>
      api<Meeting>(`/meetings/${encodeURIComponent(id)}/outcome`, { method: "POST", body: { met } }),
    onSettled: () => refreshAfterAction(client),
  });
}

const ERROR_TEXT: Record<MeetingActionErrorCode, string> = {
  not_active: "This mentorship is closed, so new times cannot be proposed or chosen.",
  invalid_slots: "Each time must be in the future, within a year, and 15 minutes to 3 hours long.",
  slot_unavailable: "That time is no longer open. The list now shows what is.",
  slot_past: "That time has already passed. Choose another or propose new times.",
  invalid_mode: "Choose online or in person.",
  invalid_meeting: "The place or the notes are too long.",
  not_upcoming: "This meeting was already canceled or has happened.",
  meeting_started: "This meeting has already started, so it cannot be canceled. Say whether you met instead.",
  meeting_canceled: "This meeting was canceled.",
  meeting_not_started: "You can answer once the meeting has started.",
  invalid_outcome: "Choose yes or no.",
};

/** Plain copy for any failure of a scheduling action. */
export function meetingErrorText(error: unknown): string {
  if (isApiError(error, "network")) return "That did not go through. Check your connection and try again.";
  if (isApiError(error, "forbidden")) return "The other person chooses from your times.";
  if (isApiError(error, "not_found")) return "This mentorship is not available any more.";
  if (isApiError(error, "validation")) return ERROR_TEXT.invalid_slots;
  if (isApiError(error) && error.code in ERROR_TEXT) return ERROR_TEXT[error.code as MeetingActionErrorCode];
  return "That did not go through. Try again in a moment.";
}
