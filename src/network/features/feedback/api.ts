/**
 * Queries and the one action behind post-completion feedback (Task 32):
 * `GET` and `POST /api/requests/:id/feedback` for the two parties, and
 * `GET /api/admin/feedback` for administrators. Keys carry the viewer's
 * id, so answers never cross accounts.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaveFeedback } from "@shared/schemas/feedback";
import type { AdminFeedbackResponse, FeedbackResponse } from "@shared/types/feedback";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";

export const FEEDBACK_PAGE_SIZE = 10;

export const feedbackKeys = {
  mine: (viewer: string, requestId: string) => ["feedback", viewer, requestId] as const,
  admin: (page: number) => ["admin", "feedback", page] as const,
};

function useViewer(): string {
  const { user } = useSession();
  return user?.id ?? "anon";
}

/** Where the caller stands on one request's feedback. */
export function useFeedback(requestId: string, enabled = true) {
  const viewer = useViewer();
  return useQuery({
    queryKey: feedbackKeys.mine(viewer, requestId),
    queryFn: ({ signal }) => api<FeedbackResponse>(`/requests/${encodeURIComponent(requestId)}/feedback`, { signal }),
    enabled: enabled && requestId !== "",
  });
}

/** The two questions, once. The invitation notification is marked read on the server. */
export function useLeaveFeedback(requestId: string) {
  const viewer = useViewer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LeaveFeedback) =>
      api<FeedbackResponse>(`/requests/${encodeURIComponent(requestId)}/feedback`, {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }),
    onSuccess: (state) => {
      client.setQueryData(feedbackKeys.mine(viewer, requestId), state);
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => {
      // Already answered elsewhere, or no longer open: show where it stands.
      void client.invalidateQueries({ queryKey: feedbackKeys.mine(viewer, requestId) });
    },
  });
}

/** Administrators: the comments, newest first, with no author. */
export function useAdminFeedback(page: number) {
  return useQuery({
    queryKey: feedbackKeys.admin(page),
    queryFn: ({ signal }) =>
      api<AdminFeedbackResponse>(`/admin/feedback?page=${page}&size=${FEEDBACK_PAGE_SIZE}`, { signal }),
    placeholderData: keepPreviousData,
  });
}
