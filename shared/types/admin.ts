/**
 * Response shapes of the administration area (`/api/admin/*`, 03 section 8).
 * Nothing here carries an email address or a contact value: administrators
 * see the sign-up address's domain only (through `admin_list_members`), and
 * never `contact_preferences` or the LinkedIn link.
 */

import type { ConfigKey } from "../limits";
import type { DisciplineGroup } from "../taxonomy";
import type { ApprovalState, MentorStatus, ReviewDecision, TagStatus, VerifiedMethod, Visibility } from "./common";
import type { AdminDashboardCounts, AdminMemberRow, Education } from "./profiles";

export type { AdminDashboardCounts, AdminMemberRow } from "./profiles";

/** `GET /api/admin/dashboard`: the `admin_dashboard` view (Tasks 24 and 25 add measures). */
export type AdminDashboard = AdminDashboardCounts;

/** The review queue's filter: open reviews, or decided ones by outcome. */
export const adminReviewStatuses = ["pending", "approved", "declined"] as const;
export type AdminReviewStatus = (typeof adminReviewStatuses)[number];

/** What `profile_snapshot()` stored when the profile was submitted (no contact values, no LinkedIn link). */
export interface AdminReviewSnapshot {
  kind?: "student" | "professional";
  firstName?: string;
  lastName?: string;
  credentials?: string;
  location?: string;
  region?: string;
  bio?: string;
  websiteUrl?: string;
  visibility?: Visibility;
  title?: string;
  organization?: string;
  disciplineId?: string;
  yearsExperience?: number;
  participation?: string[];
  interests?: string[];
  expertise?: string[];
  education?: Education[];
  mentorship?: {
    status: MentorStatus;
    audience: string[];
    format: string;
    mode: string;
    availability: string | null;
    durationMin: number;
    maxActive: number;
    topics: string[] | null;
  };
}

/** One row of `GET /api/admin/reviews?status=`. */
export interface AdminReviewItem {
  id: string;
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  title: string | null;
  organization: string | null;
  disciplineId: string | null;
  disciplineLabel: string | null;
  /** null while the review is open */
  decision: ReviewDecision | null;
  notes: string | null;
  submittedAt: string;
  decidedAt: string | null;
  /** The profile's current approval state (a declined member may have resubmitted). */
  approvalState: ApprovalState;
  verified: boolean;
  wantsToMentor: boolean;
  /** Earlier decided reviews of the same member. */
  previousReviews: number;
}

/** An earlier review of the same member, shown beside a new submission. */
export interface AdminReviewHistoryItem {
  id: string;
  decision: ReviewDecision | null;
  notes: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

/** `GET /api/admin/reviews/:id`: the submission as members would see it, plus what an administrator may know. */
export interface AdminReviewDetail extends AdminReviewItem {
  snapshot: AdminReviewSnapshot;
  /** The sign-up address's domain, never the address. null when it cannot be read. */
  emailDomain: string | null;
  verifiedMethod: VerifiedMethod | null;
  visibility: Visibility;
  adminHidden: boolean;
  joinedAt: string;
  history: AdminReviewHistoryItem[];
}

/** One row of `GET /api/admin/members?q=`: `admin_list_members` plus the state the actions need. */
export interface AdminMember extends AdminMemberRow {
  visibility: Visibility;
  adminHidden: boolean;
  verified: boolean;
  isAdmin: boolean;
  /** "Title · Organization" for professionals, the program for students. */
  detail: string | null;
}

/** One active administrator, from `GET /api/admin/admins`. */
export interface AdminRole {
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  grantedAt: string;
  /** null when granted by the `admin-grant` command */
  grantedByName: string | null;
  isSelf: boolean;
}

/** One row of `GET /api/admin/tags?status=`. */
export interface AdminTag {
  id: string;
  label: string;
  slug: string;
  status: TagStatus;
  proposedByName: string | null;
  createdAt: string;
  /** Profiles currently using the tag. */
  usage: number;
}

export interface AdminDiscipline {
  id: string;
  label: string;
  groupName: DisciplineGroup | null;
  active: boolean;
}

export interface AdminTopic {
  id: string;
  label: string;
  active: boolean;
}

/** `GET /api/admin/vocabulary` */
export interface AdminVocabularyLists {
  disciplines: AdminDiscipline[];
  topics: AdminTopic[];
}

/** `GET /api/admin/config` and the answer to `PATCH /api/admin/config`: the `config` table by key. */
export interface AdminConfig {
  request_expiry_days: number;
  reminder_days: number[];
  pending_cap: number;
  default_max_active: number;
  daily_request_limit: number;
  daily_report_limit: number;
  magic_links_per_hour: number;
  platform_paused: boolean;
  retention_months: number;
}

/** Every key the settings screen edits, in display order. */
export const adminConfigKeys = [
  "platform_paused",
  "request_expiry_days",
  "reminder_days",
  "pending_cap",
  "default_max_active",
  "daily_request_limit",
  "daily_report_limit",
  "magic_links_per_hour",
  "retention_months",
] as const satisfies readonly ConfigKey[];
