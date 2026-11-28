/**
 * The member's own profile photo, over `/api/me/photo` (Task 33). Every
 * change re-reads anything that renders a profile, so the directory card
 * and the profile page drop or pick up the photo straight away.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OwnPhotoResponse } from "@shared/types/photos";
import { api, isApiError } from "../../lib/api";

export const photoKeys = { own: ["me", "photo"] as const };

export function useOwnPhoto() {
  return useQuery({ queryKey: photoKeys.own, queryFn: () => api<OwnPhotoResponse>("/me/photo") });
}

function useRefresh() {
  const client = useQueryClient();
  return async (data: OwnPhotoResponse) => {
    client.setQueryData(photoKeys.own, data);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["me", "preview"] }),
      client.invalidateQueries({ queryKey: ["directory"] }),
      client.invalidateQueries({ queryKey: ["profiles"] }),
    ]);
  };
}

/** `POST /api/me/photo` with the already resized JPEG. */
export function useUploadPhoto() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (photo: Blob) => {
      const form = new FormData();
      form.append("photo", photo, "photo.jpg");
      return api<OwnPhotoResponse>("/me/photo", { method: "POST", body: form });
    },
    onSuccess: refresh,
  });
}

/** `DELETE /api/me/photo`. */
export function useRemovePhoto() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api<OwnPhotoResponse>("/me/photo", { method: "DELETE" }),
    onSuccess: refresh,
  });
}

/** Plain-language text for a refused upload or removal. */
export function photoErrorText(error: unknown): string {
  if (isApiError(error, "too_large")) return "That photo is still too large after resizing. Try a different one.";
  if (isApiError(error, "unsupported_media_type")) return "That file is not a photo we can use. Choose a JPEG, PNG or WebP image.";
  if (isApiError(error, "not_member")) return "Confirm your email address before adding a photo.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and nothing was changed. Try again in a few minutes.";
}
