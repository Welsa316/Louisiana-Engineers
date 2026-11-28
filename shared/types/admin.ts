/**
 * Response shapes of the administration area (`/api/admin/*`, 03 section 8).
 * Nothing here carries an email address or a contact value: administrators
 * see the sign-up address's domain only (through `admin_list_members`), and
 * never `contact_preferences` or the LinkedIn link.
 */

import type { ConfigKey } from "../limits";
import type { DisciplineGroup } from "../taxonomy";
import type { ApprovalState, MentorStatus, ProfileKind, ReviewDecision, TagStatus, VerifiedMethod, Visibility } from "./common";
import type { AdminDashboardCounts, AdminMemberRow, Education } from "./profiles";

export type { AdminDashboardCounts, AdminMemberRow } from "./profiles";

/** One mentorship topic and how many mentorship requests named it. */
export interface AdminDashboardTopic {
  topicId: string;
  label: string;
  requests: number;
}

/**
 * One calendar month (America/Chicago) of mentorship activity, by when the
 * request was created (completions by when the relationship ended).
 */
export interface AdminDashboardMonth {
  /** YYYY-MM */
  month: string;
  requestsSent: number;
  answeredWithin7Days: number;
  expired: number;
  completedRelationships: number;
}

/**
 * `GET /api/admin/dashboard`: the `admin_dashboard` view, the success
 * measures of 01 section 8 as aggregates. Every request measure counts
 * mentorship requests only; introductions are counted on their own.
 * Percentages are whole numbers, and null when nothing has been counted yet.
 */
export interface AdminDashboard extends AdminDashboardCounts {
  openReports: number;
  /** When the oldest open report was filed; null when none are open. */
  oldestOpenReportAt: string | null;
  pausedMentors: number;
  /** How long the mentors paused now have been paused, in days (median, one decimal). */
  medianPausedDays: number | null;
  /** Submission to decision for decided profile reviews, in hours (median, one decimal). */
  medianHoursToApproval: number | null;
  requestsSent: number;
  introductionsSent: number;
  /** Accepted or declined within 7 days, of the requests whose first 7 days are over or that were answered. */
  answeredWithin7DaysPct: number | null;
  /** accepted / (accepted + declined), counting completed requests as accepted. */
  acceptanceRatePct: number | null;
  /** expired, of the requests no longer pending. */
  expiryRatePct: number | null;
  activeRelationships: number;
  completedRelationships: number;
  /** Members whose last activity (or sign-up) is more than 6 months ago. */
  membersInactive6Months: number;
  /** Most requested first. */
  requestsByTopic: AdminDashboardTopic[];
  /** The last three months, oldest first, the current month last. */
  byMonth: AdminDashboardMonth[];
  /** Meetings with status `completed` (01 section 8, "Meetings held"). */
  meetingsHeld: number;
  /** Meetings still to come. */
  meetingsUpcoming: number;
  /** Post-completion feedback answers from either side (Task 32). */
  feedbackResponses: number;
  /** Their mean helpfulness, 1 to 5, one decimal; null before the first answer. */
  feedbackAverageHelpful: number | null;
}

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

/** The filters of `GET /api/admin/members` (03 section 8.3); each narrows the list when given. */
export interface AdminMemberFilters {
  /** Matches first, last or full name. */
  q?: string;
  kind?: ProfileKind;
  approval?: ApprovalState;
  mentorStatus?: MentorStatus;
  verified?: boolean;
  /** A region slug, such as `greater-new-orleans`. */
  region?: string;
}

/** One row of `GET /api/admin/members`: `admin_list_members` plus the state the actions need. */
export interface AdminMember extends AdminMemberRow {
  visibility: Visibility;
  adminHidden: boolean;
  verified: boolean;
  region: string;
  isAdmin: boolean;
  /** "Title · Organization" for professionals, the program for students. */
  detail: string | null;
}

/** `GET /api/admin/scope`: the region the caller administers; null means every region. */
export interface AdminScope {
  regionId: string | null;
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
  /** The region this administrator acts for; null means every region. */
  regionId: string | null;
  /** That region's label; null for every region. */
  regionLabel: string | null;
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
  /** For a tag retired by a merge, the label of the tag that replaced it. */
  mergedIntoLabel: string | null;
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

/** `POST /api/admin/tags/:id/merge`: how many profiles carried the merged tag. */
export interface AdminTagMergeResult {
  moved: number;
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
