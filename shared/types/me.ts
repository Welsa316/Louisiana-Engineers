/**
 * Response shapes of the owner's own endpoints (`/api/me/*`, Task 12). The
 * owner reads everything about their profile in any approval state, their
 * contact preferences and the mentorship cap included. Nothing here carries
 * the account email; the one exception is a preview's `contact`, which is
 * exactly what a member would be handed and may resolve `email` to the
 * owner's own sign-in address.
 */

import type { ApprovalState, ProfileKind, Visibility } from "./common";
import type {
  ContactPreferences,
  ContactValue,
  Education,
  ExpertiseTag,
  NotificationPreferences,
  OwnMentorshipSettings,
  ProfessionalDetails,
  ProfileAccess,
  ProfileReviewSummary,
  StudentDetails,
} from "./profiles";
import type { ProfileView } from "./directory";

/** `GET /api/me/settings`, and the `settings` part of the own profile. */
export interface OwnSettings {
  visibility: Visibility;
  /** null for students and before onboarding */
  mentorship: (OwnMentorshipSettings & { topics: string[] }) | null;
  /** null for students and before onboarding */
  contact: ContactPreferences | null;
  /** null before onboarding */
  notifications: NotificationPreferences | null;
}

/** `GET /api/me/profile`: the owner's profile in any state. */
export interface OwnProfile {
  id: string;
  /** null until onboarding */
  kind: ProfileKind | null;
  approvalState: ApprovalState;
  visibility: Visibility;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  /** The owner's own link, read through `my_profile_private()`. */
  linkedinUrl: string | null;
  websiteUrl: string | null;
  missionAcceptedAt: string | null;
  /** An administrator hid the profile; only an administrator can restore it. */
  adminHidden: boolean;
  lastActiveAt: string | null;
  professional: (ProfessionalDetails & { expertise: ExpertiseTag[] }) | null;
  student: StudentDetails | null;
  education: Education[];
  /** The latest review, with the decision and notes once decided. */
  review: ProfileReviewSummary | null;
  settings: OwnSettings;
}

/** What a viewer would see of the owner's profile: the `GET /api/profiles/:id` view without owner-only fields. */
export type PreviewProfile = Omit<ProfileView, "approvalState">;

/** `GET /api/me/preview?as=visitor|member` (PRO-13). */
export interface PreviewResponse {
  as: "visitor" | "member";
  access: ProfileAccess;
  /** Only when `access` is `visible`. */
  profile?: PreviewProfile;
  /** Only for `as=member` with `access` visible: the methods shared with members. */
  contact?: ContactValue[];
}

/** `POST /api/me/touch` */
export interface TouchResponse {
  touched: boolean;
}
