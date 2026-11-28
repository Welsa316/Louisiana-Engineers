import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { meetingRoutes, relationshipMeetingRoutes } from "../../src/routes/meetings";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, runAs, scalarAs } from "../policies/fixtures";
import { chooseAs, makePair, meetingRow, proposeAs, slotAt, slotsOf, type Pair } from "../policies/meeting-fixtures";
import { makeStudent, resetRequestConfig } from "../policies/request-fixtures";

/**
 * Scheduling and the other party's standing (migration 0021): a member who
 * is suspended or leaving cannot be scheduled with; suspending a member or
 * opening their deletion closes their meetings at once; a suspended member
 * gets no email but account ones; and repeated proposals email the other
 * party at most once a day while the first is unread.
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
const app = testApp(new Hono().route("/relationships", relationshipMeetingRoutes).route("/meetings", meetingRoutes));

const cookies = new Map<string, string>();
async function cookieFor(userId: string): Promise<string> {
  const known = cookies.get(userId);
  if (known) return known;
  const value = await asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
  cookies.set(userId, value);
  return value;
}

async function call(userId: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { origin: ORIGIN, cookie: `mest_session=${await cookieFor(userId)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function apiSlot(hoursAhead: number): { startsAt: string; endsAt: string } {
  const s = slotAt(hoursAhead);
  return { startsAt: s.starts_at, endsAt: s.ends_at };
}

async function suspend(userId: string): Promise<void> {
  await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [userId]));
}

async function openGraceDeletion(userId: string): Promise<void> {
  await asSystem(db.pool, (client) =>
    client.query(
      `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
       VALUES ($1, now() + interval '14 days', 'public')`,
      [userId],
    ),
  );
}

/** A meeting still to come between the pair, proposed by the mentee and chosen by the mentor. */
async function upcomingMeeting(pair: Pair, hours = 48): Promise<string> {
  const batch = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(hours)]);
  const [slot] = await slotsOf(db.pool, batch);
  return chooseAs(db.pool, pair.mentor, slot.id);
}

/* ------------------------------------------------- 1. the other party's standing */

describe("scheduling needs both parties in good standing", () => {
  it("refuses_to_propose_or_choose_with_a_suspended_counterparty", async () => {
    const pair = await makePair(db.pool);
    const open = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(30)]);
    const [slot] = await slotsOf(db.pool, open);
    await suspend(pair.mentee);

    // The mentor can neither propose to nor choose a time from a suspended mentee.
    await expect(proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(60)])).rejects.toThrow(
      /mest\.counterparty_unavailable/,
    );
    await expect(chooseAs(db.pool, pair.mentor, slot.id)).rejects.toThrow(/mest\.counterparty_unavailable/);

    const proposed = await call(pair.mentor, "POST", `/relationships/${pair.requestId}/slots`, { slots: [apiSlot(60)] });
    expect(proposed).toMatchObject({ status: 409, body: { code: "counterparty_unavailable" } });
    const chosen = await call(pair.mentor, "POST", `/relationships/${pair.requestId}/meetings`, { slotId: slot.id, mode: "online" });
    expect(chosen).toMatchObject({ status: 409, body: { code: "counterparty_unavailable" } });
    expect(await db.pool.query("SELECT 1 FROM meetings")).toMatchObject({ rowCount: 0 });

    // The suspended member is refused as the caller.
    await expect(proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(60)])).rejects.toThrow(/mest\.forbidden/);
  });

  it("refuses_a_counterparty_who_is_leaving", async () => {
    const pair = await makePair(db.pool);
    await openGraceDeletion(pair.mentor);
    await expect(proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(60)])).rejects.toThrow(
      /mest\.counterparty_unavailable/,
    );
  });

  it("still_schedules_between_two_members_in_good_standing", async () => {
    const pair = await makePair(db.pool);
    const meetingId = await upcomingMeeting(pair);
    expect((await meetingRow(db.pool, meetingId)).status).toBe("upcoming");
  });
});

/* -------------------------------------- 2. suspension and deletion close meetings */

describe("suspension and a scheduled deletion close meetings at once", () => {
  async function arrange(): Promise<{ pair: Pair; meetingId: string; open: string; theirs: string }> {
    const pair = await makePair(db.pool);
    const meetingId = await upcomingMeeting(pair, 48);
    const open = await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(90)]);
    const theirs = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(110)]);
    return { pair, meetingId, open, theirs };
  }

  async function expectClosed(
    { meetingId, open, theirs }: { meetingId: string; open: string; theirs: string },
    by: string,
  ): Promise<void> {
    const row = await db.pool.query<{ status: string; canceled_by: string | null }>(
      "SELECT status::text AS status, canceled_by FROM meetings WHERE id = $1",
      [meetingId],
    );
    expect(row.rows[0]).toEqual({ status: "canceled", canceled_by: by });
    expect((await slotsOf(db.pool, open)).map((s) => s.status)).toEqual(["withdrawn"]);
    expect((await slotsOf(db.pool, theirs)).map((s) => s.status)).toEqual(["withdrawn"]);
  }

  it("suspend_requests_cancels_the_suspended_members_meetings", async () => {
    const arranged = await arrange();
    const admin = await makePerson(db.pool, { admin: true, firstName: "Bea" });
    const reporter = await makeStudent(db.pool);
    const reportId = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'unsafe', NULL) AS value", [
      arranged.pair.mentor,
    ]);
    await runAs(db.pool, admin, "SELECT admin_resolve_report($1, 'resolved', NULL, 'suspend_requests')", [reportId]);
    await expectClosed(arranged, arranged.pair.mentor);
  });

  it("a_members_own_deletion_request_cancels_their_meetings", async () => {
    const arranged = await arrange();
    await runAs(db.pool, arranged.pair.mentee, "SELECT request_account_deletion(false, NULL)");
    await expectClosed(arranged, arranged.pair.mentee);
  });

  it("an_administrators_removal_cancels_their_meetings", async () => {
    const arranged = await arrange();
    const admin = await makePerson(db.pool, { admin: true, firstName: "Bea" });
    const reporter = await makeStudent(db.pool);
    const reportId = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'unsafe', NULL) AS value", [
      arranged.pair.mentor,
    ]);
    await runAs(db.pool, admin, "SELECT admin_resolve_report($1, 'resolved', NULL, 'remove_account')", [reportId]);
    await expectClosed(arranged, arranged.pair.mentor);
  });

  it("removal_during_the_grace_period_cancels_meetings_left_open", async () => {
    const pair = await makePair(db.pool);
    // A grace-period deletion opened before 0021 left the meeting standing;
    // arrange that as the owner (the functions now refuse it).
    await openGraceDeletion(pair.mentor);
    const meetingId = await asSystem(db.pool, async (client) => {
      const slot = await client.query<{ id: string; starts_at: Date }>(
        `INSERT INTO availability_slots (relationship_id, proposed_by, batch_id, starts_at, ends_at, status)
         VALUES ($1, $2, gen_random_uuid(), now() + interval '2 days', now() + interval '2 days 45 minutes', 'chosen')
         RETURNING id, starts_at`,
        [pair.relationshipId, pair.mentee],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO meetings (relationship_id, slot_id, starts_at, duration_min, mode, place, agenda, created_by)
         VALUES ($1, $2, $3, 45, 'online', '', '', $4) RETURNING id`,
        [pair.relationshipId, slot.rows[0].id, slot.rows[0].starts_at, pair.mentor],
      );
      return inserted.rows[0].id;
    });
    expect((await meetingRow(db.pool, meetingId)).status).toBe("upcoming");

    // An administrator's removal of a member already in their grace period.
    await asSystem(db.pool, (client) => client.query("SELECT schedule_account_deletion($1, true, 'Report: spam')", [pair.mentor]));
    expect((await meetingRow(db.pool, meetingId)).status).toBe("canceled");
  });
});

/* ----------------------------------------------- 3. no email to a suspended member */

describe("create_notification and a suspended recipient", () => {
  async function notify(recipient: string, category: string): Promise<string> {
    return asSystem(db.pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT create_notification($1, $2::notification_category, 'Title', 'Body', '/network/me', 'default',
                                    '{}'::jsonb, true) AS id`,
        [recipient, category],
      );
      return result.rows[0].id;
    });
  }

  async function emailStatus(id: string): Promise<{ email_status: string; queued: number }> {
    const result = await db.pool.query<{ email_status: string; queued: number }>(
      `SELECT n.email_status, (SELECT count(*)::int FROM email_outbox o WHERE o.notification_id = n.id) AS queued
         FROM notifications n WHERE n.id = $1`,
      [id],
    );
    return result.rows[0];
  }

  it("writes_the_in_app_row_but_queues_no_email_unless_it_is_an_account_notice", async () => {
    const member = await makePerson(db.pool, { suspended: true });
    for (const category of ["request", "response", "reminder", "profile", "report"]) {
      expect(await emailStatus(await notify(member, category)), category).toEqual({ email_status: "skipped", queued: 0 });
    }
    expect(await emailStatus(await notify(member, "account"))).toEqual({ email_status: "queued", queued: 1 });
    const rows = await db.pool.query("SELECT 1 FROM notifications WHERE recipient_id = $1", [member]);
    expect(rows.rowCount).toBe(6);
  });

  it("still_emails_a_member_in_good_standing", async () => {
    const member = await makePerson(db.pool);
    expect(await emailStatus(await notify(member, "request"))).toEqual({ email_status: "queued", queued: 1 });
  });
});

/* -------------------------------------------- 4. one proposal email a day, while unread */

describe("propose_times emails at most once a day while unread", () => {
  async function proposalsTo(recipient: string): Promise<{ id: string; email_status: string }[]> {
    const result = await db.pool.query<{ id: string; email_status: string }>(
      `SELECT id, email_status FROM notifications
        WHERE recipient_id = $1 AND title LIKE '% proposed %' ORDER BY created_at, id`,
      [recipient],
    );
    return result.rows;
  }

  it("a_second_proposal_while_the_first_is_unread_is_in_app_only", async () => {
    const pair = await makePair(db.pool);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(30)]);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(40)]);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(50)]);
    expect((await proposalsTo(pair.mentor)).map((n) => n.email_status)).toEqual(["queued", "skipped", "skipped"]);
  });

  it("emails_again_once_the_last_one_is_read_or_a_day_old", async () => {
    const pair = await makePair(db.pool);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(30)]);
    await db.pool.query("UPDATE notifications SET read_at = now() WHERE recipient_id = $1", [pair.mentor]);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(40)]);
    await db.pool.query(
      "UPDATE notifications SET created_at = created_at - interval '25 hours' WHERE recipient_id = $1",
      [pair.mentor],
    );
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(50)]);
    expect((await proposalsTo(pair.mentor)).map((n) => n.email_status)).toEqual(["queued", "queued", "queued"]);
  });

  it("throttles_per_relationship_and_per_recipient", async () => {
    const pair = await makePair(db.pool);
    const other = await makePair(db.pool, { mentor: "Omar", mentee: "Sara" });
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(30)]);
    // The other direction of the same relationship is its own recipient.
    await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(36)]);
    // Another relationship is its own thread.
    await proposeAs(db.pool, other.mentee, other.relationshipId, [slotAt(30)]);
    expect((await proposalsTo(pair.mentor)).map((n) => n.email_status)).toEqual(["queued"]);
    expect((await proposalsTo(pair.mentee)).map((n) => n.email_status)).toEqual(["queued"]);
    expect((await proposalsTo(other.mentor)).map((n) => n.email_status)).toEqual(["queued"]);
  });

  it("a_cancel_notice_does_not_count_as_a_proposal", async () => {
    const pair = await makePair(db.pool);
    const meetingId = await upcomingMeeting(pair, 48);
    // The mentee cancels; the mentor's unread cancel notice is not a proposal.
    await runAs(db.pool, pair.mentee, "SELECT cancel_meeting($1)", [meetingId]);
    await db.pool.query(
      "UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND title LIKE '% proposed %'",
      [pair.mentor],
    );
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(60)]);
    expect((await proposalsTo(pair.mentor)).map((n) => n.email_status)).toEqual(["queued", "queued"]);
  });
});

/* -------------------------------------------- 5. the mentor's link is the mentees page */

describe("relationship_path", () => {
  it("sends_the_mentor_to_the_mentees_page_and_the_mentee_to_the_request", async () => {
    const pair = await makePair(db.pool);
    await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(30)]);
    await proposeAs(db.pool, pair.mentor, pair.relationshipId, [slotAt(40)]);
    const links = await db.pool.query<{ recipient_id: string; link: string; payload_link: string }>(
      `SELECT recipient_id, link, payload->>'link' AS payload_link FROM notifications WHERE title LIKE '% proposed %'`,
    );
    const byRecipient = new Map(links.rows.map((r) => [r.recipient_id, r]));
    expect(byRecipient.get(pair.mentor)).toMatchObject({
      link: `/network/mentor/mentees/${pair.requestId}`,
      payload_link: `/network/mentor/mentees/${pair.requestId}`,
    });
    expect(byRecipient.get(pair.mentee)).toMatchObject({
      link: `/network/me/requests/${pair.requestId}`,
      payload_link: `/network/me/requests/${pair.requestId}`,
    });
  });
});
