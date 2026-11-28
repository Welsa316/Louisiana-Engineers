/**
 * Queries and saves for the settings screens, over `/api/me/*` (Task 12).
 * Every save re-reads the owner's own answers, the session (kind and
 * mentorship status drive the navigation) and anything that renders a
 * profile, so the directory and the preview never show the old values.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfilePatchInput } from "@shared/schemas/profile";
import type { SettingsPatchInput } from "@shared/schemas/settings";
import type { ProfileKind } from "@shared/types/common";
import type { OwnProfile, OwnSettings, PreviewResponse } from "@shared/types/me";
import { api, isApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query";

export const settingsKeys = {
  all: ["me"] as const,
  profile: ["me", "profile"] as const,
  settings: ["me", "settings"] as const,
  preview: (as: "visitor" | "member") => ["me", "preview", as] as const,
};

export function useOwnProfile() {
  return useQuery({ queryKey: settingsKeys.profile, queryFn: () => api<OwnProfile>("/me/profile") });
}

export function useOwnSettings() {
  return useQuery({ queryKey: settingsKeys.settings, queryFn: () => api<OwnSettings>("/me/settings") });
}

export function usePreview(as: "visitor" | "member") {
  return useQuery({
    queryKey: settingsKeys.preview(as),
    queryFn: () => api<PreviewResponse>(`/me/preview?as=${as}`),
    // The preview must show what is stored now, not a minute ago.
    staleTime: 0,
  });
}

function useRefreshAfterSave() {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: settingsKeys.all }),
      client.invalidateQueries({ queryKey: queryKeys.session }),
      client.invalidateQueries({ queryKey: ["directory"] }),
      client.invalidateQueries({ queryKey: ["profiles"] }),
    ]);
  };
}

/** `PATCH /api/me/profile`; answers the whole own profile. */
export function useSaveProfile() {
  const client = useQueryClient();
  const refresh = useRefreshAfterSave();
  return useMutation({
    mutationFn: (patch: ProfilePatchInput) => api<OwnProfile>("/me/profile", { method: "PATCH", body: patch }),
    onSuccess: async (profile) => {
      client.setQueryData(settingsKeys.profile, profile);
      await refresh();
    },
  });
}

/** `PATCH /api/me/settings`; one transaction, so a refusal changes nothing. */
export function useSaveSettings() {
  const client = useQueryClient();
  const refresh = useRefreshAfterSave();
  return useMutation({
    mutationFn: (patch: SettingsPatchInput) => api<OwnSettings>("/me/settings", { method: "PATCH", body: patch }),
    onSuccess: async (settings) => {
      client.setQueryData(settingsKeys.settings, settings);
      await refresh();
    },
  });
}

/** `POST /api/me/kind`. */
export function useSetKind() {
  const client = useQueryClient();
  const refresh = useRefreshAfterSave();
  return useMutation({
    mutationFn: (kind: ProfileKind) => api<OwnProfile>("/me/kind", { method: "POST", body: { kind } }),
    onSuccess: async (profile) => {
      client.setQueryData(settingsKeys.profile, profile);
      await refresh();
    },
  });
}

/**
 * Plain-language text for a refused save or a failed read. The codes are the
 * `mest.<code>` exceptions of migration 0004 and the service's own conflicts.
 */
export function settingsErrorText(error: unknown): string {
  if (isApiError(error, "validation")) return error.issues[0]?.message ?? "Check the highlighted fields and try again.";
  if (isApiError(error, "invalid_contact")) {
    return "Each contact method you turn on needs its detail, and you can only show members the methods you use.";
  }
  if (isApiError(error, "mentoring_not_offered")) {
    return "Mentorship is not one of the ways you take part. Turn it on under Profile, Participation, then come back.";
  }
  if (isApiError(error, "mentorship_incomplete")) return "Choose at least one topic and one audience before taking requests.";
  if (isApiError(error, "invalid_resume_date")) return "Choose a resume date after today, or leave it empty.";
  if (isApiError(error, "profile_hidden")) {
    return "An administrator has hidden your profile, so mentorship stays off until they restore it.";
  }
  if (isApiError(error, "invalid_topic")) return "One of the topics is no longer offered. Reload the page and choose again.";
  if (isApiError(error, "invalid_discipline")) return "That discipline is no longer offered. Choose another.";
  if (isApiError(error, "invalid_region")) return "That region is no longer offered. Choose another.";
  if (isApiError(error, "tag_rejected")) return "One of your expertise tags was declined by an administrator. Remove it and save again.";
  if (isApiError(error, "invalid_expertise")) return "Add between 2 and 12 areas of expertise, each 2 to 40 characters.";
  if (isApiError(error, "invalid_education")) return "Check the education entries: each needs a degree, field, school and year.";
  if (isApiError(error, "bio_required")) return "A professional profile needs a biography of at least 120 characters.";
  if (isApiError(error, "professional_details_required")) {
    return "Fill in your title, organization, discipline and years of experience together.";
  }
  if (isApiError(error, "student_details_required")) {
    return "Fill in your program, level, institution, goals and topics together.";
  }
  if (isApiError(error, "not_member")) {
    return "Your account is scheduled for deletion, so your profile cannot change. Keep your account to edit it again.";
  }
  if (isApiError(error, "unauthenticated")) return "Your session has ended. Sign in again to continue.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and nothing was changed. Try again in a few minutes.";
}
