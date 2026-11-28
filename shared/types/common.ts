/**
 * Types shared by every API area: the Postgres enums from
 * docs/professional-network/02-technical-architecture.md section 4.2 as value
 * lists (so zod and the screens can enumerate them), paging and the error body.
 * Vocabularies with display labels (participation, audiences, contact methods)
 * live in shared/taxonomy.ts.
 */

export const profileKinds = ["student", "professional"] as const;
export type ProfileKind = (typeof profileKinds)[number];

export const visibilities = ["public", "members", "hidden"] as const;
export type Visibility = (typeof visibilities)[number];

/** What a professional may pick at onboarding; `hidden` is a later opt-out in settings. */
export const onboardingVisibilities = ["public", "members"] as const satisfies readonly Visibility[];

export const approvalStates = ["pending", "approved", "declined"] as const;
export type ApprovalState = (typeof approvalStates)[number];

export const mentorStatuses = ["off", "active", "paused"] as const;
export type MentorStatus = (typeof mentorStatuses)[number];

export const requestKinds = ["mentorship", "introduction"] as const;
export type RequestKind = (typeof requestKinds)[number];

export const requestStatuses = ["pending", "accepted", "declined", "completed", "canceled", "expired"] as const;
export type RequestStatus = (typeof requestStatuses)[number];

/** What a mentor offers. */
export const mentoringFormats = ["one-time", "recurring", "either"] as const;
export type MentoringFormat = (typeof mentoringFormats)[number];

/** What a request asks for: requests use only the first two formats. */
export const requestFormats = ["one-time", "recurring"] as const satisfies readonly MentoringFormat[];
export type RequestFormat = (typeof requestFormats)[number];

export const meetingModes = ["online", "in-person", "either"] as const;
export type MeetingMode = (typeof meetingModes)[number];

/** Reasons a mentor may give. `member_left` is set only by a deletion, never by a person. */
export const declineReasons = ["not_fit", "no_capacity", "outside_experience", "other"] as const;
export type DeclineReason = (typeof declineReasons)[number] | "member_left";

export const reportReasons = ["promotional", "misrepresentation", "unsafe", "spam", "other"] as const;
export type ReportReason = (typeof reportReasons)[number];

export const reportStatuses = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof reportStatuses)[number];

export const reportActions = ["none", "hide_profile", "suspend_requests", "remove_account"] as const;
export type ReportAction = (typeof reportActions)[number];

export const verifiedMethods = ["work_email", "linkedin", "personal_knowledge"] as const;
export type VerifiedMethod = (typeof verifiedMethods)[number];

export const reviewDecisions = ["approved", "declined"] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export const tagStatuses = ["approved", "proposed", "rejected"] as const;
export type TagStatus = (typeof tagStatuses)[number];

export const notificationCategories = [
  "request",
  "response",
  "reminder",
  "profile",
  "report",
  "account",
  "admin_digest",
  "member_digest",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

/** Vocabularies an administrator can add to through `admin_add_vocabulary`. */
export const vocabularyKinds = ["discipline", "topic"] as const;
export type VocabularyKind = (typeof vocabularyKinds)[number];

/** Directory experience bands, derived from years by the directory view. */
export const experienceBandIds = ["0-2", "3-9", "10-19", "20+"] as const;
export type ExperienceBandId = (typeof experienceBandIds)[number];

/* ------------------------------------------------------------ API shapes */

/** Every list endpoint answers `{ items, total }`. */
export interface Paged<T> {
  items: T[];
  total: number;
}

export interface PageQuery {
  /** 1-based */
  page: number;
  /** default 20, max 50 */
  size: number;
}

/** Domain errors raised by the SQL functions as `mest.<code>` and answered with 409. */
export type DomainErrorCode =
  | "platform_paused"
  | "mentor_unavailable"
  | "topic_not_offered"
  | "mentor_full"
  | "pending_cap"
  | "duplicate"
  | "rate_limited";

export type ErrorCode =
  | "unauthenticated"
  | "not_member"
  | "not_admin"
  | "members_only"
  | "not_found"
  | "validation"
  | DomainErrorCode
  // Later tasks may add codes; keep autocomplete for the known ones.
  | (string & {});

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/** The JSON body of every error response. */
export interface ApiErrorBody {
  code: ErrorCode;
  message?: string;
  issues?: ValidationIssue[];
}
