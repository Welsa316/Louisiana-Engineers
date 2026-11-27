import { z } from "zod";
import { paging } from "@shared/limits";
import type { CreateRequest, Respond } from "@shared/schemas/request";
import { slugSchema } from "@shared/schemas/common";
import { requestStatuses, type RequestStatus } from "@shared/types/common";
import type { ContactValue } from "@shared/types/profiles";
import {
  requestRoles,
  type MenteeDetails,
  type MentorAvailability,
  type MyMentorship,
  type RequestDetail,
  type RequestsResponse,
  type RequestSummary,
  type SuggestedMentorsResponse,
} from "@shared/types/requests";
import type { Db } from "../db/tx";
import { ENTRY_COLUMNS, platformPaused, toEntry, UUID_PATTERN, type EntryRow } from "./directory";

/**
 * Mentorship requests and relationships. Every transition is one SQL
 * function (`create_mentorship_request`, `cancel_request`,
 * `respond_to_request`, `complete_relationship`) that checks the caller and
 * raises `mest.<code>`; this module validates input, calls them and reads
 * back through the `my_requests` view (the caller's own requests, the other
 * party's public fields only) and the row policies. Contact values come only
 * from `get_request_handoff`.
 */

/* --------------------------------------------------------------- query */

/** One query string value (the last one when repeated). */
const single = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (Array.isArray(value) ? value[value.length - 1] : value), schema);

const intParam = (fallback: number, max: number) =>
  single(z.coerce.number().int().min(1).max(max).optional()).transform((value) => value ?? fallback);

/** `status=pending,accepted`, `status=pending&status=accepted` or `status[]=pending`. */
const statusList = z
  .preprocess((value) => {
    if (value === undefined) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => (typeof item === "string" ? item.split(",") : [item])).filter((item) => item !== "");
  }, z.array(z.enum(requestStatuses)).max(requestStatuses.length))
  .transform((items) => [...new Set(items)]);

export const requestListQuerySchema = z.object({
  role: single(z.enum(requestRoles).optional()),
  status: statusList,
  page: intParam(1, 10_000),
  size: intParam(paging.defaultSize, paging.maxSize),
});
export type RequestListQuery = z.output<typeof requestListQuerySchema>;

export const suggestedQuerySchema = z.object({ topic: single(slugSchema.optional()) });

/** Hono's `c.req.queries()` keeps repeats; `status[]` is read as `status`. */
export function readListQuery(url: string): Record<string, string | string[]> {
  const params = new URL(url).searchParams;
  const out: Record<string, string | string[]> = {};
  for (const [rawKey, value] of params) {
    const key = rawKey.endsWith("[]") ? rawKey.slice(0, -2) : rawKey;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}

/* ---------------------------------------------------------------- rows */

interface RequestRow {
  id: string;
  role: RequestSummary["role"];
  kind: RequestSummary["kind"];
  status: RequestStatus;
  topic_id: string | null;
  topic_label: string | null;
  mentee_id: string;
  mentor_id: string;
  counterparty_id: string;
  counterparty_kind: RequestSummary["counterparty"]["kind"];
  counterparty_first_name: string | null;
  counterparty_last_name: string | null;
  counterparty_credentials: string | null;
  counterparty_title: string | null;
  counterparty_organization: string | null;
  counterparty_former: boolean;
  format: RequestSummary["format"];
  mode: RequestSummary["mode"];
  created_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
}

interface DetailRow extends RequestRow {
  why: string;
  goals: string | null;
  scheduling_note: string | null;
  mentor_note: string | null;
  decline_reason: RequestDetail["declineReason"];
  text_purged: boolean;
  relationship_id: string | null;
  completed_by: string | null;
  shared_methods: string[];
}

const SUMMARY_COLUMNS = `
  r.id, r.role, r.kind::text AS kind, r.status::text AS status, r.topic_id, r.topic_label,
  r.mentee_id, r.mentor_id, r.counterparty_id, r.counterparty_kind::text AS counterparty_kind,
  r.counterparty_first_name, r.counterparty_last_name, r.counterparty_credentials,
  r.counterparty_title, r.counterparty_organization, r.counterparty_former,
  r.format::text AS format, r.mode::text AS mode, r.created_at, r.expires_at, r.responded_at,
  r.started_at, r.completed_at`;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toSummary(row: RequestRow): RequestSummary {
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    status: row.status,
    topicId: row.topic_id,
    topicLabel: row.topic_label,
    counterparty: {
      id: row.counterparty_id,
      kind: row.counterparty_kind,
      firstName: row.counterparty_first_name,
      lastName: row.counterparty_last_name,
      credentials: row.counterparty_credentials,
      title: row.counterparty_title,
      organization: row.counterparty_organization,
      former: row.counterparty_former,
    },
    format: row.format,
    mode: row.mode,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    respondedAt: iso(row.responded_at),
    completedAt: iso(row.completed_at),
  };
}

/* ---------------------------------------------------------------- reads */

/**
 * `GET /api/requests`: the caller's requests, newest first. The mentor's
 * pending inbox alone reads oldest first (the one closest to expiry on
 * top, 03 section 7.1).
 */
export async function listRequests(db: Db, query: RequestListQuery): Promise<RequestsResponse> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.role) {
    params.push(query.role);
    where.push(`r.role = $${params.length}`);
  }
  if (query.status.length) {
    params.push(query.status);
    where.push(`r.status::text = ANY ($${params.length}::text[])`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const oldestFirst = query.role === "mentor" && query.status.length === 1 && query.status[0] === "pending";
  const order = oldestFirst ? "r.created_at ASC, r.id" : "r.created_at DESC, r.id";

  const { total } = await db.one<{ total: number }>(`SELECT count(*)::int AS total FROM my_requests r ${whereSql}`, params);
  params.push(query.size, (query.page - 1) * query.size);
  const rows = await db.query<RequestRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM my_requests r ${whereSql}
      ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toSummary), total };
}

interface StudentRow {
  program: string;
  level: MenteeDetails["level"];
  institution: string;
  goals: string;
  interests: string[];
  topics_needed: string[];
}

/**
 * `GET /api/requests/:id` for one of its parties; null for anyone else (and
 * for a malformed id). The mentor gets a student mentee's details while the
 * request is open (the counterparty policy on `student_details` decides);
 * the mentee of an accepted request gets the handoff, which
 * `get_request_handoff` resolves and logs.
 */
export async function getRequest(db: Db, id: string): Promise<RequestDetail | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const row = await db.maybeOne<DetailRow>(
    `SELECT ${SUMMARY_COLUMNS}, r.why, r.goals, r.scheduling_note, r.mentor_note, r.decline_reason,
            r.text_purged, r.relationship_id, r.completed_by, r.shared_methods
       FROM my_requests r
      WHERE r.id = $1`,
    [id],
  );
  if (!row) return null;

  const callerId = row.role === "mentee" ? row.mentee_id : row.mentor_id;
  let mentee: MenteeDetails | null = null;
  if (row.role === "mentor") {
    const student = await db.maybeOne<StudentRow>(
      `SELECT program, level::text AS level, institution, goals, interests, topics_needed
         FROM student_details WHERE profile_id = $1`,
      [row.mentee_id],
    );
    if (student) {
      mentee = {
        program: student.program,
        level: student.level,
        institution: student.institution,
        goals: student.goals,
        interests: student.interests,
        topicsNeeded: student.topics_needed,
      };
    }
  }

  const detail: RequestDetail = {
    ...toSummary(row),
    why: row.why,
    goals: row.goals,
    schedulingNote: row.scheduling_note,
    mentorNote: row.mentor_note,
    declineReason: row.decline_reason,
    textPurged: row.text_purged,
    relationship:
      row.relationship_id && row.started_at
        ? {
            startedAt: row.started_at.toISOString(),
            completedAt: iso(row.completed_at),
            completedBy: row.completed_by === null ? null : row.completed_by === callerId ? "me" : "them",
            sharedMethods: row.shared_methods as NonNullable<RequestDetail["relationship"]>["sharedMethods"],
          }
        : null,
    mentee,
  };

  // A suspended or deleting member still reads their history, without contact values.
  if (row.role === "mentee" && row.status === "accepted" && (await db.one<{ ok: boolean }>("SELECT is_member() AS ok")).ok) {
    const methods = await db.query<ContactValue>(
      "SELECT h.method::text AS method, h.value FROM get_request_handoff($1) AS h",
      [id],
    );
    detail.handoff = { methods };
  }
  return detail;
}

/* ---------------------------------------------------------- transitions */

/** `POST /api/requests`: the new request's id. */
export async function createRequest(db: Db, input: CreateRequest): Promise<string> {
  const row = await db.one<{ id: string }>(
    `SELECT create_mentorship_request($1, $2::request_kind, $3, $4, $5, $6::mentoring_format, $7::meeting_mode, $8) AS id`,
    [
      input.mentorId,
      input.kind,
      input.kind === "mentorship" ? (input.topicId ?? null) : null,
      input.why,
      input.goals ?? null,
      input.format,
      input.mode,
      input.schedulingNote ?? null,
    ],
  );
  return row.id;
}

export async function cancelRequest(db: Db, id: string): Promise<void> {
  await db.query("SELECT cancel_request($1)", [id]);
}

export async function respondToRequest(db: Db, id: string, answer: Respond): Promise<void> {
  if (answer.decision === "accept") {
    await db.query("SELECT respond_to_request($1, 'accept', $2, NULL, $3::contact_method[])", [
      id,
      answer.note ?? null,
      answer.shareMethods,
    ]);
  } else {
    await db.query("SELECT respond_to_request($1, 'decline', $2, $3, NULL)", [id, answer.note ?? null, answer.declineReason]);
  }
}

export async function completeRelationship(db: Db, id: string): Promise<void> {
  await db.query("SELECT complete_relationship($1)", [id]);
}

/* ------------------------------------------------------- availability */

/** `GET /api/mentors/:id/availability`; null when the caller cannot see the profile. */
export async function mentorAvailability(db: Db, id: string): Promise<MentorAvailability | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const row = await db.maybeOne<{ state: MentorAvailability["state"]; resume_on: string | null }>(
    "SELECT a.state, to_char(a.resume_on, 'YYYY-MM-DD') AS resume_on FROM mentor_availability($1) AS a",
    [id],
  );
  if (!row) return null;
  return row.resume_on ? { state: row.state, resumeOn: row.resume_on } : { state: row.state };
}

/** `GET /api/me/mentorship`. */
export async function myMentorship(db: Db): Promise<MyMentorship> {
  const row = await db.maybeOne<{
    status: MyMentorship["status"];
    max_active: number | null;
    active_count: number;
    pending_incoming: number;
    pending_outgoing: number;
  }>(
    `SELECT s.status::text AS status, s.max_active, s.active_count, s.pending_incoming, s.pending_outgoing
       FROM my_mentorship_summary() AS s`,
  );
  return {
    status: row?.status ?? null,
    maxActive: row?.max_active ?? null,
    activeCount: row?.active_count ?? 0,
    pendingIncoming: row?.pending_incoming ?? 0,
    pendingOutgoing: row?.pending_outgoing ?? 0,
  };
}

/**
 * `GET /api/me/suggested-mentors`: up to three mentors taking requests now,
 * ranked by how many of the caller's needed topics they offer (and the
 * `topic` asked about, when given), then whether they take the caller's
 * level, then recent activity. Mentors the caller already has an open
 * request or relationship with are left out, as is the caller.
 */
export async function suggestedMentors(db: Db, topic?: string): Promise<SuggestedMentorsResponse> {
  if (await platformPaused(db)) return { items: [] };
  const rows = await db.query<EntryRow & { score: number }>(
    `WITH me AS (
       SELECT coalesce((SELECT s.topics_needed FROM student_details s WHERE s.profile_id = app_uid()), '{}') AS topics,
              (SELECT s.level::text FROM student_details s WHERE s.profile_id = app_uid()) AS level
     )
     SELECT ${ENTRY_COLUMNS},
            (2 * cardinality(ARRAY(SELECT unnest(e.mentor_topics) INTERSECT SELECT unnest(me.topics)))
             + CASE WHEN me.level IS NOT NULL AND me.level = ANY (e.audience) THEN 1 ELSE 0 END
             + CASE WHEN $1::text IS NOT NULL AND $1::text = ANY (e.mentor_topics) THEN 3 ELSE 0 END)::int AS score
       FROM directory_entries e, me
      WHERE e.mentor_status = 'active' AND e.has_capacity AND e.id <> app_uid()
        AND NOT EXISTS (
          SELECT 1 FROM mentorship_requests r
           WHERE r.mentee_id = app_uid() AND r.mentor_id = e.id AND r.status IN ('pending', 'accepted')
        )
      ORDER BY score DESC, e.last_active_at DESC NULLS LAST, e.last_name, e.id
      LIMIT 3`,
    [topic ?? null],
  );
  return { items: rows.map(toEntry) };
}
