import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDigestJob } from "../../src/jobs/digest";
import { expireRequestsJob } from "../../src/jobs/expire-requests";
import { remindersJob } from "../../src/jobs/reminders";
import { resumePausedJob } from "../../src/jobs/resume-paused";
import { retentionJob } from "../../src/jobs/retention";
import { clearJobs, registerJob, runJobOnce } from "../../src/jobs/scheduler";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson } from "../policies/fixtures";
import {
  WHY,
  declineRequest,
  makeMentor,
  makeStudent,
  requestStatus,
  resetRequestConfig,
  sendRequest,
  setConfig,
} from "../policies/request-fixtures";

/**
 * The request lifecycle, retention and digest jobs (Task 21), run through the
 * scheduler's `runJobOnce` with the scheduler's `now`, so each test plays the
 * calendar forward and checks that every transition happens on its day and
 * exactly once, however often the job runs.
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
  await setConfig(db.pool, "retention_months", 24);
  clearJobs();
  for (const job of [expireRequestsJob, remindersJob, resumePausedJob, retentionJob, adminDigestJob]) registerJob(job);
});

const DAY = 86_400_000;

async function createdAt(requestId: string): Promise<Date> {
  const result = await db.pool.query<{ created_at: Date }>("SELECT created_at FROM mentorship_requests WHERE id = $1", [requestId]);
  return result.rows[0].created_at;
}

/** `n` days (plus a minute) after `start`. */
function dayOf(start: Date, n: number): Date {
  return new Date(start.getTime() + n * DAY + 60_000);
}

async function run(name: string, now: Date): Promise<unknown> {
  const outcome = await runJobOnce(name, { now });
  expect(outcome.status).toBe("ran");
  return outcome.status === "ran" ? outcome.result : undefined;
}

interface NotificationRow {
  template: string;
  category: string;
  email_status: string;
  link: string | null;
  payload: Record<string, unknown>;
  subject_id: string | null;
}

async function notificationsOf(recipient: string, template?: string): Promise<NotificationRow[]> {
  const rows = (
    await db.pool.query<NotificationRow>(
      `SELECT template, category::text AS category, email_status, link, payload, subject_id
         FROM notifications WHERE recipient_id = $1 ORDER BY created_at, id`,
      [recipient],
    )
  ).rows;
  return template ? rows.filter((row) => row.template === template) : rows;
}

async function remindersSent(requestId: string): Promise<number> {
  const result = await db.pool.query<{ reminders_sent: number }>("SELECT reminders_sent FROM mentorship_requests WHERE id = $1", [
    requestId,
  ]);
  return result.rows[0].reminders_sent;
}

describe("expire-requests", () => {
  it("expiry_at_day_14_once", async () => {
    expect(expireRequestsJob.name).toBe("expire-requests");
    expect(expireRequestsJob.everyMs).toBe(3_600_000);
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const id = await sendRequest(db.pool, student, mentor);
    const start = await createdAt(id);
    // A request sent a week later is not due when the first one is.
    const later = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await db.pool.query("UPDATE mentorship_requests SET created_at = created_at + interval '7 days', expires_at = expires_at + interval '7 days' WHERE id = $1", [later]);

    expect(await run("expire-requests", dayOf(start, 13))).toEqual({ expired: 0, errored: 0 });
    expect(await requestStatus(db.pool, id)).toBe("pending");

    expect(await run("expire-requests", dayOf(start, 14))).toEqual({ expired: 1, errored: 0 });
    expect(await requestStatus(db.pool, id)).toBe("expired");
    expect(await requestStatus(db.pool, later)).toBe("pending");

    // The hourly job keeps running; the request is expired and told once.
    expect(await run("expire-requests", new Date(dayOf(start, 14).getTime() + 3_600_000))).toEqual({ expired: 0, errored: 0 });
    expect(await run("expire-requests", dayOf(start, 15))).toEqual({ expired: 0, errored: 0 });
    const told = await notificationsOf(student, "request-expired");
    expect(told.map((n) => [n.category, n.email_status, n.link, n.subject_id])).toEqual([
      ["response", "queued", `/network/me/requests/${id}`, id],
    ]);
    const audits = await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'request.expired' AND subject_id = $1", [id]);
    expect(audits.rowCount).toBe(1);

    // An answered request is never expired, however late the job runs.
    await declineRequest(db.pool, mentor, later);
    expect(await run("expire-requests", dayOf(start, 40))).toEqual({ expired: 0, errored: 0 });
    expect(await requestStatus(db.pool, later)).toBe("declined");
  });

  it("expiry_carries_on_past_a_failing_row", async () => {
    const mentor = await makeMentor(db.pool);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(await sendRequest(db.pool, await makeStudent(db.pool), mentor));
    const start = await createdAt(ids[2]);
    // The middle request's update fails, the way a constraint or a lost
    // connection would; the others still expire and stay expired.
    await db.pool.query(`
      CREATE FUNCTION test_fail_expiring() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'expiring this one failed'; END $$;
      CREATE TRIGGER test_fail_expiring BEFORE UPDATE ON mentorship_requests FOR EACH ROW
        WHEN (NEW.status = 'expired' AND NEW.id = '${ids[1]}')
        EXECUTE FUNCTION test_fail_expiring();
    `);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await run("expire-requests", dayOf(start, 14))).toEqual({ expired: 2, errored: 1 });
    } finally {
      error.mockRestore();
      await db.pool.query("DROP TRIGGER test_fail_expiring ON mentorship_requests; DROP FUNCTION test_fail_expiring();");
    }
    expect(await Promise.all(ids.map((id) => requestStatus(db.pool, id)))).toEqual(["expired", "pending", "expired"]);
    // The next run picks the one that failed up.
    expect(await run("expire-requests", dayOf(start, 14))).toEqual({ expired: 1, errored: 0 });
    expect(await requestStatus(db.pool, ids[1])).toBe("expired");
  });
});

describe("reminders", () => {
  it("reminders_at_day_5_and_10_exactly_once", async () => {
    expect(remindersJob.name).toBe("reminders");
    expect(remindersJob.everyMs).toBe(86_400_000);
    const mentor = await makeMentor(db.pool);
    const id = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const start = await createdAt(id);

    // Daily, plus an extra run on each reminder day.
    const sent: Record<number, unknown> = {};
    for (const n of [1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9, 10, 10.5, 11, 12, 13]) sent[n] = await run("reminders", dayOf(start, n));

    for (const n of [1, 2, 3, 4, 5.5, 6, 7, 8, 9, 10.5, 11, 12, 13]) expect(sent[n], `day ${n}`).toEqual({ sent: 0, errored: 0 });
    expect(sent[5]).toEqual({ sent: 1, errored: 0 });
    expect(sent[10]).toEqual({ sent: 1, errored: 0 });
    expect(await remindersSent(id)).toBe(2);

    const reminders = await notificationsOf(mentor, "request-reminder");
    expect(reminders.map((n) => [n.category, n.email_status, n.link, n.payload.reminder])).toEqual([
      ["reminder", "queued", `/network/mentor/requests/${id}`, 1],
      ["reminder", "queued", `/network/mentor/requests/${id}`, 2],
    ]);
    // Nothing is sent once the request has expired.
    await run("expire-requests", dayOf(start, 14));
    await db.pool.query("UPDATE mentorship_requests SET reminders_sent = 0 WHERE id = $1", [id]);
    expect(await run("reminders", dayOf(start, 15))).toEqual({ sent: 0, errored: 0 });
  });

  it("reminders_after_a_missed_day_send_one_per_run", async () => {
    const mentor = await makeMentor(db.pool);
    const id = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const start = await createdAt(id);

    // The job did not run for eleven days: one reminder now, not both at once.
    expect(await run("reminders", dayOf(start, 11))).toEqual({ sent: 1, errored: 0 });
    expect(await remindersSent(id)).toBe(1);
    expect(await run("reminders", dayOf(start, 12))).toEqual({ sent: 1, errored: 0 });
    expect(await run("reminders", dayOf(start, 13))).toEqual({ sent: 0, errored: 0 });
    expect(await notificationsOf(mentor, "request-reminder")).toHaveLength(2);
  });

  it("reminders_follow_the_configured_days", async () => {
    await setConfig(db.pool, "reminder_days", [3]);
    const mentor = await makeMentor(db.pool);
    const id = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const start = await createdAt(id);

    expect(await run("reminders", dayOf(start, 2))).toEqual({ sent: 0, errored: 0 });
    expect(await run("reminders", dayOf(start, 3))).toEqual({ sent: 1, errored: 0 });
    for (const n of [5, 10, 12]) expect(await run("reminders", dayOf(start, n))).toEqual({ sent: 0, errored: 0 });
    expect(await remindersSent(id)).toBe(1);
  });
});

describe("resume-paused", () => {
  async function mentorState(id: string) {
    const result = await db.pool.query<{ status: string; paused_until: string | null }>(
      "SELECT status::text AS status, paused_until::text AS paused_until FROM mentorship_settings WHERE profile_id = $1",
      [id],
    );
    return result.rows[0];
  }

  it("resume_paused_on_date", async () => {
    expect(resumePausedJob.name).toBe("resume-paused");
    expect(resumePausedJob.everyMs).toBe(86_400_000);
    const paused = await makeMentor(db.pool, { status: "paused", pausedUntil: "2030-03-01" });
    const pausedLonger = await makeMentor(db.pool, { status: "paused", pausedUntil: "2030-04-15" });
    const active = await makeMentor(db.pool);

    expect(await run("resume-paused", new Date("2030-02-28T12:00:00Z"))).toEqual({ resumed: 0, errored: 0 });
    // 03:00 UTC on March 1 is still February 28 in Louisiana.
    expect(await run("resume-paused", new Date("2030-03-01T03:00:00Z"))).toEqual({ resumed: 0, errored: 0 });
    expect(await mentorState(paused)).toEqual({ status: "paused", paused_until: "2030-03-01" });

    expect(await run("resume-paused", new Date("2030-03-01T12:00:00Z"))).toEqual({ resumed: 1, errored: 0 });
    expect(await mentorState(paused)).toEqual({ status: "active", paused_until: null });
    expect(await mentorState(pausedLonger)).toEqual({ status: "paused", paused_until: "2030-04-15" });
    expect(await mentorState(active)).toEqual({ status: "active", paused_until: null });

    expect(await run("resume-paused", new Date("2030-03-02T12:00:00Z"))).toEqual({ resumed: 0, errored: 0 });
    const audits = await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'mentorship.resumed' AND subject_id = $1", [paused]);
    expect(audits.rowCount).toBe(1);

    // A date the job slept through still resumes the mentor.
    expect(await run("resume-paused", new Date("2030-05-01T12:00:00Z"))).toEqual({ resumed: 1, errored: 0 });
    expect(await mentorState(pausedLonger)).toEqual({ status: "active", paused_until: null });
  });
});

describe("retention", () => {
  interface TextRow {
    why: string;
    goals: string | null;
    scheduling_note: string | null;
    mentor_note: string | null;
    purged: boolean;
  }

  async function textOf(id: string): Promise<TextRow> {
    const result = await db.pool.query<TextRow>(
      "SELECT why, goals, scheduling_note, mentor_note, text_purged_at IS NOT NULL AS purged FROM mentorship_requests WHERE id = $1",
      [id],
    );
    return result.rows[0];
  }

  async function backdate(id: string, months: number): Promise<void> {
    await db.pool.query(
      `UPDATE mentorship_requests
          SET created_at = created_at - make_interval(months => $2),
              expires_at = expires_at - make_interval(months => $2)
        WHERE id = $1`,
      [id, months],
    );
  }

  it("retention_empties_text_after_24_months", async () => {
    expect(retentionJob.name).toBe("retention");
    expect(retentionJob.everyMs).toBe(86_400_000);
    const mentor = await makeMentor(db.pool);
    const declinedOld = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await declineRequest(db.pool, mentor, declinedOld);
    const expiredOld = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const declinedRecent = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await declineRequest(db.pool, mentor, declinedRecent);
    const pendingOld = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await backdate(declinedOld, 25);
    await backdate(expiredOld, 25);
    await backdate(declinedRecent, 23);
    await backdate(pendingOld, 25);
    expect(await run("expire-requests", new Date())).toEqual({ expired: 2, errored: 0 }); // expiredOld and pendingOld
    // Keep one old request pending, as a request the mentor never saw expire would not be.
    await db.pool.query("UPDATE mentorship_requests SET status = 'pending' WHERE id = $1", [pendingOld]);

    const now = new Date();
    expect(await run("retention", now)).toEqual({ purged: 2 });
    const emptied = { why: "", goals: null, scheduling_note: null, mentor_note: null, purged: true };
    expect(await textOf(declinedOld)).toEqual(emptied);
    expect(await textOf(expiredOld)).toEqual(emptied);
    // 23 months old: kept. Pending: never purged, whatever its age.
    expect(await textOf(declinedRecent)).toMatchObject({ why: WHY, purged: false });
    expect(await textOf(pendingOld)).toMatchObject({ why: WHY, purged: false });

    // Daily runs purge nothing twice.
    expect(await run("retention", new Date(now.getTime() + DAY))).toEqual({ purged: 0 });
    const audits = await db.pool.query<{ count: number }>(
      "SELECT (detail->>'count')::int AS count FROM audit_log WHERE action = 'request.text_purged'",
    );
    expect(audits.rows).toEqual([{ count: 2 }]);

    // The period is config.retention_months.
    await setConfig(db.pool, "retention_months", 6);
    expect(await run("retention", new Date(now.getTime() + 2 * DAY))).toEqual({ purged: 1 });
    expect(await textOf(declinedRecent)).toEqual(emptied);
  });
});

describe("admin-digest", () => {
  /** The oldest pending request's day in Louisiana, as the payload states it. */
  function louisianaDay(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(date);
  }

  it("digest_one_per_admin_at_most_weekly", async () => {
    expect(adminDigestJob.name).toBe("admin-digest");
    expect(adminDigestJob.everyMs).toBe(86_400_000);
    const adminA = await makePerson(db.pool, { admin: true });
    const adminB = await makePerson(db.pool, { admin: true });
    const revoked = await makePerson(db.pool, { admin: true });
    await db.pool.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [revoked]);
    const suspended = await makePerson(db.pool, { admin: true, suspended: true });

    // One profile waiting for review, one open report and one resolved, two
    // pending requests (the older from three days ago) and one answered.
    const applicant = await makePerson(db.pool, { approval: "pending" });
    await db.pool.query("INSERT INTO profile_reviews (profile_id) VALUES ($1)", [applicant]);
    const mentor = await makeMentor(db.pool);
    const reporter = await makeStudent(db.pool);
    await db.pool.query("INSERT INTO reports (profile_id, reporter_id, reason) VALUES ($1, $2, 'spam')", [mentor, reporter]);
    await db.pool.query(
      `INSERT INTO reports (profile_id, reporter_id, reason, status, resolved_at, action)
       VALUES ($1, $2, 'other', 'dismissed', now(), 'none')`,
      [mentor, reporter],
    );
    const oldest = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await db.pool.query("UPDATE mentorship_requests SET created_at = created_at - interval '3 days' WHERE id = $1", [oldest]);
    await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const answered = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await declineRequest(db.pool, mentor, answered);
    const oldestOn = louisianaDay(await createdAt(oldest));

    const start = new Date();
    expect(await run("admin-digest", start)).toEqual({ due: true, notified: 2 });

    for (const admin of [adminA, adminB]) {
      const [digest, ...rest] = await notificationsOf(admin);
      expect(rest).toEqual([]);
      expect(digest).toMatchObject({
        template: "admin-digest",
        category: "admin_digest",
        email_status: "queued",
        link: "/network/admin",
        payload: { queueSize: 1, openReports: 1, requestsWaiting: 2, oldestWaitingOn: oldestOn, link: "/network/admin" },
      });
    }
    expect(await notificationsOf(revoked)).toEqual([]);
    expect(await notificationsOf(suspended)).toEqual([]);
    const outbox = await db.pool.query<{ template: string; count: number }>(
      "SELECT template, count(*)::int AS count FROM email_outbox WHERE template = 'admin-digest' GROUP BY template",
    );
    expect(outbox.rows).toEqual([{ template: "admin-digest", count: 2 }]);

    // The job runs daily; the digest goes out at most once in seven days.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(await run("admin-digest", new Date(start.getTime() + n * DAY)), `day ${n}`).toEqual({ due: false, notified: 0 });
    }
    expect(await run("admin-digest", new Date(start.getTime() + 7 * DAY - 60_000))).toEqual({ due: false, notified: 0 });
    expect(await notificationsOf(adminA)).toHaveLength(1);

    expect(await run("admin-digest", new Date(start.getTime() + 7 * DAY))).toEqual({ due: true, notified: 2 });
    expect(await run("admin-digest", new Date(start.getTime() + 8 * DAY))).toEqual({ due: false, notified: 0 });
    for (const admin of [adminA, adminB]) expect(await notificationsOf(admin, "admin-digest")).toHaveLength(2);
    // Nobody else is told anything by the digest.
    const others = await db.pool.query("SELECT 1 FROM notifications WHERE template = 'admin-digest' AND recipient_id <> ALL ($1)", [
      [adminA, adminB],
    ]);
    expect(others.rowCount).toBe(0);
  });

  it("digest_with_nothing_waiting_still_reports_zeros", async () => {
    const admin = await makePerson(db.pool, { admin: true });
    expect(await run("admin-digest", new Date())).toEqual({ due: true, notified: 1 });
    const [digest] = await notificationsOf(admin, "admin-digest");
    expect(digest.payload).toEqual({ queueSize: 0, openReports: 0, requestsWaiting: 0, link: "/network/admin" });
  });

  it("lifecycle_functions_refuse_an_acting_user", async () => {
    const admin = await makePerson(db.pool, { admin: true });
    // app_user cannot call admin_digest at all, even as an administrator.
    await expect(asUser(db.pool, admin, (client) => client.query("SELECT admin_digest()"))).rejects.toThrow(/permission denied/);
    // And the owner refuses it with an acting user set.
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [admin]);
        await client.query("SELECT admin_digest()");
      }),
    ).rejects.toThrow(/mest.forbidden/);
    expect(await notificationsOf(admin)).toEqual([]);
  });
});
