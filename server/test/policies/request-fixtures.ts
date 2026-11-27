import type { Pool } from "../../src/db/pool";
import { asSystem, asUser } from "../harness";
import { makePerson, type PersonOptions } from "./fixtures";

/**
 * Mentors, mentees and requests for the request tests (Task 19). People are
 * arranged as the table owner, as the seed does; requests are always made
 * through the SQL functions, as a member's request would be.
 */

export interface MentorOptions extends PersonOptions {
  status?: "off" | "active" | "paused";
  pausedUntil?: string | null;
  topics?: string[];
  audience?: string[];
  maxActive?: number;
  methods?: string[];
  share?: string[];
  phone?: string | null;
  bookingUrl?: string | null;
  contactEmail?: string | null;
}

export const MENTOR_PHONE = "+15045550142";

/** An approved, public professional offering mentoring and networking, with contact preferences. */
export async function makeMentor(pool: Pool, options: MentorOptions = {}): Promise<string> {
  const id = await makePerson(pool, {
    participation: ["directory", "networking", "mentoring"],
    ...options,
  });
  await asSystem(pool, async (client) => {
    await client.query(
      `INSERT INTO mentorship_settings (profile_id, status, paused_until, audience, format, mode, max_active)
       VALUES ($1, $2, $3, $4::audience[], 'either', 'either', $5)`,
      [
        id,
        options.status ?? "active",
        options.pausedUntil ?? null,
        options.audience ?? ["undergrad", "early-career"],
        options.maxActive ?? 3,
      ],
    );
    for (const topic of options.topics ?? ["professional-licensure", "internships-and-first-jobs"]) {
      await client.query("INSERT INTO mentor_topics (profile_id, topic_id) VALUES ($1, $2)", [id, topic]);
    }
    const methods = options.methods ?? ["mest", "email", "phone"];
    await client.query(
      `INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
       VALUES ($1, $2::contact_method[], $3::contact_method[], $4, $5, $6)`,
      [
        id,
        methods,
        options.share ?? ["email"],
        options.contactEmail ?? null,
        options.phone === undefined ? (methods.includes("phone") ? MENTOR_PHONE : null) : options.phone,
        options.bookingUrl ?? (methods.includes("booking") ? "https://example.test/book" : null),
      ],
    );
  });
  return id;
}

export interface StudentOptions extends PersonOptions {
  level?: string;
  topicsNeeded?: string[];
  goals?: string;
}

export const STUDENT_GOALS = "Find a coastal internship and understand the path to a license.";

/** A student (hidden, as every student is) with details. */
export async function makeStudent(pool: Pool, options: StudentOptions = {}): Promise<string> {
  const id = await makePerson(pool, { kind: "student", visibility: "hidden", ...options });
  await asSystem(pool, async (client) => {
    await client.query(
      `INSERT INTO student_details (profile_id, program, level, institution, goals, interests, topics_needed)
       VALUES ($1, 'BS Civil Engineering, junior', $2, 'A Louisiana research university', $3, '{Hydraulics}', $4)`,
      [id, options.level ?? "undergrad", options.goals ?? STUDENT_GOALS, options.topicsNeeded ?? ["internships-and-first-jobs"]],
    );
  });
  return id;
}

export const WHY = "I am applying for summer internships and would like advice on what to highlight.";

export interface RequestArgs {
  kind?: "mentorship" | "introduction";
  topic?: string | null;
  why?: string;
  goals?: string | null;
  format?: "one-time" | "recurring";
  mode?: "online" | "in-person" | "either";
  schedulingNote?: string | null;
}

/** `create_mentorship_request` as the mentee; the new request's id. */
export async function sendRequest(pool: Pool, mentee: string, mentor: string, args: RequestArgs = {}): Promise<string> {
  const kind = args.kind ?? "mentorship";
  return asUser(pool, mentee, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT create_mentorship_request($1, $2::request_kind, $3, $4, $5, $6::mentoring_format, $7::meeting_mode, $8) AS id`,
      [
        mentor,
        kind,
        args.topic === undefined ? (kind === "mentorship" ? "internships-and-first-jobs" : null) : args.topic,
        args.why ?? WHY,
        args.goals === undefined ? "A resume that reads well to a hiring manager." : args.goals,
        args.format ?? "one-time",
        args.mode ?? "online",
        args.schedulingNote === undefined ? "Evenings after 6 PM." : args.schedulingNote,
      ],
    );
    return result.rows[0].id;
  });
}

/** `respond_to_request(..., 'accept', ...)` as the mentor. */
export function acceptRequest(pool: Pool, mentor: string, requestId: string, share: string[] = ["email"], note: string | null = null): Promise<unknown> {
  return asUser(pool, mentor, (client) =>
    client.query("SELECT respond_to_request($1, 'accept', $2, NULL, $3::contact_method[])", [requestId, note, share]),
  );
}

/** `respond_to_request(..., 'decline', ...)` as the mentor. */
export function declineRequest(pool: Pool, mentor: string, requestId: string, reason = "no_capacity"): Promise<unknown> {
  return asUser(pool, mentor, (client) =>
    client.query("SELECT respond_to_request($1, 'decline', NULL, $2, NULL)", [requestId, reason]),
  );
}

/** The request's status, read as the owner. */
export async function requestStatus(pool: Pool, requestId: string): Promise<string> {
  const result = await pool.query<{ status: string }>("SELECT status::text AS status FROM mentorship_requests WHERE id = $1", [
    requestId,
  ]);
  return result.rows[0]?.status;
}

/** Sets one config key as the owner (tests only; administrators use admin_update_config). */
export async function setConfig(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query("UPDATE config SET value = $2::jsonb WHERE key = $1", [key, JSON.stringify(value)]);
}

/** The config the migration seeds, restored between tests. */
export async function resetRequestConfig(pool: Pool): Promise<void> {
  await setConfig(pool, "platform_paused", false);
  await setConfig(pool, "pending_cap", 3);
  await setConfig(pool, "daily_request_limit", 5);
  await setConfig(pool, "request_expiry_days", 14);
  await setConfig(pool, "reminder_days", [5, 10]);
}
