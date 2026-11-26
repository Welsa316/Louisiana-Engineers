/**
 * Queries and actions behind the directory and profile pages, over
 * `/api/directory` and `/api/profiles/:id`. Every key starts with
 * `directory` (the administration area invalidates that prefix after an
 * approval or a hide) and carries the viewer's id, because the same query
 * answers differently for a visitor and for a member.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DirectoryResponse,
  ProfileContactResponse,
  ProfileView,
  SaveResponse,
} from "@shared/types/directory";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";

export const directoryKeys = {
  all: ["directory"] as const,
  list: (viewer: string, query: string) => ["directory", "list", viewer, query] as const,
  profile: (viewer: string, id: string) => ["directory", "profile", viewer, id] as const,
  contact: (viewer: string, id: string) => ["directory", "contact", viewer, id] as const,
};

/** The session's user id, or `anon`; part of every key so answers never cross accounts. */
function useViewerKey(): { viewer: string; ready: boolean } {
  const { user, status } = useSession();
  return { viewer: user?.id ?? "anon", ready: status !== "loading" };
}

/** `GET /api/directory?<query>`; the previous page stays on screen while the next loads. */
export function useDirectorySearch(query: string) {
  const { viewer, ready } = useViewerKey();
  return useQuery({
    queryKey: directoryKeys.list(viewer, query),
    queryFn: ({ signal }) => api<DirectoryResponse>(`/directory${query ? `?${query}` : ""}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: ready,
  });
}

/** `GET /api/profiles/:id`; a 403 `members_only` or a 404 arrives as the query's error. */
export function useProfile(id: string) {
  const { viewer, ready } = useViewerKey();
  return useQuery({
    queryKey: directoryKeys.profile(viewer, id),
    queryFn: ({ signal }) => api<ProfileView>(`/profiles/${encodeURIComponent(id)}`, { signal }),
    enabled: ready && id !== "",
  });
}

/**
 * `GET /api/profiles/:id/contact`, for signed-in members only: it is never
 * sent for a visitor (the server would answer 401).
 */
export function useProfileContact(id: string, enabled: boolean) {
  const { viewer } = useViewerKey();
  return useQuery({
    queryKey: directoryKeys.contact(viewer, id),
    queryFn: ({ signal }) => api<ProfileContactResponse>(`/profiles/${encodeURIComponent(id)}/contact`, { signal }),
    enabled: enabled && viewer !== "anon",
  });
}

/**
 * Saves or unsaves a profile. The profile's `saved` flag flips at once and
 * is put back if the server refuses.
 */
export function useSaveProfile(id: string) {
  const client = useQueryClient();
  const { viewer } = useViewerKey();
  const key = directoryKeys.profile(viewer, id);
  return useMutation({
    mutationFn: (save: boolean) =>
      api<SaveResponse>(`/profiles/${encodeURIComponent(id)}/save`, { method: save ? "POST" : "DELETE" }),
    onMutate: async (save: boolean) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ProfileView>(key);
      if (previous) client.setQueryData<ProfileView>(key, { ...previous, saved: save });
      return { previous };
    },
    onError: (_error, _save, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: (answer) => {
      const current = client.getQueryData<ProfileView>(key);
      if (current) client.setQueryData<ProfileView>(key, { ...current, saved: answer.saved });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["me", "saved"] }),
  });
}
