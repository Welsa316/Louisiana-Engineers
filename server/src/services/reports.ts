import type { AdminResolveReport } from "@shared/schemas/admin";
import type { Report } from "@shared/schemas/request";
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
} from "@shared/types/common";
import type { AdminPerson, AdminReport, AdminRequestItem } from "@shared/types/reports";
import type { Db } from "../db/tx";

/**
 * Reports and moderation (Task 24). Filing is `report_profile` (members,
 * rate limited, notifies administrators); closing is `admin_resolve_report`
 * (administrators; hides the profile or suspends the account when asked,
 * tells the reporter the status only). Administrators read through the
 * `admin_reports` and `admin_requests` views, which return nothing to
 * anyone else; the request free text in `admin_requests` is masked unless
 * an open report names a party. Nothing here reads an email address or a
 * contact value.
 */

export interface PageArgs {
  page: number;
  size: number;
}

const offset = ({ page, size }: PageArgs) => (page - 1) * size;
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/* -------------------------------------------------------------- filing */

/** Files a report as the caller; the new report's id. */
export async function fileReport(db: Db, profileId: string, input: Report): Promise<string> {
  const row = await db.one<{ id: string }>("SELECT report_profile($1, $2::report_reason, $3) AS id", [
    profileId,
    input.reason,
    input.detail ?? null,
  ]);
  return row.id;
}

/* ------------------------------------------------------ admin: reports */

interface ReportRow {
  id: string;
  status: ReportStatus;
  reason: ReportReason;
  detail: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolution_note: string | null;
  action: ReportAction | null;
  profile_id: string;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_credentials: string | null;
  profile_kind: ProfileKind | null;
  profile_title: string | null;
  profile_organization: string | null;
  profile_approval_state: ApprovalState;
  profile_visibility: Visibility;
  profile_admin_hidden: boolean;
  profile_suspended: boolean;
  profile_former: boolean;
  reporter_id: string | null;
  reporter_first_name: string | null;
  reporter_last_name: string | null;
  reporter_former: boolean | null;
  resolved_by: string | null;
  resolver_first_name: string | null;
  resolver_last_name: string | null;
  resolver_former: boolean | null;
  open_reports_on_profile: number;
}

const REPORT_COLUMNS = `
  id, status::text AS status, reason::text AS reason, detail, created_at, resolved_at, resolution_note, action,
  profile_id, profile_first_name, profile_last_name, profile_credentials, profile_kind::text AS profile_kind,
  profile_title, profile_organization, profile_approval_state::text AS profile_approval_state,
  profile_visibility::text AS profile_visibility, profile_admin_hidden, profile_suspended, profile_former,
  reporter_id, reporter_first_name, reporter_last_name, reporter_former,
  resolved_by, resolver_first_name, resolver_last_name, resolver_former, open_reports_on_profile`;

function person(id: string | null, first: string | null, last: string | null, former: boolean | null): AdminPerson | null {
  if (!id) return null;
  return { id, firstName: first, lastName: last, former: former ?? false };
}

function toReport(row: ReportRow): AdminReport {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
    resolvedAt: iso(row.resolved_at),
    resolutionNote: row.resolution_note,
    action: row.action,
    profile: {
      id: row.profile_id,
      firstName: row.profile_first_name,
      lastName: row.profile_last_name,
      former: row.profile_former,
      credentials: row.profile_credentials,
      kind: row.profile_kind,
      title: row.profile_title,
      organization: row.profile_organization,
      approvalState: row.profile_approval_state,
      visibility: row.profile_visibility,
      adminHidden: row.profile_admin_hidden,
      suspended: row.profile_suspended,
    },
    reporter: person(row.reporter_id, row.reporter_first_name, row.reporter_last_name, row.reporter_former),
    resolvedBy: person(row.resolved_by, row.resolver_first_name, row.resolver_last_name, row.resolver_former),
    openReportsOnProfile: row.open_reports_on_profile,
  };
}

/** Open reports oldest first (the queue); closed ones most recently closed first. */
export async function listReports(db: Db, status: ReportStatus, paging: PageArgs): Promise<Paged<AdminReport>> {
  const order = status === "open" ? "created_at ASC, id" : "resolved_at DESC, id";
  const rows = await db.query<ReportRow & { total: number }>(
    `SELECT ${REPORT_COLUMNS}, count(*) OVER ()::int AS total
       FROM admin_reports WHERE status = $1::report_status
      ORDER BY ${order} LIMIT $2 OFFSET $3`,
    [status, paging.size, offset(paging)],
  );
  const total =
    rows[0]?.total ??
    (await db.one<{ n: number }>("SELECT count(*)::int AS n FROM admin_reports WHERE status = $1::report_status", [status])).n;
  return { items: rows.map(toReport), total };
}

export async function getReport(db: Db, id: string): Promise<AdminReport | null> {
  const row = await db.maybeOne<ReportRow>(`SELECT ${REPORT_COLUMNS} FROM admin_reports WHERE id = $1`, [id]);
  return row ? toReport(row) : null;
}

/** Closes a report through `admin_resolve_report`. */
export async function resolveReport(db: Db, id: string, input: AdminResolveReport): Promise<void> {
  await db.query("SELECT admin_resolve_report($1, $2::report_status, $3, $4)", [
    id,
    input.status,
    input.note ?? null,
    input.action,
  ]);
}

/* ----------------------------------------------------- admin: requests */

interface AdminRequestRow {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  topic_id: string | null;
  topic_label: string | null;
  mentee_id: string;
  mentee_first_name: string | null;
  mentee_last_name: string | null;
  mentee_former: boolean;
  mentor_id: string;
  mentor_first_name: string | null;
  mentor_last_name: string | null;
  mentor_former: boolean;
  created_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  decline_reason: DeclineReason | null;
  text_purged: boolean;
  under_report: boolean;
  why: string | null;
  goals: string | null;
  scheduling_note: string | null;
  mentor_note: string | null;
}

export interface AdminRequestFilter {
  /** Only requests where this profile is the mentee or the mentor. */
  profile?: string;
  status?: RequestStatus;
}

/** Requests through the masked `admin_requests` view, newest first. */
export async function listAdminRequests(db: Db, filter: AdminRequestFilter, paging: PageArgs): Promise<Paged<AdminRequestItem>> {
  const where: string[] = [];
  const params: unknown[] = [paging.size, offset(paging)];
  if (filter.profile) {
    params.push(filter.profile);
    where.push(`$${params.length}::uuid IN (mentee_id, mentor_id)`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}::request_status`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await db.query<AdminRequestRow & { total: number }>(
    `SELECT id, kind::text AS kind, status::text AS status, topic_id, topic_label,
            mentee_id, mentee_first_name, mentee_last_name, mentee_former,
            mentor_id, mentor_first_name, mentor_last_name, mentor_former,
            created_at, expires_at, responded_at, decline_reason, text_purged, under_report,
            nullif(why, '') AS why, goals, scheduling_note, mentor_note,
            count(*) OVER ()::int AS total
       FROM admin_requests ${clause}
      ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
    params,
  );
  let total = rows[0]?.total;
  if (total === undefined) {
    const countParams = params.slice(2);
    const countClause = clause.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) - 2}`);
    total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM admin_requests ${countClause}`, countParams)).n;
  }
  return {
    items: rows.map((row): AdminRequestItem => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      topicId: row.topic_id,
      topicLabel: row.topic_label,
      mentee: { id: row.mentee_id, firstName: row.mentee_first_name, lastName: row.mentee_last_name, former: row.mentee_former },
      mentor: { id: row.mentor_id, firstName: row.mentor_first_name, lastName: row.mentor_last_name, former: row.mentor_former },
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      respondedAt: iso(row.responded_at),
      declineReason: row.decline_reason,
      textPurged: row.text_purged,
      underReport: row.under_report,
      why: row.why,
      goals: row.goals,
      schedulingNote: row.scheduling_note,
      mentorNote: row.mentor_note,
    })),
    total,
  };
}
