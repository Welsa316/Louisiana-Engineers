/**
 * Shapes of the report and moderation endpoints (Task 24):
 * `POST /api/profiles/:id/report` for members, and `GET /api/admin/reports`,
 * `POST /api/admin/reports/:id/resolve` and `GET /api/admin/requests` for
 * administrators. The reported member never reads a report; the reporter's
 * identity reaches administrators only. Request free text appears in
 * `AdminRequestItem` only while an open report names one of its parties.
 */

import type {
  ApprovalState,
  DeclineReason,
  Paged,
  ProfileKind,
  ReportAction,
  ReportReason,
  ReportStatus,
  RequestKind,
  RequestStatus,
  Visibility,
} from "./common";

/** `POST /api/profiles/:id/report` (201). */
export interface ReportCreated {
  id: string;
}

/** A person named on a report or request, as an administrator sees them. */
export interface AdminPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** The account was deleted; the names read "Former member". */
  former: boolean;
}

/** The reported profile, with what an administrator needs to decide. */
export interface AdminReportProfile extends AdminPerson {
  credentials: string | null;
  kind: ProfileKind | null;
  title: string | null;
  organization: string | null;
  approvalState: ApprovalState;
  visibility: Visibility;
  /** Hidden by an administrator. */
  adminHidden: boolean;
  /** Suspended from requests (`users.suspended_at`). */
  suspended: boolean;
}

/** One row of `GET /api/admin/reports?status=`. */
export interface AdminReport {
  id: string;
  status: ReportStatus;
  reason: ReportReason;
  detail: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** What resolving did; null while open. */
  action: ReportAction | null;
  profile: AdminReportProfile;
  /** null once the reporter's account is deleted. */
  reporter: AdminPerson | null;
  resolvedBy: AdminPerson | null;
  /** Open reports about the same profile, this one included while open. */
  openReportsOnProfile: number;
}

export type AdminReportsResponse = Paged<AdminReport>;

/** `POST /api/admin/reports/:id/resolve`: the report as it now stands. */
export type AdminReportResolved = AdminReport;

/**
 * One row of `GET /api/admin/requests` (the `admin_requests` view). The four
 * free-text fields are null unless `underReport`: an open report names the
 * mentee or the mentor.
 */
export interface AdminRequestItem {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  topicId: string | null;
  topicLabel: string | null;
  mentee: AdminPerson;
  mentor: AdminPerson;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  declineReason: DeclineReason | "member_left" | null;
  textPurged: boolean;
  underReport: boolean;
  why: string | null;
  goals: string | null;
  schedulingNote: string | null;
  mentorNote: string | null;
}

export type AdminRequestsResponse = Paged<AdminRequestItem>;

/** Domain refusals the report endpoints answer with `409 { code }`. */
export type ReportErrorCode = "rate_limited" | "invalid_report" | "report_closed" | "invalid_action" | "not_available";
