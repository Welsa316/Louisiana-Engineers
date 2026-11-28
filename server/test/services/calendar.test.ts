import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CalendarFeedResponse, CreatedCalendarFeedResponse } from "@shared/types/calendar";
import type { DataExport } from "@shared/types/export";
import { createSession, newSecret, sha256Hex } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { calendarRoutes, meCalendarRoutes } from "../../src/routes/calendar";
import { exportRoutes } from "../../src/routes/export";
import { escapeText, foldLine, renderCalendar, type CalendarEvent } from "../../src/services/calendar";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs } from "../policies/fixtures";
import { chooseAs, makePair, proposeAs, shiftMeetingIntoPast, slotAt, type Pair } from "../policies/meeting-fixtures";
import { MENTOR_PHONE, resetRequestConfig } from "../policies/request-fixtures";

/**
 * The calendar feed (Task 37): a private iCalendar address per member.
 * `/api/me/calendar` turns it on, gives it a new address or turns it off;
 * `/api/calendar/:token.ics` serves it to a calendar app with no session,
 * through `calendar_feed` as app_user. Only the token's sha256 is stored.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  await resetRequestConfig(db.pool);
  cookies.clear();
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(new Hono().route("/me", meCalendarRoutes).route("/calendar", calendarRoutes).route("/me", exportRoutes));

const cookies = new Map<string, string>();
async function cookieFor(userId: string): Promise<string> {
  const known = cookies.get(userId);
  if (known) return known;
  const value = await asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
  cookies.set(userId, value);
  return value;
}

interface Answer {
  status: number;
  headers: Headers;
  text: string;
  body: any;
}

async function call(userId: string | null, method: string, path: string, options: { origin?: string | null } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.origin = origin;
  if (userId) headers.cookie = `mest_session=${await cookieFor(userId)}`;
  const res = await app.request(`/api${path}`, { method, headers });
  const text = await res.text();
  const json = (res.headers.get("content-type") ?? "").startsWith("application/json") && text ? JSON.parse(text) : null;
  return { status: res.status, headers: res.headers, text, body: json };
}

/** Turns the member's feed on (or renews it); the answer and the path of the address. */
async function createFeed(userId: string): Promise<{ answer: CreatedCalendarFeedResponse; path: string; token: string }> {
  const res = await call(userId, "POST", "/me/calendar");
  expect(res.status).toBe(201);
  const answer = res.body as CreatedCalendarFeedResponse;
  const url = new URL(answer.url);
  const match = /^\/api\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(url.pathname);
  expect(match).not.toBeNull();
  return { answer, path: url.pathname.replace(/^\/api/, ""), token: match![1] };
}

/** The feed as a calendar app fetches it: no cookie, no origin. */
function fetchFeed(path: string): Promise<Answer> {
  return call(null, "GET", path, { origin: null });
}

/** Physical lines joined back into content lines (RFC 5545 section 3.1). */
function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").split("\r\n").filter((line) => line !== "");
}

/** Each VEVENT as a map of property name (parameters dropped) to value. */
function events(text: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) found.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      current[line.slice(0, colon).split(";")[0]] = line.slice(colon + 1);
    }
  }
  return found;
}

const AGENDA = "Internship applications and a resume review.";
const PLACE = "Video call (link shared by Layla)";

/** A pair with one meeting `hoursAhead` from now, the mentor proposing and the mentee choosing. */
async function pairWithMeeting(names: { mentor?: string; mentee?: string } = {}, hoursAhead = 48): Promise<Pair & { meetingId: string }> {
  const pair = await makePair(db.pool, names);
  const batch = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(hoursAhead)]);
  const slot = await db.pool.query<{ id: string }>("SELECT id FROM availability_slots WHERE batch_id = $1", [batch]);
  const meetingId = await chooseAs(db.pool, pair.mentee, slot.rows[0].id, { place: PLACE, agenda: AGENDA });
  return { ...pair, meetingId };
}

async function deleteAccount(profileId: string): Promise<boolean> {
  return asSystem(db.pool, async (client) => {
    const d = await client.query<{ id: string }>(
      `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility, immediate)
       VALUES ($1, now() - interval '1 minute', 'hidden', true) RETURNING id`,
      [profileId],
    );
    return (await client.query<{ done: boolean }>("SELECT execute_account_deletion($1, now()) AS done", [d.rows[0].id])).rows[0].done;
  });
}

/* ------------------------------------------------------------ the format */

const EVENT: CalendarEvent = {
  id: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  requestId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  role: "mentee",
  otherFirstName: "Layla",
  otherFormer: false,
  startsAt: new Date("2026-12-01T15:00:00Z"),
  durationMin: 45,
  mode: "online",
  status: "upcoming",
  createdAt: new Date("2026-11-20T10:00:00Z"),
  updatedAt: new Date("2026-11-21T09:30:05Z"),
};

describe("iCalendar text (RFC 5545)", () => {
  it("escapes_backslash_semicolon_comma_and_newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
    // Other control characters are not allowed in TEXT and are dropped; a tab stays.
    expect(escapeText("x\u0000y\u0007z\tw")).toBe("xyz\tw");
  });

  it("folds_lines_over_75_octets_without_splitting_a_character", () => {
    const line = `SUMMARY:MEST mentorship: ${"é".repeat(40)}${"x".repeat(30)}ü`;
    const folded = foldLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const [index, piece] of physical.entries()) {
      expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(75);
      if (index > 0) expect(piece.startsWith(" ")).toBe(true);
      // A piece that cut a two-byte character in half would not survive a round trip.
      expect(Buffer.from(piece, "utf8").toString("utf8")).toBe(piece);
      expect(piece).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    // A short line is left alone.
    expect(foldLine("VERSION:2.0")).toBe("VERSION:2.0");
  });

  it("renders_crlf_lines_utc_times_and_one_event_per_meeting", () => {
    const text = renderCalendar([EVENT, { ...EVENT, id: "7f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", status: "canceled", role: "mentor" }], {
      origin: ORIGIN,
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // Every line break is CRLF.
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = unfold(text);
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((line) => line.startsWith("PRODID:"))).toBe(true);

    const [first, second] = events(text);
    expect(first.UID).toBe(`${EVENT.id}@127.0.0.1`);
    expect(first.DTSTART).toBe("20261201T150000Z");
    expect(first.DTEND).toBe("20261201T154500Z");
    expect(first.DTSTAMP).toBe("20261121T093005Z");
    expect(first.SUMMARY).toBe("MEST mentorship: Layla");
    expect(first.STATUS).toBe("CONFIRMED");
    expect(first.URL).toBe(`${ORIGIN}/network/me/requests/${EVENT.requestId}`);
    expect(second.STATUS).toBe("CANCELLED");
    expect(second.URL).toBe(`${ORIGIN}/network/mentor/mentees/${EVENT.requestId}`);
  });

  it("names_a_deleted_account_former_member", () => {
    const [event] = events(renderCalendar([{ ...EVENT, otherFirstName: "Former", otherFormer: true }], { origin: ORIGIN }));
    expect(event.SUMMARY).toBe("MEST mentorship: Former member");
  });
});

/* -------------------------------------------------------------- the feed */

describe("GET /api/calendar/:token.ics", () => {
  it("feed_shows_only_the_callers_meetings", async () => {
    const mine = await pairWithMeeting({ mentor: "Layla", mentee: "Amina" });
    const theirs = await pairWithMeeting({ mentor: "Omar", mentee: "Sara" });

    const menteeFeed = await createFeed(mine.mentee);
    const res = await fetchFeed(menteeFeed.path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/calendar; charset=utf-8/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const found = events(res.text);
    expect(found.map((e) => e.UID)).toEqual([`${mine.meetingId}@127.0.0.1`]);
    expect(found[0].SUMMARY).toBe("MEST mentorship: Layla");
    expect(res.text).not.toContain(theirs.meetingId);
    expect(res.text).not.toContain("Omar");
    expect(res.text).not.toContain("Sara");

    // The mentor's own feed names the mentee.
    const mentorFeed = await createFeed(mine.mentor);
    const mentorEvents = events((await fetchFeed(mentorFeed.path)).text);
    expect(mentorEvents.map((e) => e.SUMMARY)).toEqual(["MEST mentorship: Amina"]);
    expect(mentorEvents[0].URL).toBe(`${ORIGIN}/network/mentor/mentees/${mine.requestId}`);

    // A session does not widen it: the address alone decides whose meetings these are.
    const withCookie = await call(theirs.mentee, "GET", menteeFeed.path);
    expect(events(withCookie.text).map((e) => e.UID)).toEqual([`${mine.meetingId}@127.0.0.1`]);
  });

  it("feed_carries_no_agenda_place_last_name_or_contact_value", async () => {
    const pair = await pairWithMeeting();
    const { path } = await createFeed(pair.mentee);
    const text = (await fetchFeed(path)).text;
    const flat = text.replace(/\r\n /g, "");
    expect(flat).not.toContain("Internship applications");
    expect(flat).not.toContain("Video call");
    expect(flat).not.toContain("Haddad");
    expect(flat).not.toContain(MENTOR_PHONE);
    expect(flat).not.toContain("@example.test");
    expect(flat).not.toMatch(/^(LOCATION|ATTENDEE|ORGANIZER|CONTACT)[;:]/m);
  });

  it("escapes_a_first_name_per_rfc_5545", async () => {
    const pair = await pairWithMeeting({ mentor: "Layla, Jr; \\ Q" });
    const { path } = await createFeed(pair.mentee);
    const [event] = events((await fetchFeed(path)).text);
    expect(event.SUMMARY).toBe("MEST mentorship: Layla\\, Jr\\; \\\\ Q");
  });

  it("holds_upcoming_and_recent_meetings_and_marks_cancellations", async () => {
    const pair = await makePair(db.pool);
    const batch = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(24), slotAt(48), slotAt(72)]);
    const slots = await db.pool.query<{ id: string }>("SELECT id FROM availability_slots WHERE batch_id = $1 ORDER BY starts_at", [batch]);
    const recent = await chooseAs(db.pool, pair.mentee, slots.rows[0].id);
    const old = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(30)]).then(async (b) => {
      const s = await db.pool.query<{ id: string }>("SELECT id FROM availability_slots WHERE batch_id = $1", [b]);
      return chooseAs(db.pool, pair.mentee, s.rows[0].id);
    });
    const canceled = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(96)]).then(async (b) => {
      const s = await db.pool.query<{ id: string }>("SELECT id FROM availability_slots WHERE batch_id = $1", [b]);
      return chooseAs(db.pool, pair.mentee, s.rows[0].id);
    });
    await asUser(db.pool, pair.mentor, (client) => client.query("SELECT cancel_meeting($1)", [canceled]));
    await shiftMeetingIntoPast(db.pool, recent, 3 * 24);
    await shiftMeetingIntoPast(db.pool, old, 60 * 24);

    const { path } = await createFeed(pair.mentee);
    const found = events((await fetchFeed(path)).text);
    const byId = new Map(found.map((e) => [e.UID.split("@")[0], e]));
    expect(byId.has(recent)).toBe(true);
    expect(byId.has(old)).toBe(false);
    expect(byId.get(canceled)?.STATUS).toBe("CANCELLED");
    expect(byId.get(recent)?.STATUS).toBe("CONFIRMED");
    expect(found.length).toBe(2);
  });

  it("revoked_token_is_404", async () => {
    const pair = await pairWithMeeting();
    const first = await createFeed(pair.mentee);
    expect((await fetchFeed(first.path)).status).toBe(200);

    // A new address revokes the old one.
    const second = await createFeed(pair.mentee);
    expect(second.token).not.toBe(first.token);
    const stale = await fetchFeed(first.path);
    expect(stale.status).toBe(404);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect((await fetchFeed(second.path)).status).toBe(200);

    // Turning the feed off revokes the current one.
    const off = await call(pair.mentee, "DELETE", "/me/calendar");
    expect(off.status).toBe(200);
    expect((off.body as CalendarFeedResponse).feed).toBeNull();
    expect((await fetchFeed(second.path)).status).toBe(404);
    expect((await call(pair.mentee, "GET", "/me/calendar")).body).toEqual({ feed: null });
  });

  it("unknown_or_malformed_addresses_are_404", async () => {
    expect((await fetchFeed(`/calendar/${newSecret()}.ics`)).status).toBe(404);
    expect((await fetchFeed("/calendar/abc.ics")).status).toBe(404);
    const pair = await pairWithMeeting();
    const { token } = await createFeed(pair.mentee);
    // The token without the extension, or as a hash, is not the address.
    expect((await fetchFeed(`/calendar/${token}`)).status).toBe(404);
    expect((await fetchFeed(`/calendar/${sha256Hex(token)}.ics`)).status).toBe(404);
    expect((await fetchFeed(`/calendar/${token}.ics`)).status).toBe(200);
  });

  it("stops_while_the_owner_is_suspended_or_leaving", async () => {
    const pair = await pairWithMeeting();
    const { path } = await createFeed(pair.mentee);
    await db.pool.query("UPDATE users SET suspended_at = now() WHERE id = $1", [pair.mentee]);
    expect((await fetchFeed(path)).status).toBe(404);
    await db.pool.query("UPDATE users SET suspended_at = NULL WHERE id = $1", [pair.mentee]);
    expect((await fetchFeed(path)).status).toBe(200);

    await db.pool.query(
      `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
       VALUES ($1, now() + interval '14 days', 'hidden')`,
      [pair.mentee],
    );
    expect((await fetchFeed(path)).status).toBe(404);
  });
});

/* ---------------------------------------------------------- the settings */

describe("/api/me/calendar", () => {
  it("needs_a_signed_in_member_and_the_origin", async () => {
    expect((await call(null, "GET", "/me/calendar")).status).toBe(401);
    expect((await call(null, "POST", "/me/calendar")).status).toBe(401);
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const noOrigin = await call(member, "POST", "/me/calendar", { origin: null });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.code).toBe("bad_origin");
    const unverified = await makePerson(db.pool, { kind: "student", visibility: "hidden", verified: false });
    const refused = await call(unverified, "POST", "/me/calendar");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("not_member");
    // Not even the SQL function lets a non-member through.
    await expect(runAs(db.pool, unverified, "SELECT create_calendar_token($1)", [sha256Hex(newSecret())])).rejects.toThrow(
      /mest\.forbidden/,
    );
  });

  it("reports_whether_the_feed_is_on_without_the_address", async () => {
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    expect((await call(member, "GET", "/me/calendar")).body).toEqual({ feed: null });
    const { answer, token } = await createFeed(member);
    expect(answer.webcalUrl).toBe(answer.url.replace(/^https?:/, "webcal:"));
    const status = await call(member, "GET", "/me/calendar");
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(status.body).toEqual({ feed: { createdAt: answer.feed.createdAt } });
    expect(status.text).not.toContain(token);
  });

  it("stores_only_the_sha256_of_the_token", async () => {
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const { token } = await createFeed(member);
    const rows = await db.pool.query<{ token_hash: string; revoked_at: Date | null }>(
      "SELECT token_hash, revoked_at FROM calendar_tokens WHERE profile_id = $1",
      [member],
    );
    expect(rows.rows).toEqual([{ token_hash: sha256Hex(token), revoked_at: null }]);
    const dump = await db.pool.query<{ row: string }>("SELECT row_to_json(ct)::text AS row FROM calendar_tokens ct");
    for (const { row } of dump.rows) expect(row).not.toContain(token);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);

    // The audit log records the change, not the secret.
    const audit = await db.pool.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM audit_log WHERE subject_id = $1 ORDER BY id",
      [member],
    );
    expect(audit.rows).toEqual([{ action: "calendar_feed.created", detail: { replaced: false } }]);
  });

  it("members_cannot_read_the_hash_or_write_tokens_directly", async () => {
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const other = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true });
    await createFeed(member);

    await expect(runAs(db.pool, member, "SELECT token_hash FROM calendar_tokens")).rejects.toThrow(/permission denied/);
    await expect(
      runAs(db.pool, member, "INSERT INTO calendar_tokens (profile_id, token_hash) VALUES ($1, $2)", [member, sha256Hex(newSecret())]),
    ).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, member, "UPDATE calendar_tokens SET revoked_at = now()")).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, member, "DELETE FROM calendar_tokens")).rejects.toThrow(/permission denied/);

    expect(await rowsAs(db.pool, member, "SELECT id FROM calendar_tokens")).toHaveLength(1);
    expect(await rowsAs(db.pool, other, "SELECT id FROM calendar_tokens")).toHaveLength(0);
    expect(await rowsAs(db.pool, admin, "SELECT id FROM calendar_tokens")).toHaveLength(0);
    expect(await rowsAs(db.pool, null, "SELECT id FROM calendar_tokens")).toHaveLength(0);
    // A malformed hash is refused by the function, not stored.
    await expect(runAs(db.pool, other, "SELECT create_calendar_token('not-a-hash')")).rejects.toThrow(/mest\.invalid_token/);
  });
});

/* -------------------------------------------------- deletion and export */

describe("deletion and export", () => {
  it("sweep_deletes_the_calendar_tokens", async () => {
    const pair = await pairWithMeeting();
    await createFeed(pair.mentee);
    const { path } = await createFeed(pair.mentee);
    const other = await createFeed(pair.mentor);
    const before = await db.pool.query("SELECT 1 FROM calendar_tokens WHERE profile_id = $1", [pair.mentee]);
    expect(before.rowCount).toBe(2);

    expect(await deleteAccount(pair.mentee)).toBe(true);
    const after = await db.pool.query("SELECT 1 FROM calendar_tokens WHERE profile_id = $1", [pair.mentee]);
    expect(after.rowCount).toBe(0);
    expect((await fetchFeed(path)).status).toBe(404);

    // The other party keeps their feed; the meeting there reads "Former member" and is canceled.
    const [event] = events((await fetchFeed(other.path)).text);
    expect(event.SUMMARY).toBe("MEST mentorship: Former member");
    expect(event.STATUS).toBe("CANCELLED");
  });

  it("export_notes_the_feed_without_its_address", async () => {
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const other = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    expect(((await call(member, "GET", "/me/export")).body as DataExport).calendarFeed).toBeNull();
    const { answer, token } = await createFeed(member);
    const res = await call(member, "GET", "/me/export");
    expect(res.status).toBe(200);
    expect((res.body as DataExport).calendarFeed).toEqual({ createdAt: answer.feed.createdAt });
    expect(res.text).not.toContain(token);
    expect(res.text).not.toContain(sha256Hex(token));
    expect(((await call(other, "GET", "/me/export")).body as DataExport).calendarFeed).toBeNull();
  });
});
