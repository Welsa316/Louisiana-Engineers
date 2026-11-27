/**
 * Response shapes of the sign-in and public configuration endpoints
 * (`/api/auth/*`, `/api/config/public`).
 */

import type { ApprovalState, MentorStatus, ProfileKind } from "./common";

/** The signed-in account as the app sees it. Never carries the email address. */
export interface SessionUser {
  id: string;
  /** null until onboarding is completed */
  kind: ProfileKind | null;
  approvalState: ApprovalState;
  isAdmin: boolean;
  /** null until the mentorship settings table exists (Task 11) */
  mentorStatus: MentorStatus | null;
  hasDeletionScheduled: boolean;
}

/** `GET /api/auth/me` */
export interface MeResponse {
  user: SessionUser | null;
}

/** `GET /api/config/public` */
export interface PublicConfig {
  googleEnabled: boolean;
  platformPaused: boolean;
}

/** `POST /api/auth/dev-login` (test mode only) */
export interface DevLoginResponse {
  userId: string;
  redirect: SignInRedirect;
}

/** `GET /api/auth/dev-last-link?email=` (test mode only) */
export interface DevLastLinkResponse {
  link: string;
}

/** Where a successful sign-in lands. */
export type SignInRedirect = "/network/onboarding" | "/network/scheduled-for-deletion" | "/network/me";

/** Where a failed magic-link sign-in lands. */
export const SIGN_IN_FAILED_PATH = "/network/signin?error=link";

/** Where a failed or canceled Google sign-in lands. */
export const GOOGLE_SIGN_IN_FAILED_PATH = "/network/signin?error=google";
