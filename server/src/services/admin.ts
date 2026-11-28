import type {
  AdminConfig,
  AdminDashboard,
  AdminDiscipline,
  AdminMember,
  AdminMemberFilters,
  AdminReviewDetail,
  AdminReviewHistoryItem,
  AdminReviewItem,
  AdminReviewSnapshot,
  AdminReviewStatus,
  AdminRole,
  AdminScope,
  AdminTag,
  AdminTagMergeResult,
  AdminTopic,
  AdminVocabularyLists,
} from "@shared/types/admin";
import type { Paged, ReviewDecision, TagStatus, VerifiedMethod, Visibility } from "@shared/types/common";
import type { AdminMemberRow } from "@shared/types/profiles";
import type { DisciplineGroup } from "@shared/taxonomy";
import type { ConfigPatch, RenameKind } from "@shared/schemas/admin";
import type { Db } from "../db/tx";
import { AppError } from "../http/errors";

/**
 * The administration area (03 section 8). Every call runs inside the
 * administrator's own `withUser` transaction: reads go through the
 * administrator policies on each table, and every change is one of the
 * `admin_*` SQL functions from migrations 0002, 0004 and 0017, which check
 * `is_admin()` again and write the audit entry. A chapter administrator
 * reads and acts only inside its region, and the network-wide changes
 * (settings, vocabulary, tags) need an administrator for every region
 * (migrations 0020 and 0023). Nothing here reads
 * `contact_preferences`, `profiles.linkedin_url` or `users.email`; the only
 * trace of an address is its domain, from `admin_list_members`.
 */

export interface PageArgs {
  page: number;
  size: number;
}

const offset = ({ page, size }: PageArgs) => (page - 1) * size;

/* ------------------------------------------------------------- dashboard */

interface DashboardRow {
  approved_professionals: number;
  pending_professionals: number;
  students: number;
  active_mentors: number;
  open_reports: number;
  oldest_open_report_at: Date | null;
  paused_mentors: number;
  median_paused_days: number | null;
  median_hours_to_approval: number | null;
  requests_sent: number;
  introductions_sent: number;
  answered_within_7_days_pct: number | null;
  acceptance_rate_pct: number | null;
  expiry_rate_pct: number | null;
  active_relationships: number;
  completed_relationships: number;
  members_inactive_6_months: number;
  requests_by_topic: AdminDashboard["requestsByTopic"];
  by_month: AdminDashboard["byMonth"];
  meetings_held: number;
  meetings_upcoming: number;
  feedback_responses: number | null;
  feedback_average_helpful: number | null;
}

/** The success measures (01 section 8); migration 0009 defines each one. */
export async function dashboard(db: Db): Promise<AdminDashboard> {
  const row = await db.maybeOne<DashboardRow>("SELECT * FROM admin_dashboard");
  if (!row) throw new AppError(403, "not_admin", "admin_dashboard returned no row");
  return {
    approvedProfessionals: row.approved_professionals,
    pendingProfessionals: row.pending_professionals,
    students: row.students,
    activeMentors: row.active_mentors,
    openReports: row.open_reports,
    oldestOpenReportAt: row.oldest_open_report_at ? row.oldest_open_report_at.toISOString() : null,
    pausedMentors: row.paused_mentors,
    medianPausedDays: row.median_paused_days,
    medianHoursToApproval: row.median_hours_to_approval,
    requestsSent: row.requests_sent,
    introductionsSent: row.introductions_sent,
    answeredWithin7DaysPct: row.answered_within_7_days_pct,
    acceptanceRatePct: row.acceptance_rate_pct,
    expiryRatePct: row.expiry_rate_pct,
    activeRelationships: row.active_relationships,
    completedRelationships: row.completed_relationships,
    membersInactive6Months: row.members_inactive_6_months,
    requestsByTopic: row.requests_by_topic,
    byMonth: row.by_month,
    meetingsHeld: row.meetings_held,
    meetingsUpcoming: row.meetings_upcoming,
    feedbackResponses: row.feedback_responses,
    feedbackAverageHelpful: row.feedback_average_helpful,
  };
}

/* ---------------------------------------------------------------- reviews */

interface ReviewRow {
  id: string;
  profile_id: string;
  first_name: string | null;
  last_name: string | null;
  credentials: string | null;
  title: string | null;
  organization: string | null;
  discipline_id: string | null;
  discipline_label: string | null;
  decision: ReviewDecision | null;
  notes: string | null;
  submitted_at: Date;
  decided_at: Date | null;
  approval_state: AdminReviewItem["approvalState"];
  verified: boolean;
  wants_to_mentor: boolean;
  previous_reviews: number;
}

/**
 * Title, organization and discipline come from the snapshot (what was
 * submitted); the name from the live profile, since the queue is read by
 * person. Earlier reviews are the member's other decided rows.
 */
const REVIEW_SELECT = `
  SELECT r.id, r.profile_id,
         coalesce(p.first_name, r.snapshot->>'firstName') AS first_name,
         coalesce(p.last_name, r.snapshot->>'lastName') AS last_name,
         p.credentials,
         coalesce(r.snapshot->>'title', d.title) AS title,
         coalesce(r.snapshot->>'organization', d.organization) AS organization,
         coalesce(r.snapshot->>'disciplineId', d.discipline_id) AS discipline_id,
         disc.label AS discipline_label,
         r.decision, r.notes, r.submitted_at, r.decided_at,
         p.approval_state,
         coalesce(d.verified, false) AS verified,
         coalesce(r.snapshot->'participation' ? 'mentoring', false) AS wants_to_mentor,
         (SELECT count(*) FROM profile_reviews o
           WHERE o.profile_id = r.profile_id AND o.id <> r.id AND o.decision IS NOT NULL
             AND o.submitted_at < r.submitted_at)::int AS previous_reviews
    FROM profile_reviews r
    JOIN profiles p ON p.id = r.profile_id
    LEFT JOIN professional_details d ON d.profile_id = r.profile_id
    LEFT JOIN disciplines disc ON disc.id = coalesce(r.snapshot->>'disciplineId', d.discipline_id)`;

function reviewItem(row: ReviewRow): AdminReviewItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    firstName: row.first_name,
    lastName: row.last_name,
    credentials: row.credentials,
    title: row.title,
    organization: row.organization,
    disciplineId: row.discipline_id,
    disciplineLabel: row.discipline_label,
    decision: row.decision,
    notes: row.notes,
    submittedAt: row.submitted_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    approvalState: row.approval_state,
    verified: row.verified,
    wantsToMentor: row.wants_to_mentor,
    previousReviews: row.previous_reviews,
  };
}

/**
 * Open reviews oldest first (03 section 8.1); decided ones most recent first.
 * A chapter administrator sees the reviews of its own region only
 * (`admin_covers_profile`, migration 0020), the ones it can decide.
 */
export async function listReviews(db: Db, status: AdminReviewStatus, paging: PageArgs): Promise<Paged<AdminReviewItem>> {
  const where = `admin_covers_profile(r.profile_id) AND ${status === "pending" ? "r.decision IS NULL" : "r.decision = $3::review_decision"}`;
  const order = status === "pending" ? "q.submitted_at ASC, q.id" : "q.decided_at DESC, q.id";
  const params: unknown[] = [paging.size, offset(paging)];
  if (status !== "pending") params.push(status);
  const rows = await db.query<ReviewRow & { total: number }>(
    `SELECT q.*, count(*) OVER ()::int AS total FROM (${REVIEW_SELECT} WHERE ${where}) q
      ORDER BY ${order} LIMIT $1 OFFSET $2`,
    params,
  );
  const total = rows[0]?.total ?? (await countReviews(db, status));
  return { items: rows.map(reviewItem), total };
}

/** The total when the page asked for is past the end (the window count has no row to ride on). */
async function countReviews(db: Db, status: AdminReviewStatus): Promise<number> {
  const row = await db.one<{ n: number }>(
    status === "pending"
      ? "SELECT count(*)::int AS n FROM profile_reviews WHERE decision IS NULL AND admin_covers_profile(profile_id)"
      : "SELECT count(*)::int AS n FROM profile_reviews WHERE decision = $1::review_decision AND admin_covers_profile(profile_id)",
    status === "pending" ? [] : [status],
  );
  return row.n;
}

/**
 * One review with the member's history. Outside a chapter administrator's
 * region it does not exist (404), as the review policy answers (0023).
 */
export async function getReview(db: Db, id: string): Promise<AdminReviewDetail> {
  const row = await db.maybeOne<
    ReviewRow & {
      snapshot: AdminReviewSnapshot;
      verified_method: VerifiedMethod | null;
      visibility: Visibility;
      admin_hidden: boolean;
      joined_at: Date;
    }
  >(
    `SELECT q.*, r.snapshot, d.verified_method, p.visibility, p.admin_hidden_at IS NOT NULL AS admin_hidden,
            p.created_at AS joined_at
       FROM (${REVIEW_SELECT} WHERE r.id = $1 AND admin_covers_profile(r.profile_id)) q
       JOIN profile_reviews r ON r.id = q.id
       JOIN profiles p ON p.id = q.profile_id
       LEFT JOIN professional_details d ON d.profile_id = q.profile_id`,
    [id],
  );
  if (!row) throw new AppError(404, "not_found", `no review ${id}`);

  const history = await db.query<{
    id: string;
    decision: ReviewDecision | null;
    notes: string | null;
    submitted_at: Date;
    decided_at: Date | null;
  }>(
    `SELECT id, decision, notes, submitted_at, decided_at FROM profile_reviews
      WHERE profile_id = $1 AND id <> $2 ORDER BY submitted_at DESC`,
    [row.profile_id, id],
  );

  return {
    ...reviewItem(row),
    snapshot: row.snapshot ?? {},
    emailDomain: await emailDomainOf(db, row.profile_id),
    verifiedMethod: row.verified_method,
    visibility: row.visibility,
    adminHidden: row.admin_hidden,
    joinedAt: row.joined_at.toISOString(),
    history: history.map(
      (h): AdminReviewHistoryItem => ({
        id: h.id,
        decision: h.decision,
        notes: h.notes,
        submittedAt: h.submitted_at.toISOString(),
        decidedAt: h.decided_at ? h.decided_at.toISOString() : null,
      }),
    ),
  };
}

/** The sign-up address's domain for one profile, never the address. */
async function emailDomainOf(db: Db, profileId: string): Promise<string | null> {
  const row = await db.one<{ domain: string | null }>("SELECT admin_member_domain($1) AS domain", [profileId]);
  return row.domain;
}

export async function decideReview(db: Db, id: string, decision: ReviewDecision, notes: string | undefined): Promise<void> {
  await db.query("SELECT admin_review_profile($1, $2::review_decision, $3)", [id, decision, notes ?? null]);
}

/* -------------------------------------------------------- profile actions */

export async function setVerified(db: Db, profileId: string, method: VerifiedMethod | null): Promise<void> {
  await db.query("SELECT admin_set_verified($1, $2::verified_method)", [profileId, method]);
}

export async function hideProfile(db: Db, profileId: string): Promise<void> {
  await db.query("SELECT admin_hide_profile($1)", [profileId]);
}

export async function restoreProfile(db: Db, profileId: string): Promise<void> {
  await db.query("SELECT admin_restore_profile($1)", [profileId]);
}

/* ---------------------------------------------------------------- members */

export async function listMembers(db: Db, filters: AdminMemberFilters, paging: PageArgs): Promise<Paged<AdminMember>> {
  const args = [
    filters.q?.trim() || null,
    filters.kind ?? null,
    filters.approval ?? null,
    filters.mentorStatus ?? null,
    filters.verified ?? null,
    filters.region ?? null,
  ];
  const call = "admin_list_members($1, $2, $3, $4::profile_kind, $5::approval_state, $6::mentor_status, $7::boolean, $8)";
  const rows = await db.query<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    kind: AdminMemberRow["kind"];
    approval_state: AdminMemberRow["approvalState"];
    mentor_status: AdminMemberRow["mentorStatus"];
    verified: boolean;
    region: string;
    email_domain: string;
    joined_at: Date;
    total: number;
  }>(
    `SELECT id, first_name, last_name, kind, approval_state, mentor_status, verified, region, email_domain, joined_at, total
       FROM ${call}`,
    [paging.page, paging.size, ...args],
  );
  if (rows.length === 0) {
    // Past the last page: the window total has no row, so ask for the first.
    const first = await db.maybeOne<{ total: number }>(`SELECT total FROM ${call}`, [1, 1, ...args]);
    return { items: [], total: first?.total ?? 0 };
  }

  const extra = await db.query<{
    id: string;
    visibility: Visibility;
    admin_hidden: boolean;
    is_admin: boolean;
    detail: string | null;
  }>(
    `SELECT p.id, p.visibility, p.admin_hidden_at IS NOT NULL AS admin_hidden,
            EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = p.id AND a.revoked_at IS NULL) AS is_admin,
            CASE WHEN d.profile_id IS NOT NULL THEN d.title || ' · ' || d.organization ELSE s.program END AS detail
       FROM profiles p
       LEFT JOIN professional_details d ON d.profile_id = p.id
       LEFT JOIN student_details s ON s.profile_id = p.id
      WHERE p.id = ANY ($1::uuid[])`,
    [rows.map((r) => r.id)],
  );
  const byId = new Map(extra.map((e) => [e.id, e]));

  return {
    total: rows[0].total,
    items: rows.map((r): AdminMember => {
      const e = byId.get(r.id);
      return {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        kind: r.kind,
        approvalState: r.approval_state,
        mentorStatus: r.mentor_status,
        emailDomain: r.email_domain,
        joinedAt: r.joined_at.toISOString(),
        visibility: e?.visibility ?? "hidden",
        adminHidden: e?.admin_hidden ?? false,
        verified: r.verified,
        region: r.region,
        isAdmin: e?.is_admin ?? false,
        detail: e?.detail ?? null,
      };
    }),
  };
}

/* --------------------------------------------------------- administrators */

/** The caller's own scope (`admin_roles.region_id`, migration 0020); null is every region. */
export async function adminScope(db: Db): Promise<AdminScope> {
  const row = await db.maybeOne<{ region_id: string | null }>(
    "SELECT region_id FROM admin_roles WHERE profile_id = app_uid() AND revoked_at IS NULL",
  );
  return { regionId: row?.region_id ?? null };
}

export async function listAdmins(db: Db, viewerId: string, paging: PageArgs): Promise<Paged<AdminRole>> {
  const rows = await db.query<{
    profile_id: string;
    first_name: string | null;
    last_name: string | null;
    granted_at: Date;
    granted_by_name: string | null;
    region_id: string | null;
    region_label: string | null;
    total: number;
  }>(
    `SELECT r.profile_id, r.first_name, r.last_name, r.granted_at, count(*) OVER ()::int AS total,
            r.granted_by_name, r.region_id, r.region_label
       FROM admin_roster r
      ORDER BY r.granted_at, r.last_name, r.profile_id
      LIMIT $1 OFFSET $2`,
    [paging.size, offset(paging)],
  );
  const total = rows[0]?.total ?? (await db.one<{ n: number }>("SELECT count(*)::int AS n FROM admin_roster")).n;
  const items = rows.map((r) => ({
    profileId: r.profile_id,
    firstName: r.first_name,
    lastName: r.last_name,
    grantedAt: r.granted_at.toISOString(),
    grantedByName: r.granted_by_name,
    isSelf: r.profile_id === viewerId,
    regionId: r.region_id,
    regionLabel: r.region_label,
  }));
  return { items, total };
}

/**
 * Grants the role for one region, or for every region when `regionId` is
 * null; on a current administrator it changes the scope. `admin_grant`
 * keeps the scope within the caller's own.
 */
export async function grantAdmin(db: Db, profileId: string, regionId: string | null = null): Promise<void> {
  await db.query("SELECT admin_grant($1, $2)", [profileId, regionId]);
}

export async function revokeAdmin(db: Db, profileId: string): Promise<void> {
  await db.query("SELECT admin_revoke($1)", [profileId]);
}

/* ------------------------------------------------------------------- tags */

/** `value` as a literal inside a LIKE pattern (backslash is the default escape). */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Proposed tags oldest first (a queue); the others alphabetically. `q`
 * keeps the labels that contain it, case-insensitively.
 */
export async function listTags(
  db: Db,
  status: TagStatus | undefined,
  paging: PageArgs,
  q?: string,
): Promise<Paged<AdminTag>> {
  const search = q?.trim() ? `%${likeEscape(q.trim())}%` : null;
  const rows = await db.query<{
    id: string;
    label: string;
    slug: string;
    status: TagStatus;
    proposed_by_name: string | null;
    created_at: Date;
    usage: number;
    merged_into_label: string | null;
    total: number;
  }>(
    `SELECT t.id, t.label, t.slug, t.status, t.created_at,
            (SELECT a.proposer_name FROM admin_tag_proposers(ARRAY[t.id]) a) AS proposed_by_name,
            (SELECT count(*) FROM profile_expertise pe WHERE pe.tag_id = t.id)::int AS usage,
            (SELECT m.label FROM expertise_tags m WHERE m.id = t.merged_into) AS merged_into_label,
            count(*) OVER ()::int AS total
       FROM expertise_tags t
      WHERE ($1::tag_status IS NULL OR t.status = $1::tag_status)
        AND ($4::text IS NULL OR t.label ILIKE $4::text)
      ORDER BY CASE WHEN t.status = 'proposed' THEN t.created_at END ASC NULLS LAST, lower(t.label), t.id
      LIMIT $2 OFFSET $3`,
    [status ?? null, paging.size, offset(paging), search],
  );
  let total = rows[0]?.total;
  if (total === undefined) {
    total = (
      await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM expertise_tags t
          WHERE ($1::tag_status IS NULL OR t.status = $1::tag_status) AND ($2::text IS NULL OR t.label ILIKE $2::text)`,
        [status ?? null, search],
      )
    ).n;
  }
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      label: r.label,
      slug: r.slug,
      status: r.status,
      proposedByName: r.proposed_by_name,
      createdAt: r.created_at.toISOString(),
      usage: r.usage,
      mergedIntoLabel: r.merged_into_label,
    })),
  };
}

export async function decideTag(db: Db, tagId: string, decision: "approved" | "rejected"): Promise<void> {
  await db.query("SELECT admin_review_tag($1, $2::tag_status)", [tagId, decision]);
}

/** Moves every profile from `fromTagId` to `intoTagId` and retires the old tag (`admin_merge_tags`, 0017). */
export async function mergeTags(db: Db, fromTagId: string, intoTagId: string): Promise<AdminTagMergeResult> {
  const row = await db.one<{ moved: number }>("SELECT admin_merge_tags($1::uuid, $2::uuid) AS moved", [fromTagId, intoTagId]);
  return { moved: row.moved };
}

/* ------------------------------------------------------------- vocabulary */

export async function vocabulary(db: Db): Promise<AdminVocabularyLists> {
  const disciplines = await db.query<{ id: string; label: string; group_name: DisciplineGroup | null; active: boolean }>(
    "SELECT id, label, group_name, active FROM disciplines ORDER BY sort_order, id",
  );
  const topics = await db.query<{ id: string; label: string; active: boolean }>(
    "SELECT id, label, active FROM mentorship_topics ORDER BY sort_order, id",
  );
  return {
    disciplines: disciplines.map(
      (d): AdminDiscipline => ({ id: d.id, label: d.label, groupName: d.group_name, active: d.active }),
    ),
    topics: topics.map((t): AdminTopic => ({ id: t.id, label: t.label, active: t.active })),
  };
}

export async function addVocabulary(
  db: Db,
  entry: { kind: "discipline" | "topic"; id: string; label: string; groupName?: DisciplineGroup },
): Promise<void> {
  await db.query("SELECT admin_add_vocabulary($1, $2, $3, $4::discipline_group)", [
    entry.kind,
    entry.id,
    entry.label,
    entry.kind === "discipline" ? (entry.groupName ?? null) : null,
  ]);
}

/** Relabels a discipline, topic or tag; ids and slugs stay (`admin_rename_vocabulary`, 0017). */
export async function renameVocabulary(db: Db, kind: RenameKind, id: string, label: string): Promise<void> {
  await db.query("SELECT admin_rename_vocabulary($1, $2, $3)", [kind, id, label]);
}

/** Stops offering a mentorship topic; existing choices stay (`admin_retire_topic`, 0017). */
export async function retireTopic(db: Db, id: string): Promise<void> {
  await db.query("SELECT admin_retire_topic($1)", [id]);
}

/* ---------------------------------------------------------- configuration */

export async function readConfig(db: Db): Promise<AdminConfig> {
  const rows = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM config ORDER BY key");
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as unknown as AdminConfig;
}

/**
 * Applies a patch key by key through `admin_update_config`, which validates
 * each against the stored values and audits it. Expiry and reminder days
 * check each other, so the order matters: when the expiry falls, the new
 * reminders go first (they already sit below the old expiry); otherwise the
 * expiry goes first. Any refusal rolls the whole patch back with the
 * transaction.
 */
export async function updateConfig(db: Db, patch: ConfigPatch): Promise<AdminConfig> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof ConfigPatch, unknown][];
  if (patch.request_expiry_days !== undefined && patch.reminder_days !== undefined) {
    const current = await readConfig(db);
    const remindersFirst = patch.request_expiry_days < current.request_expiry_days;
    const rank = (key: string) =>
      key === "reminder_days" ? (remindersFirst ? 0 : 1) : key === "request_expiry_days" ? (remindersFirst ? 1 : 0) : 2;
    entries.sort(([a], [b]) => rank(a) - rank(b));
  }
  for (const [key, value] of entries) {
    await db.query("SELECT admin_update_config($1, $2::jsonb)", [key, JSON.stringify(value)]);
  }
  return readConfig(db);
}
