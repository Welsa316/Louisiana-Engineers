import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataExport } from "@shared/types/export";
import type { Meeting, MeetingLogResponse, MeetingsResponse, ProposeTimesResponse, SlotsResponse } from "@shared/types/meetings";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { exportRoutes } from "../../src/routes/export";
import { meetingRoutes, relationshipMeetingRoutes } from "../../src/routes/meetings";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, runAs } from "../policies/fixtures";
import {
  chooseAs,
  makePair,
  meetingRow,
  proposeAs,
  shiftMeetingIntoPast,
  slotAt,
  slotsOf,
  type Pair,
} from "../policies/meeting-fixtures";
import { resetRequestConfig } from "../policies/request-fixtures";

/**
 * Scheduling (Task 30): `/api/relationships/:requestId/{slots,meetings}` and
 * `/api/meetings/*` through the real guards and `withUser`, so the SQL
 * functions and the row policies decide; plus the deletion sweep, the
 * export and the dashboard's meeting counts.
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
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(
  new Hono()
    .route("/relationships", relationshipMeetingRoutes)
    .route("/meetings", meetingRoutes)
    .route("/me", exportRoutes),
);

const cookies = new Map<string, string>();
async function cookieFor(userId: string): Promise<string> {
  const known = cookies.get(userId);
  if (known) return known;
  const value = await asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
  cookies.set(userId, value);
  return value;
}

interface Call {
  status: number;
  body: any;
}

async function call(userId: string | null, method: string, path: string, body?: unknown): Promise<Call> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (userId) headers.cookie = `mest_session=${await cookieFor(userId)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A slot body for the API, `hoursAhead` from now. */
function apiSlot(hoursAhead: number, minutes = 45): { startsAt: string; endsAt: string } {
  const s = slotAt(hoursAhead, minutes);
  return { startsAt: s.starts_at, endsAt: s.ends_at };
}

async function propose(userId: string, requestId: string, hours: number[]): Promise<ProposeTimesResponse> {
  const res = await call(userId, "POST", `/relationships/${requestId}/slots`, { slots: hours.map((h) => apiSlot(h)) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function notificationsOf(recipient: string): Promise<{ template: string; category: string; email_status: string; link: string; payload: any }[]> {
  return (
    await db.pool.query(
      `SELECT template, category::text AS category, email_status, link, payload
         FROM notifications WHERE recipient_id = $1 ORDER BY created_at, id`,
      [recipient],
    )
  ).rows;
}

beforeEach(() => cookies.clear());

describe("proposing and choosing", () => {
  it("propose_and_choose_round_trip", async () => {
    const pair = await makePair(db.pool);

    const proposal = await propose(pair.mentee, pair.requestId, [48, 72, 96]);
    expect(proposal.items).toHaveLength(3);
    expect(proposal.items.every((s) => s.proposedBy === "me" && s.status === "proposed" && s.durationMin === 45)).toBe(true);

    // The mentor is told, with a link to their side of the request.
    const told = (await notificationsOf(pair.mentor)).filter((n) => n.link === `/network/mentor/requests/${pair.requestId}`);
    expect(told.at(-1)).toMatchObject({ category: "request", email_status: "queued" });

    // The mentor sees the same three times, as the other party's.
    const seen = await call(pair.mentor, "GET", `/relationships/${pair.requestId}/slots`);
    expect(seen.status).toBe(200);
    const slots = (seen.body as SlotsResponse).items;
    expect(slots.map((s) => s.proposedBy)).toEqual(["them", "them", "them"]);
    expect(seen.body.total).toBe(3);

    const chosen = await call(pair.mentor, "POST", `/relationships/${pair.requestId}/meetings`, {
      slotId: proposal.items[1].id,
      mode: "in-person",
      place: "Coffee near campus",
      agenda: "Resume and internship list",
    });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);
    const meeting = chosen.body as Meeting;
    expect(meeting).toMatchObject({
      requestId: pair.requestId,
      role: "mentor",
      status: "upcoming",
      mode: "in-person",
      place: "Coffee near campus",
      agenda: "Resume and internship list",
      startsAt: proposal.items[1].startsAt,
      durationMin: 45,
      createdBy: "me",
      met: null,
      awaitingOutcome: false,
      counterparty: { firstName: "Amina", lastName: "Rahman", former: false },
    });

    // The meeting appears for both parties.
    for (const [party, role, createdBy] of [
      [pair.mentee, "mentee", "them"],
      [pair.mentor, "mentor", "me"],
    ] as const) {
      const listed = await call(party, "GET", `/relationships/${pair.requestId}/meetings`);
      expect(listed.status).toBe(200);
      expect((listed.body as MeetingsResponse).items.map((m) => [m.id, m.role, m.createdBy])).toEqual([[meeting.id, role, createdBy]]);
      const log = await call(party, "GET", "/meetings?when=upcoming");
      expect((log.body as MeetingLogResponse).items.map((m) => m.id)).toEqual([meeting.id]);
      expect((await call(party, "GET", "/meetings?when=past")).body.items).toEqual([]);
    }

    // The proposer is told with the meeting-scheduled template; the payload
    // names the time but never the place or agenda.
    const scheduled = (await notificationsOf(pair.mentee)).filter((n) => n.template === "meeting-scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      category: "response",
      email_status: "queued",
      link: `/network/me/requests/${pair.requestId}`,
      payload: { requestId: pair.requestId, meetingId: meeting.id, otherFirstName: "Layla", durationMin: 45, mode: "in-person" },
    });
    expect(JSON.stringify(scheduled[0])).not.toContain("Coffee near campus");
    expect(JSON.stringify(scheduled[0])).not.toContain("Resume and internship list");
  });

  it("choosing_declines_siblings", async () => {
    const pair = await makePair(db.pool);
    const batch = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(30), slotAt(54), slotAt(78)]);
    // The mentee's own open proposal is moot once a time is agreed.
    const own = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(100)]);
    const [a, b, c] = await slotsOf(db.pool, batch);
    await chooseAs(db.pool, pair.mentee, b.id);
    expect((await slotsOf(db.pool, batch)).map((s) => s.status)).toEqual(["declined", "chosen", "declined"]);
    expect((await slotsOf(db.pool, own)).map((s) => s.status)).toEqual(["withdrawn"]);
    // A declined sibling cannot be chosen afterwards.
    await expect(chooseAs(db.pool, pair.mentee, a.id)).rejects.toThrow(/mest\.slot_unavailable/);
    await expect(chooseAs(db.pool, pair.mentee, c.id)).rejects.toThrow(/mest\.slot_unavailable/);
    const res = await call(pair.mentee, "POST", `/relationships/${pair.requestId}/meetings`, { slotId: b.id, mode: "online" });
    expect(res).toMatchObject({ status: 409, body: { code: "slot_unavailable" } });
  });

  it("third_batch_replaces_the_first", async () => {
    const pair = await makePair(db.pool);
    const first = await propose(pair.mentee, pair.requestId, [24, 48]);
    const second = await propose(pair.mentor, pair.requestId, [30]);
    const third = await propose(pair.mentee, pair.requestId, [60, 84, 108]);

    // The mentee's first proposal is withdrawn; the mentor's stays open.
    expect((await slotsOf(db.pool, first.batchId)).map((s) => s.status)).toEqual(["withdrawn", "withdrawn"]);
    expect((await slotsOf(db.pool, second.batchId)).map((s) => s.status)).toEqual(["proposed"]);
    expect((await slotsOf(db.pool, third.batchId)).map((s) => s.status)).toEqual(["proposed", "proposed", "proposed"]);

    const open = await call(pair.mentor, "GET", `/relationships/${pair.requestId}/slots?status=proposed`);
    expect(open.body.total).toBe(4);
    expect((open.body as SlotsResponse).items.map((s) => s.batchId).sort()).toEqual(
      [second.batchId, third.batchId, third.batchId, third.batchId].sort(),
    );
    // A withdrawn time cannot be chosen.
    await expect(chooseAs(db.pool, pair.mentor, first.items[0].id)).rejects.toThrow(/mest\.slot_unavailable/);
  });

  it("refuses_bad_proposals", async () => {
    const pair = await makePair(db.pool);
    const bad: unknown[] = [
      [],
      [slotAt(24), slotAt(48), slotAt(72), slotAt(96)],
      [slotAt(-2)],
      [slotAt(24, 10)],
      [slotAt(24, 181)],
      [slotAt(24), slotAt(24)],
      [slotAt(24 * 400)],
      [{ starts_at: "not a time", ends_at: "2027-01-01T00:00:00Z" }],
      ["2027-01-01"],
      {},
    ];
    for (const slots of bad) {
      await expect(proposeAs(db.pool, pair.mentee, pair.relationshipId, slots), JSON.stringify(slots)).rejects.toThrow(
        /mest\.invalid_slots/,
      );
    }
    // The route validates first.
    const tooLong = await call(pair.mentee, "POST", `/relationships/${pair.requestId}/slots`, { slots: [apiSlot(24, 200)] });
    expect(tooLong).toMatchObject({ status: 400, body: { code: "validation" } });
    const past = await call(pair.mentee, "POST", `/relationships/${pair.requestId}/slots`, { slots: [apiSlot(-3)] });
    expect(past).toMatchObject({ status: 409, body: { code: "invalid_slots" } });
    expect(await db.pool.query("SELECT 1 FROM availability_slots")).toMatchObject({ rowCount: 0 });
  });

  it("only_the_other_party_chooses_and_only_while_active", async () => {
    const pair = await makePair(db.pool);
    const { items } = await propose(pair.mentee, pair.requestId, [24, 48]);
    const own = await call(pair.mentee, "POST", `/relationships/${pair.requestId}/meetings`, { slotId: items[0].id, mode: "online" });
    expect(own).toMatchObject({ status: 403, body: { code: "forbidden" } });

    // Another pair's request id cannot reach this pair's slot.
    const other = await makePair(db.pool, { mentor: "Omar", mentee: "Sara" });
    const crossed = await call(other.mentor, "POST", `/relationships/${other.requestId}/meetings`, { slotId: items[0].id, mode: "online" });
    expect(crossed.status).toBe(404);

    await runAs(db.pool, pair.mentor, "SELECT complete_relationship($1)", [pair.requestId]);
    const ended = await call(pair.mentor, "POST", `/relationships/${pair.requestId}/meetings`, { slotId: items[0].id, mode: "online" });
    expect(ended).toMatchObject({ status: 409, body: { code: "not_active" } });
    const proposeEnded = await call(pair.mentor, "POST", `/relationships/${pair.requestId}/slots`, { slots: [apiSlot(24)] });
    expect(proposeEnded).toMatchObject({ status: 409, body: { code: "not_active" } });
  });

  it("outsiders_get_404_and_visitors_401", async () => {
    const pair = await makePair(db.pool);
    const { items } = await propose(pair.mentee, pair.requestId, [24]);
    const meetingId = await chooseAs(db.pool, pair.mentor, items[0].id);
    const stranger = await makePerson(db.pool);
    const admin = await makePerson(db.pool, { admin: true });

    for (const outsider of [stranger, admin]) {
      expect((await call(outsider, "GET", `/relationships/${pair.requestId}/slots`)).status).toBe(404);
      expect((await call(outsider, "GET", `/relationships/${pair.requestId}/meetings`)).status).toBe(404);
      expect((await call(outsider, "POST", `/relationships/${pair.requestId}/slots`, { slots: [apiSlot(24)] })).status).toBe(404);
      expect((await call(outsider, "POST", `/meetings/${meetingId}/cancel`)).status).toBe(404);
      expect((await call(outsider, "POST", `/meetings/${meetingId}/outcome`, { met: true })).status).toBe(404);
      expect((await call(outsider, "GET", "/meetings?when=upcoming")).body).toEqual({ items: [], total: 0 });
    }
    expect((await call(null, "GET", `/relationships/${pair.requestId}/slots`)).status).toBe(401);
    expect((await call(null, "GET", "/meetings")).status).toBe(401);
    expect((await call(pair.mentee, "GET", "/relationships/not-a-uuid/slots")).status).toBe(404);
    expect((await call(pair.mentee, "POST", "/meetings/not-a-uuid/cancel")).status).toBe(404);
    expect((await meetingRow(db.pool, meetingId)).status).toBe("upcoming");
  });
});

describe("cancel and outcome", () => {
  it("either_party_cancels_an_upcoming_meeting", async () => {
    const pair = await makePair(db.pool);
    const { items } = await propose(pair.mentor, pair.requestId, [24]);
    const meetingId = await chooseAs(db.pool, pair.mentee, items[0].id);
    const res = await call(pair.mentee, "POST", `/meetings/${meetingId}/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: meetingId, status: "canceled", canceledBy: "me" });
    const forMentor = (await call(pair.mentor, "GET", `/relationships/${pair.requestId}/meetings`)).body.items[0];
    expect(forMentor).toMatchObject({ status: "canceled", canceledBy: "them" });
    expect((await notificationsOf(pair.mentor)).at(-1)).toMatchObject({
      category: "request",
      link: `/network/mentor/requests/${pair.requestId}`,
    });
    expect(await call(pair.mentor, "POST", `/meetings/${meetingId}/cancel`)).toMatchObject({ status: 409, body: { code: "not_upcoming" } });
    // A canceled meeting has no outcome to give.
    await shiftMeetingIntoPast(db.pool, meetingId, 30);
    expect(await call(pair.mentor, "POST", `/meetings/${meetingId}/outcome`, { met: true })).toMatchObject({
      status: 409,
      body: { code: "meeting_canceled" },
    });
  });

  it("did_you_meet_sets_the_status", async () => {
    const pair = await makePair(db.pool);
    const { items } = await propose(pair.mentor, pair.requestId, [24]);
    const meetingId = await chooseAs(db.pool, pair.mentee, items[0].id);

    // Not before it starts.
    expect(await call(pair.mentee, "POST", `/meetings/${meetingId}/outcome`, { met: true })).toMatchObject({
      status: 409,
      body: { code: "meeting_not_started" },
    });
    await shiftMeetingIntoPast(db.pool, meetingId, 2);
    expect(await call(pair.mentee, "POST", `/meetings/${meetingId}/cancel`)).toMatchObject({ status: 409, body: { code: "meeting_started" } });

    const before = (await call(pair.mentee, "GET", "/meetings?when=past")).body.items[0] as Meeting;
    expect(before).toMatchObject({ id: meetingId, awaitingOutcome: true });

    const no = await call(pair.mentee, "POST", `/meetings/${meetingId}/outcome`, { met: false });
    expect(no.body).toMatchObject({ status: "canceled", met: false, outcomeBy: "me", awaitingOutcome: false });
    // The other party's later answer replaces it.
    const yes = await call(pair.mentor, "POST", `/meetings/${meetingId}/outcome`, { met: true });
    expect(yes.body).toMatchObject({ status: "completed", met: true, outcomeBy: "me" });
    expect((await meetingRow(db.pool, meetingId)).status).toBe("completed");
    expect(await call(pair.mentor, "POST", `/meetings/${meetingId}/outcome`, { met: "yes" })).toMatchObject({ status: 400 });
  });
});

describe("deletion, export and the dashboard", () => {
  async function scheduled(pair: Pair, hours: number): Promise<string> {
    const batch = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(hours)]);
    const [slot] = await slotsOf(db.pool, batch);
    return chooseAs(db.pool, pair.mentor, slot.id, { place: "Library room 2", agenda: "Licensure path and the FE exam." });
  }

  it("sweep_empties_place_and_agenda", async () => {
    const pair = await makePair(db.pool);
    const past = await scheduled(pair, 24);
    await shiftMeetingIntoPast(db.pool, past, 72);
    const upcoming = await scheduled(pair, 48);
    const open = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(90)]);

    await runAs(db.pool, pair.mentee, "SELECT request_account_deletion(false, NULL)");
    const deletion = await db.pool.query<{ id: string }>("SELECT id FROM account_deletions WHERE profile_id = $1", [pair.mentee]);
    await asSystem(db.pool, (client) =>
      client.query("SELECT execute_account_deletion($1, now() + interval '15 days')", [deletion.rows[0].id]),
    );

    for (const id of [past, upcoming]) {
      const row = await meetingRow(db.pool, id);
      expect(row.place).toBe("");
      expect(row.agenda).toBe("");
    }
    // The rows stay; what was still to come is canceled, open times withdrawn.
    expect((await meetingRow(db.pool, past)).status).toBe("upcoming");
    expect((await meetingRow(db.pool, upcoming)).status).toBe("canceled");
    expect((await slotsOf(db.pool, open)).map((s) => s.status)).toEqual(["withdrawn"]);
    const leftovers = await db.pool.query(
      "SELECT 1 FROM meetings WHERE place LIKE '%Library%' OR agenda LIKE '%Licensure%'",
    );
    expect(leftovers.rowCount).toBe(0);

    // The mentor keeps the history, with the other party as "Former member".
    const kept = (await call(pair.mentor, "GET", `/relationships/${pair.requestId}/meetings`)).body as MeetingsResponse;
    expect(kept.total).toBe(2);
    expect(kept.items.every((m) => m.counterparty.former && m.place === "" && m.agenda === "")).toBe(true);
  });

  it("export_holds_only_the_callers_meetings_and_slots", async () => {
    const pair = await makePair(db.pool);
    await scheduled(pair, 24);
    await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(60), slotAt(84)]);
    const other = await makePair(db.pool, { mentor: "Omar", mentee: "Sara" });
    const otherMeeting = await scheduled(other, 30);

    const res = await call(pair.mentee, "GET", "/me/export");
    expect(res.status).toBe(200);
    const data = res.body as DataExport;
    expect(data.meetings).toHaveLength(1);
    expect(data.meetings[0]).toMatchObject({
      requestId: pair.requestId,
      role: "mentee",
      counterparty: "Layla Haddad",
      place: "Library room 2",
      createdBy: "them",
      status: "upcoming",
    });
    expect(data.availabilitySlots.map((s) => [s.proposedBy, s.status, s.counterparty]).sort()).toEqual([
      ["me", "chosen", "Layla Haddad"],
      ["them", "proposed", "Layla Haddad"],
      ["them", "proposed", "Layla Haddad"],
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toContain(otherMeeting);
    expect(text).not.toContain(other.requestId);
    expect(text).not.toContain("Sara");
    expect(text).not.toContain(pair.mentor);
  });

  it("dashboard_counts_meetings_held_and_upcoming", async () => {
    const pair = await makePair(db.pool);
    const held = await scheduled(pair, 24);
    await shiftMeetingIntoPast(db.pool, held, 30);
    await runAs(db.pool, pair.mentee, "SELECT record_meeting_outcome($1, true)", [held]);
    await scheduled(pair, 48);
    const canceled = await scheduled(pair, 72);
    await runAs(db.pool, pair.mentor, "SELECT cancel_meeting($1)", [canceled]);
    const admin = await makePerson(db.pool, { admin: true });
    const row = await asUser(db.pool, admin, async (c) =>
      (await c.query("SELECT meetings_held, meetings_upcoming FROM admin_dashboard")).rows[0],
    );
    expect(row).toEqual({ meetings_held: 1, meetings_upcoming: 1 });
  });
});
