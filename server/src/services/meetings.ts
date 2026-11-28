import { z } from "zod";
import { paging } from "@shared/limits";
import type { ChooseTime, ProposeTimes } from "@shared/schemas/meetings";
import type { ExportMeeting, ExportSlot } from "@shared/types/meetings";
import {
  meetingLogScopes,
  meetingStatuses,
  slotStatuses,
  type Meeting,
  type MeetingLogResponse,
  type MeetingsResponse,
  type ProposeTimesResponse,
  type Slot,
  type SlotsResponse,
} from "@shared/types/meetings";
import type { Db } from "../db/tx";
import { UUID_PATTERN } from "./directory";
import { counterpartyName } from "./export";

/**
 * Scheduling (Task 30). Every write is one SQL function (`propose_times`,
 * `choose_time`, `cancel_meeting`, `record_meeting_outcome`) that checks the
 * caller and raises `mest.<code>`; this module finds the relationship the
 * caller is a party to from the request id in the URL, calls them, and
 * reads back through the row policies (slots) and the `my_meetings` view
 * (meetings, with the other party's name only).
 */

/* --------------------------------------------------------------- query */

/** One query string value (the last one when repeated). */
const single = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (Array.isArray(value) ? value[value.length - 1] : value), schema);

const intParam = (fallback: number, max: number) =>
  single(z.coerce.number().int().min(1).max(max).optional()).transform((value) => value ?? fallback);

/** `status=a,b`, `status=a&status=b` or `status[]=a`, over a fixed list. */
function statusList<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess((value) => {
      if (value === undefined) return [];
      const items = Array.isArray(value) ? value : [value];
      return items.flatMap((item) => (typeof item === "string" ? item.split(",") : [item])).filter((item) => item !== "");
    }, z.array(z.enum(values)).max(values.length))
    .transform((items) => [...new Set(items)]);
}

const pageParams = {
  page: intParam(1, 10_000),
  size: intParam(paging.defaultSize, paging.maxSize),
};

export const slotListQuerySchema = z.object({ status: statusList(slotStatuses), ...pageParams });
export type SlotListQuery = z.output<typeof slotListQuerySchema>;

export const meetingListQuerySchema = z.object({ status: statusList(meetingStatuses), ...pageParams });
export type MeetingListQuery = z.output<typeof meetingListQuerySchema>;

export const meetingLogQuerySchema = z.object({
  when: single(z.enum(meetingLogScopes).optional()).transform((value) => value ?? "upcoming"),
  ...pageParams,
});
export type MeetingLogQuery = z.output<typeof meetingLogQuerySchema>;

/* ---------------------------------------------------------------- rows */

interface SlotRow {
  id: string;
  batch_id: string;
  mine: boolean;
  starts_at: Date;
  ends_at: Date;
  status: Slot["status"];
  created_at: Date;
}

const SLOT_COLUMNS = `s.id, s.batch_id, s.proposed_by = app_uid() AS mine, s.starts_at, s.ends_at,
  s.status::text AS status, s.created_at`;

function toSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    batchId: row.batch_id,
    proposedBy: row.mine ? "me" : "them",
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    durationMin: Math.round((row.ends_at.getTime() - row.starts_at.getTime()) / 60_000),
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

interface MeetingRow {
  id: string;
  request_id: string;
  role: Meeting["role"];
  kind: Meeting["kind"];
  topic_label: string | null;
  counterparty_first_name: string | null;
  counterparty_last_name: string | null;
  counterparty_former: boolean;
  starts_at: Date;
  ends_at: Date;
  duration_min: number;
  mode: Meeting["mode"];
  place: string;
  agenda: string;
  status: Meeting["status"];
  created_by_me: boolean;
  met: boolean | null;
  outcome_by_me: boolean | null;
  outcome_at: Date | null;
  canceled_by_me: boolean | null;
  canceled_at: Date | null;
  awaiting_outcome: boolean;
  created_at: Date;
}

const MEETING_COLUMNS = `m.id, m.request_id, m.role, m.kind::text AS kind, m.topic_label,
  m.counterparty_first_name, m.counterparty_last_name, m.counterparty_former,
  m.starts_at, m.ends_at, m.duration_min, m.mode::text AS mode, m.place, m.agenda, m.status::text AS status,
  m.created_by_me, m.met, m.outcome_by_me, m.outcome_at, m.canceled_by_me, m.canceled_at,
  (m.status <> 'canceled' AND m.met IS NULL AND m.starts_at <= now()) AS awaiting_outcome,
  m.created_at`;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const side = (mine: boolean | null): "me" | "them" | null => (mine === null ? null : mine ? "me" : "them");

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    requestId: row.request_id,
    role: row.role,
    kind: row.kind,
    topicLabel: row.topic_label,
    counterparty: {
      firstName: row.counterparty_first_name,
      lastName: row.counterparty_last_name,
      former: row.counterparty_former,
    },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    durationMin: row.duration_min,
    mode: row.mode,
    place: row.place,
    agenda: row.agenda,
    status: row.status,
    createdBy: row.created_by_me ? "me" : "them",
    met: row.met,
    outcomeBy: side(row.outcome_by_me),
    outcomeAt: iso(row.outcome_at),
    canceledBy: side(row.canceled_by_me),
    canceledAt: iso(row.canceled_at),
    awaitingOutcome: row.awaiting_outcome,
    createdAt: row.created_at.toISOString(),
  };
}

/* ------------------------------------------------------- relationships */

/**
 * The relationship of an accepted (or completed) request the caller is a
 * party to, or null: for anyone else, an administrator included, the
 * relationship does not exist here.
 */
export async function relationshipOf(db: Db, requestId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(requestId)) return null;
  const row = await db.maybeOne<{ id: string }>(
    `SELECT rel.id FROM mentorship_relationships rel
      WHERE rel.request_id = $1 AND app_uid() IN (rel.mentee_id, rel.mentor_id)`,
    [requestId],
  );
  return row?.id ?? null;
}

/* ---------------------------------------------------------------- slots */

/** The relationship's proposed times: open ones first, then newest proposals first. */
export async function listSlots(db: Db, relationshipId: string, query: SlotListQuery): Promise<SlotsResponse> {
  const params: unknown[] = [relationshipId, query.status];
  const where = "s.relationship_id = $1 AND (cardinality($2::text[]) = 0 OR s.status::text = ANY ($2::text[]))";
  const { total } = await db.one<{ total: number }>(`SELECT count(*)::int AS total FROM availability_slots s WHERE ${where}`, params);
  const rows = await db.query<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM availability_slots s WHERE ${where}
      ORDER BY (s.status = 'proposed') DESC, s.created_at DESC, s.starts_at, s.id
      LIMIT $3 OFFSET $4`,
    [...params, query.size, (query.page - 1) * query.size],
  );
  return { items: rows.map(toSlot), total };
}

/** `propose_times`, then the new proposal's times in start order. */
export async function proposeTimes(db: Db, relationshipId: string, input: ProposeTimes): Promise<ProposeTimesResponse> {
  const slots = input.slots.map((s) => ({ starts_at: s.startsAt, ends_at: s.endsAt }));
  const { batch } = await db.one<{ batch: string }>("SELECT propose_times($1, $2::jsonb) AS batch", [
    relationshipId,
    JSON.stringify(slots),
  ]);
  const rows = await db.query<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM availability_slots s WHERE s.batch_id = $1 ORDER BY s.starts_at, s.id`,
    [batch],
  );
  return { batchId: batch, items: rows.map(toSlot) };
}

/* -------------------------------------------------------------- meetings */

export async function getMeeting(db: Db, meetingId: string): Promise<Meeting | null> {
  if (!UUID_PATTERN.test(meetingId)) return null;
  const row = await db.maybeOne<MeetingRow>(`SELECT ${MEETING_COLUMNS} FROM my_meetings m WHERE m.id = $1`, [meetingId]);
  return row ? toMeeting(row) : null;
}

/** The relationship's meetings, newest first. */
export async function listRelationshipMeetings(db: Db, relationshipId: string, query: MeetingListQuery): Promise<MeetingsResponse> {
  const params: unknown[] = [relationshipId, query.status];
  const where = "m.relationship_id = $1 AND (cardinality($2::text[]) = 0 OR m.status::text = ANY ($2::text[]))";
  const { total } = await db.one<{ total: number }>(`SELECT count(*)::int AS total FROM my_meetings m WHERE ${where}`, params);
  const rows = await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM my_meetings m WHERE ${where}
      ORDER BY m.starts_at DESC, m.id LIMIT $3 OFFSET $4`,
    [...params, query.size, (query.page - 1) * query.size],
  );
  return { items: rows.map(toMeeting), total };
}

/**
 * `GET /api/meetings`: the caller's meetings in both roles. `upcoming` is
 * meetings still to come, soonest first; `past` is every other one, most
 * recent first.
 */
export async function meetingLog(db: Db, query: MeetingLogQuery): Promise<MeetingLogResponse> {
  const upcoming = "m.status = 'upcoming' AND m.starts_at > now()";
  const where = query.when === "upcoming" ? upcoming : `NOT (${upcoming})`;
  const order = query.when === "upcoming" ? "m.starts_at ASC, m.id" : "m.starts_at DESC, m.id";
  const { total } = await db.one<{ total: number }>(`SELECT count(*)::int AS total FROM my_meetings m WHERE ${where}`);
  const rows = await db.query<MeetingRow>(
    `SELECT ${MEETING_COLUMNS} FROM my_meetings m WHERE ${where} ORDER BY ${order} LIMIT $1 OFFSET $2`,
    [query.size, (query.page - 1) * query.size],
  );
  return { items: rows.map(toMeeting), total };
}

/**
 * Whether the slot belongs to the relationship (read under the policy, so
 * only a party finds it). A slot id from another relationship is treated as
 * missing rather than handed to `choose_time`.
 */
export async function slotInRelationship(db: Db, relationshipId: string, slotId: string): Promise<boolean> {
  const row = await db.maybeOne<{ ok: boolean }>(
    "SELECT true AS ok FROM availability_slots s WHERE s.id = $1 AND s.relationship_id = $2",
    [slotId, relationshipId],
  );
  return row !== null;
}

/** `choose_time`; the new meeting's id. */
export async function chooseTime(db: Db, input: ChooseTime): Promise<string> {
  const { id } = await db.one<{ id: string }>("SELECT choose_time($1, $2::meeting_mode, $3, $4) AS id", [
    input.slotId,
    input.mode,
    input.place ?? null,
    input.agenda ?? null,
  ]);
  return id;
}

export async function cancelMeeting(db: Db, meetingId: string): Promise<void> {
  await db.query("SELECT cancel_meeting($1)", [meetingId]);
}

export async function recordOutcome(db: Db, meetingId: string, met: boolean): Promise<void> {
  await db.query("SELECT record_meeting_outcome($1, $2)", [meetingId, met]);
}

/* ---------------------------------------------------------------- export */

/**
 * The caller's meetings and proposed times for the personal data export,
 * with the other party as a display name only. Meetings come from
 * `my_meetings`; slots under their policy, joined to `my_requests` for the
 * name, so both are the caller's own relationships and nothing else.
 */
export async function exportMeetings(db: Db): Promise<{ meetings: ExportMeeting[]; availabilitySlots: ExportSlot[] }> {
  const meetings = await db.query<MeetingRow>(`SELECT ${MEETING_COLUMNS} FROM my_meetings m ORDER BY m.starts_at, m.id`);
  const slots = await db.query<
    SlotRow & {
      request_id: string;
      role: ExportSlot["role"];
      counterparty_first_name: string | null;
      counterparty_last_name: string | null;
      counterparty_former: boolean;
    }
  >(
    `SELECT ${SLOT_COLUMNS}, r.id AS request_id, r.role, r.counterparty_first_name, r.counterparty_last_name,
            r.counterparty_former
       FROM availability_slots s
       JOIN my_requests r ON r.relationship_id = s.relationship_id
      ORDER BY s.created_at, s.starts_at, s.id`,
  );
  return {
    meetings: meetings.map((row) => ({
      requestId: row.request_id,
      role: row.role,
      counterparty: counterpartyName(row.counterparty_first_name, row.counterparty_last_name, row.counterparty_former),
      startsAt: row.starts_at.toISOString(),
      durationMin: row.duration_min,
      mode: row.mode,
      place: row.place,
      agenda: row.agenda,
      status: row.status,
      createdBy: row.created_by_me ? "me" : "them",
      met: row.met,
      canceledAt: iso(row.canceled_at),
    })),
    availabilitySlots: slots.map((row) => ({
      requestId: row.request_id,
      role: row.role,
      counterparty: counterpartyName(row.counterparty_first_name, row.counterparty_last_name, row.counterparty_former),
      proposedBy: row.mine ? "me" : "them",
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      status: row.status,
      createdAt: row.created_at.toISOString(),
    })),
  };
}
