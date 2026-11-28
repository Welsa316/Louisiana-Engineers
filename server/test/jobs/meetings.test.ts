import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completePastMeetingsJob } from "../../src/jobs/complete-past-meetings";
import { meetingCheckInJob } from "../../src/jobs/meeting-check-in";
import { clearJobs, registerJob, runJobOnce } from "../../src/jobs/scheduler";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import { runAs } from "../policies/fixtures";
import { DAY, HOUR, chooseAs, makePair, meetingRow, proposeAs, slotAt, slotsOf, type Pair } from "../policies/meeting-fixtures";
import { resetRequestConfig } from "../policies/request-fixtures";

/**
 * The two meeting jobs (Task 30), run through the scheduler's `runJobOnce`
 * with the scheduler's `now`, so each test plays the clock forward and
 * checks that a meeting completes, and its parties are asked "Did you
 * meet?", exactly once however often the job runs.
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
  clearJobs();
  registerJob(completePastMeetingsJob);
  registerJob(meetingCheckInJob);
});

async function run(name: string, now: Date): Promise<any> {
  const outcome = await runJobOnce(name, { now });
  expect(outcome.status).toBe("ran");
  return outcome.status === "ran" ? outcome.result : undefined;
}

/** A meeting `hours` from now, 45 minutes long; its start. */
async function meetingIn(pair: Pair, hours: number): Promise<{ id: string; startsAt: Date }> {
  const batch = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(hours)]);
  const [slot] = await slotsOf(db.pool, batch);
  const id = await chooseAs(db.pool, pair.mentor, slot.id);
  const row = await db.pool.query<{ starts_at: Date }>("SELECT starts_at FROM meetings WHERE id = $1", [id]);
  return { id, startsAt: row.rows[0].starts_at };
}

async function checkIns(recipient: string): Promise<{ category: string; email_status: string; link: string; payload: any }[]> {
  return (
    await db.pool.query(
      `SELECT category::text AS category, email_status, link, payload
         FROM notifications WHERE recipient_id = $1 AND template = 'meeting-check-in' ORDER BY created_at`,
      [recipient],
    )
  ).rows;
}

const at = (start: Date, ms: number) => new Date(start.getTime() + ms);

describe("complete-past-meetings", () => {
  it("past_meeting_completes_once", async () => {
    const pair = await makePair(db.pool);
    const soon = await meetingIn(pair, 24);
    const later = await meetingIn(pair, 24 * 5);

    // During the meeting nothing changes; once its 45 minutes are over it completes.
    expect(await run("complete-past-meetings", at(soon.startsAt, 30 * 60_000))).toEqual({ completed: 0 });
    expect((await meetingRow(db.pool, soon.id)).status).toBe("upcoming");
    expect(await run("complete-past-meetings", at(soon.startsAt, HOUR))).toEqual({ completed: 1 });
    expect((await meetingRow(db.pool, soon.id)).status).toBe("completed");
    expect((await meetingRow(db.pool, later.id)).status).toBe("upcoming");
    // Again: nothing more to do.
    expect(await run("complete-past-meetings", at(soon.startsAt, 2 * HOUR))).toEqual({ completed: 0 });

    const audits = await db.pool.query("SELECT detail FROM audit_log WHERE action = 'meeting.completed'");
    expect(audits.rows).toEqual([{ detail: { count: 1 } }]);
  });

  it("leaves_answered_and_canceled_meetings_alone", async () => {
    const pair = await makePair(db.pool);
    const canceled = await meetingIn(pair, 24);
    await runAs(db.pool, pair.mentee, "SELECT cancel_meeting($1)", [canceled.id]);
    expect(await run("complete-past-meetings", at(canceled.startsAt, 2 * DAY))).toEqual({ completed: 0 });
    expect((await meetingRow(db.pool, canceled.id)).status).toBe("canceled");
  });
});

describe("meeting-check-in", () => {
  it("check_in_once_a_day_after", async () => {
    const pair = await makePair(db.pool);
    const meeting = await meetingIn(pair, 24);

    // The same evening: too early.
    expect(await run("meeting-check-in", at(meeting.startsAt, 6 * HOUR))).toEqual({ asked: 0 });
    expect(await checkIns(pair.mentee)).toEqual([]);

    // A day after the start, both parties are asked once.
    expect(await run("meeting-check-in", at(meeting.startsAt, DAY + HOUR))).toEqual({ asked: 1 });
    const mentee = await checkIns(pair.mentee);
    const mentor = await checkIns(pair.mentor);
    expect(mentee).toHaveLength(1);
    expect(mentor).toHaveLength(1);
    expect(mentee[0]).toMatchObject({
      category: "reminder",
      email_status: "queued",
      link: `/network/me/requests/${pair.requestId}`,
      payload: { meetingId: meeting.id, otherFirstName: "Layla" },
    });
    expect(mentor[0]).toMatchObject({ link: `/network/mentor/mentees/${pair.requestId}`, payload: { otherFirstName: "Amina" } });

    // However often it runs afterwards, nobody is asked again.
    expect(await run("meeting-check-in", at(meeting.startsAt, 2 * DAY))).toEqual({ asked: 0 });
    expect(await run("meeting-check-in", at(meeting.startsAt, 9 * DAY))).toEqual({ asked: 0 });
    expect(await checkIns(pair.mentee)).toHaveLength(1);
    expect((await meetingRow(db.pool, meeting.id)).check_in_sent_at).not.toBeNull();
  });

  it("skips_answered_and_canceled_meetings", async () => {
    const pair = await makePair(db.pool);
    const canceled = await meetingIn(pair, 24);
    await runAs(db.pool, pair.mentor, "SELECT cancel_meeting($1)", [canceled.id]);
    const answered = await meetingIn(pair, 30);
    await db.pool.query("UPDATE meetings SET starts_at = now() - interval '2 days' WHERE id = $1", [answered.id]);
    await runAs(db.pool, pair.mentee, "SELECT record_meeting_outcome($1, true)", [answered.id]);
    expect(await run("meeting-check-in", at(canceled.startsAt, 3 * DAY))).toEqual({ asked: 0 });
    expect(await checkIns(pair.mentee)).toEqual([]);
  });

  it("refuses_an_acting_user", async () => {
    const pair = await makePair(db.pool);
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [pair.mentee]);
        await client.query("SELECT meeting_prompt(now())");
      }),
    ).rejects.toThrow(/mest\.forbidden/);
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [pair.mentee]);
        await client.query("SELECT complete_past_meetings(now())");
      }),
    ).rejects.toThrow(/mest\.forbidden/);
  });
});
