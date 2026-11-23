/**
 * The signed-in account as the app knows it, read from `GET /api/auth/me`.
 * The answer never carries the email address (shared/types/auth.ts).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { MeResponse, PublicConfig, SessionUser } from "@shared/types/auth";
import { api } from "./api";
import { queryKeys } from "./query";

export type SessionStatus = "loading" | "anon" | "ready";

export interface Session {
  user: SessionUser | null;
  status: SessionStatus;
  /** Re-reads the session, for example after onboarding changes `kind`. */
  refresh: () => Promise<SessionUser | null>;
}

const fetchSession = () => api<MeResponse>("/auth/me");

export function useSession(): Session {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 60_000,
  });
  const { refetch } = query;

  const refresh = useCallback(async () => {
    const result = await refetch();
    return result.data?.user ?? null;
  }, [refetch]);

  const user = query.data?.user ?? null;
  // A failed session read (server down) is treated as signed out rather than
  // leaving every guarded page on a spinner.
  const status: SessionStatus = query.isPending ? "loading" : user ? "ready" : "anon";
  return { user, status, refresh };
}

/**
 * Signs out on the server, then forgets every cached answer so nothing the
 * previous account could read stays in memory.
 */
export function useSignOut(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    try {
      await api("/auth/signout", { method: "POST" });
    } finally {
      client.clear();
      client.setQueryData<MeResponse>(queryKeys.session, { user: null });
    }
  }, [client]);
}

/** `GET /api/config/public`: whether Google sign-in is offered and whether the platform is paused. */
export function usePublicConfig() {
  return useQuery({
    queryKey: queryKeys.publicConfig,
    queryFn: () => api<PublicConfig>("/config/public"),
    staleTime: 5 * 60_000,
  });
}
