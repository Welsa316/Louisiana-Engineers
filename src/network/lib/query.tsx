/**
 * TanStack Query setup for the network app. Client errors (4xx) are answers,
 * not outages, so they are never retried; network and server errors retry
 * once.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "./api";

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Query keys shared across features. Features add their own beside these. */
export const queryKeys = {
  session: ["session"] as const,
  publicConfig: ["config", "public"] as const,
};

export function QueryProvider({ client, children }: { client?: QueryClient; children: ReactNode }) {
  const [fallback] = useState(createQueryClient);
  return <QueryClientProvider client={client ?? fallback}>{children}</QueryClientProvider>;
}
