import type { Pool } from "../../src/db/pool";
import { asUser } from "../harness";
import { acceptRequest, makeMentor, makeStudent, sendRequest } from "./request-fixtures";

/**
 * Pairs, proposals and meetings for the scheduling tests (Task 30). The
 * pair is made through the request functions (a student asks, the mentor
 * accepts); slots and meetings only ever through the scheduling functions.
 */

export interface Pair {
  mentor: string;
  mentee: string;
  requestId: string;
  relationshipId: string;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** An accepted mentorship between a new mentor and a new student. */
export async function makePair(pool: Pool, names: { mentor?: string; mentee?: string } = {}): Promise<Pair> {
  const mentor = await makeMentor(pool, { firstName: names.mentor ?? "Layla", lastName: "Haddad" });
  const mentee = await makeStudent(pool, { firstName: names.mentee ?? "Amina", lastName: "Rahman" });
  const requestId = await sendRequest(pool, mentee, mentor);
  await acceptRequest(pool, mentor, requestId);
  const rel = await pool.query<{ id: string }>("SELECT id FROM mentorship_relationships WHERE request_id = $1", [requestId]);
  return { mentor, mentee, requestId, relationshipId: rel.rows[0].id };
}

/** A time `hoursAhead` from now, `minutes` long, rounded to the minute. */
export function slotAt(hoursAhead: number, minutes = 45): { starts_at: string; ends_at: string } {
  const start = new Date(Math.floor((Date.now() + hoursAhead * HOUR) / 60_000) * 60_000);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

/** `propose_times` as `userId`; the batch id. */
export function proposeAs(pool: Pool, userId: string, relationshipId: string, slots: unknown): Promise<string> {
  return asUser(pool, userId, async (client) => {
    const result = await client.query<{ batch: string }>("SELECT propose_times($1, $2::jsonb) AS batch", [
      relationshipId,
      JSON.stringify(slots),
    ]);
    return result.rows[0].batch;
  });
}

/** `choose_time` as `userId`; the meeting id. */
export function chooseAs(
  pool: Pool,
  userId: string,
  slotId: string,
  options: { mode?: string; place?: string | null; agenda?: string | null } = {},
): Promise<string> {
  return asUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>("SELECT choose_time($1, $2::meeting_mode, $3, $4) AS id", [
      slotId,
      options.mode ?? "online",
      options.place === undefined ? "Video call (link shared by Layla)" : options.place,
      options.agenda === undefined ? "Internship applications and a resume review." : options.agenda,
    ]);
    return result.rows[0].id;
  });
}

/** The slots of a batch, read as the owner, in start order. */
export async function slotsOf(pool: Pool, batchId: string): Promise<{ id: string; status: string }[]> {
  const result = await pool.query<{ id: string; status: string }>(
    "SELECT id, status::text AS status FROM availability_slots WHERE batch_id = $1 ORDER BY starts_at, id",
    [batchId],
  );
  return result.rows;
}

/**
 * Moves a meeting (and its slot) into the past by `hoursAgo`, as the owner:
 * the functions refuse past times, so tests that need a meeting that
 * already happened schedule it ahead and then shift the clock back.
 */
export async function shiftMeetingIntoPast(pool: Pool, meetingId: string, hoursAgo: number): Promise<Date> {
  const result = await pool.query<{ starts_at: Date }>(
    `UPDATE meetings SET starts_at = now() - make_interval(secs => $2::double precision * 3600)
      WHERE id = $1 RETURNING starts_at`,
    [meetingId, hoursAgo],
  );
  return result.rows[0].starts_at;
}

/** A meeting's status and outcome, read as the owner. */
export async function meetingRow(
  pool: Pool,
  meetingId: string,
): Promise<{ status: string; met: boolean | null; place: string; agenda: string; check_in_sent_at: Date | null }> {
  const result = await pool.query(
    "SELECT status::text AS status, met, place, agenda, check_in_sent_at FROM meetings WHERE id = $1",
    [meetingId],
  );
  return result.rows[0];
}
