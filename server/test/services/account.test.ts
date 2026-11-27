import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeletionResponse } from "@shared/types/account";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { deletionsJob } from "../../src/jobs/deletions";
import { clearJobs, registerJob, runJobOnce } from "../../src/jobs/scheduler";
import { accountRoutes } from "../../src/routes/account";
import { createAuthRoutes } from "../../src/routes/auth";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs, scalarAs, visibleProfileIds } from "../policies/fixtures";
import {
  WHY,
  acceptRequest,
  declineRequest,
  makeMentor,
  makeStudent,
  requestStatus,
  resetRequestConfig,
  sendRequest,
} from "../policies/request-fixtures";

/**
 * Account deletion (Task 26, 02 section 8): `POST|GET|DELETE /api/me/deletion`
 * through the real guards and `withUser`, the SQL functions behind them, and
 * the `deletions` job's sweep run through the scheduler with a clock moved
 * past the grace period.
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
  registerJob(deletionsJob);
});

const ORIGIN = "http://127.0.0.1:8787";
const DAY = 86_400_000;
const app = testApp(new Hono().route("/me", accountRoutes).route("/auth", createAuthRoutes({ trustProxy: true })));

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Call {
  status: number;
  body: any;
  location: string | null;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown): Promise<Call> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, location: res.headers.get("location") };
}

/** Asks for deletion as the member, confirming with their first name. */
async function requestDeletion(userId: string, confirmName = "Layla"): Promise<Call> {
  return call(await cookieFor(userId), "POST", "/me/deletion", { confirmName });
}

async function profileRow(id: string) {
  return (
    await db.pool.query<{
      first_name: string | null;
      last_name: string | null;
      credentials: string | null;
      bio: string | null;
      location: string | null;
      linkedin_url: string | null;
      website_url: string | null;
      visibility: string;
      kind: string | null;
      region: string;
      anonymized_at: Date | null;
    }>("SELECT * FROM profiles WHERE id = $1", [id])
  ).rows[0];
}

async function settingsRow(id: string) {
  return (
    await db.pool.query<{ status: string; previous_status: string | null; paused_until: string | null }>(
      "SELECT status::text, previous_status::text, paused_until::text FROM mentorship_settings WHERE profile_id = $1",
      [id],
    )
  ).rows[0];
}

async function notificationsFor(id: string) {
  return (
    await db.pool.query<{ template: string; category: string; email_status: string; title: string; payload: any }>(
      "SELECT template, category::text, email_status, title, payload FROM notifications WHERE recipient_id = $1 ORDER BY created_at",
      [id],
    )
  ).rows;
}

async function emailOf(id: string): Promise<string> {
  return (await db.pool.query<{ email: string }>("SELECT email::text FROM users WHERE id = $1", [id])).rows[0].email;
}

async function isMember(id: string): Promise<boolean> {
  return scalarAs<boolean>(db.pool, id, "SELECT is_member() AS value");
}

async function runSweep(now: Date): Promise<{ deleted: number; errored: number }> {
  const outcome = await runJobOnce("deletions", { now });
  expect(outcome.status).toBe("ran");
  return (outcome.status === "ran" ? outcome.result : undefined) as { deleted: number; errored: number };
}

/** The leaver's own phone; the other fixture mentors share MENTOR_PHONE. */
const LEAVER_PHONE = "+15045550199";

/** A mentor named Layla with a distinctive last name, contact values and a LinkedIn link. */
async function makeLeaver(options: Parameters<typeof makeMentor>[1] = {}): Promise<string> {
  const id = await makeMentor(db.pool, {
    firstName: "Layla",
    lastName: "Quintavalle",
    email: "layla.quintavalle@example.test",
    methods: ["mest", "email", "phone", "linkedin"],
    share: ["email", "linkedin"],
    contactEmail: "layla.work@example.test",
    phone: LEAVER_PHONE,
    ...options,
  });
  await asSystem(db.pool, (client) =>
    client.query(
      `UPDATE profiles SET credentials = 'PE', location = 'Metairie, LA',
              linkedin_url = 'https://www.linkedin.com/in/layla-quintavalle',
              website_url = 'https://quintavalle.example.test'
        WHERE id = $1`,
      [id],
    ),
  );
  return id;
}

describe("asking for deletion", () => {
  it("deletion_hides_immediately_and_cancels_sent", async () => {
    const leaver = await makeLeaver();
    const otherMentor = await makeMentor(db.pool, { firstName: "Fatima" });
    const sent = await sendRequest(db.pool, leaver, otherMentor);
    const visitorBefore = await visibleProfileIds(db.pool, null);
    expect(visitorBefore).toContain(leaver);

    // The typed confirmation must be the member's first name.
    const wrong = await requestDeletion(leaver, "Someone");
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("confirm_mismatch");
    expect((await profileRow(leaver)).visibility).toBe("public");

    const res = await requestDeletion(leaver, "  layla ");
    expect(res.status).toBe(200);
    const deletion = (res.body as DeletionResponse).deletion;
    expect(deletion).not.toBeNull();
    expect(deletion!.immediate).toBe(false);
    const executeAfter = new Date(deletion!.executeAfter).getTime();
    expect(Math.abs(executeAfter - (Date.now() + 14 * DAY))).toBeLessThan(60_000);
    expect(deletion!.executeOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Hidden from the directory at once, for visitors and members alike.
    expect((await profileRow(leaver)).visibility).toBe("hidden");
    expect(await visibleProfileIds(db.pool, null)).not.toContain(leaver);
    expect(await visibleProfileIds(db.pool, otherMentor)).not.toContain(leaver);
    expect(await isMember(leaver)).toBe(false);

    // Mentoring off, the previous status kept for a cancel.
    expect(await settingsRow(leaver)).toMatchObject({ status: "off", previous_status: "active" });

    // The request they sent is canceled; its mentor hears in the app only, with no name.
    expect(await requestStatus(db.pool, sent)).toBe("canceled");
    const mentorNotes = await notificationsFor(otherMentor);
    expect(mentorNotes).toHaveLength(2); // the request, then its withdrawal
    expect(mentorNotes[1]).toMatchObject({ category: "request", email_status: "skipped" });
    expect(mentorNotes[1].title).not.toContain("Layla");

    // The member is told, always by email, with the date it runs.
    const own = await notificationsFor(leaver);
    expect(own.map((n) => n.template)).toContain("deletion-requested");
    const told = own.find((n) => n.template === "deletion-requested")!;
    expect(told).toMatchObject({ category: "account", email_status: "queued" });
    expect(told.payload).toMatchObject({ firstName: "Layla", executeOn: deletion!.executeOn });

    // A second request is refused and changes nothing.
    const again = await requestDeletion(leaver);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("deletion_scheduled");
    const open = await db.pool.query("SELECT 1 FROM account_deletions WHERE profile_id = $1", [leaver]);
    expect(open.rowCount).toBe(1);
  });

  it("deletion_declines_received_pending", async () => {
    const leaver = await makeLeaver();
    const mentee = await makeStudent(db.pool, { firstName: "Amina" });
    const received = await sendRequest(db.pool, mentee, leaver);

    expect((await requestDeletion(leaver)).status).toBe(200);

    const row = (
      await db.pool.query<{ status: string; decline_reason: string; responded_at: Date | null }>(
        "SELECT status::text, decline_reason, responded_at FROM mentorship_requests WHERE id = $1",
        [received],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: "declined", decline_reason: "member_left" });
    expect(row.responded_at).not.toBeNull();

    // The mentee is told and emailed with the request-declined template.
    const notes = await notificationsFor(mentee);
    const closed = notes.find((n) => n.template === "request-declined");
    expect(closed).toBeDefined();
    expect(closed).toMatchObject({ category: "response", email_status: "queued" });
    expect(closed!.payload).toMatchObject({ reason: "member_left", requestId: received });
    const outbox = await db.pool.query<{ template: string }>(
      "SELECT template FROM email_outbox WHERE to_email = $1",
      [await emailOf(mentee)],
    );
    expect(outbox.rows.map((r) => r.template)).toEqual(["request-declined"]);
  });

  it("visibility_stays_hidden_during_grace", async () => {
    const leaver = await makeLeaver();
    const admin = await makePerson(db.pool, { admin: true });
    expect((await requestDeletion(leaver)).status).toBe(200);

    // The owner's own update matches no row (they are no longer a member).
    await runAs(db.pool, leaver, "UPDATE profiles SET visibility = 'public' WHERE id = app_uid()");
    expect((await profileRow(leaver)).visibility).toBe("hidden");
    // An administrator's direct write is refused by the guard.
    await expect(
      runAs(db.pool, admin, "UPDATE profiles SET visibility = 'public' WHERE id = $1", [leaver]),
    ).rejects.toThrow(/mest\.deletion_scheduled/);
    expect((await profileRow(leaver)).visibility).toBe("hidden");
    // Other columns an administrator may change still work.
    await runAs(db.pool, admin, "UPDATE profiles SET location = 'Kenner, LA' WHERE id = $1", [leaver]);
    expect((await profileRow(leaver)).location).toBe("Kenner, LA");
  });

  it("only_an_administrator_removes_at_once", async () => {
    const member = await makeLeaver();
    await expect(
      runAs(db.pool, member, "SELECT request_account_deletion(true, 'because')"),
    ).rejects.toThrow(/mest\.forbidden/);
    await expect(runAs(db.pool, null, "SELECT request_account_deletion(false, NULL)")).rejects.toThrow(/mest\.forbidden/);
    const deletions = await db.pool.query("SELECT 1 FROM account_deletions");
    expect(deletions.rowCount).toBe(0);
  });

  it("visitor_gets_401", async () => {
    expect((await call(null, "POST", "/me/deletion", { confirmName: "x" })).status).toBe(401);
    expect((await call(null, "GET", "/me/deletion")).status).toBe(401);
    expect((await call(null, "DELETE", "/me/deletion")).status).toBe(401);
  });
});

describe("administrators", () => {
  it("the_last_two_administrators_cannot_leave_or_be_removed", async () => {
    const one = await makePerson(db.pool, { admin: true, firstName: "Ada" });
    const two = await makePerson(db.pool, { admin: true, firstName: "Bea" });
    const refused = await call(await cookieFor(one), "POST", "/me/deletion", { confirmName: "Ada" });
    expect(refused).toMatchObject({ status: 409, body: { code: "admin_minimum" } });

    const reporter = await makeStudent(db.pool);
    const reportId = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'unsafe', NULL) AS value", [two]);
    await expect(
      runAs(db.pool, one, "SELECT admin_resolve_report($1, 'resolved', NULL, 'remove_account')", [reportId]),
    ).rejects.toThrow(/mest\.admin_minimum/);

    // With a third administrator, either is allowed.
    await makePerson(db.pool, { admin: true, firstName: "Cy" });
    expect((await call(await cookieFor(one), "POST", "/me/deletion", { confirmName: "Ada" })).status).toBe(200);
  });
});

describe("keeping the account", () => {
  it("cancel_restores_visibility", async () => {
    const resumeOn = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    const leaver = await makeLeaver({ visibility: "members", status: "paused", pausedUntil: resumeOn });
    const cookie = await cookieFor(leaver);
    expect((await call(cookie, "POST", "/me/deletion", { confirmName: "Layla" })).status).toBe(200);
    expect(await settingsRow(leaver)).toMatchObject({ status: "off", previous_status: "paused", paused_until: resumeOn });

    const status = await call(cookie, "GET", "/me/deletion");
    expect(status.status).toBe(200);
    expect(status.body.deletion).not.toBeNull();

    const kept = await call(cookie, "DELETE", "/me/deletion");
    expect(kept.status).toBe(200);
    expect(kept.body).toEqual({ deletion: null });

    expect((await profileRow(leaver)).visibility).toBe("members");
    expect(await settingsRow(leaver)).toEqual({ status: "paused", previous_status: null, paused_until: resumeOn });
    expect(await isMember(leaver)).toBe(true);
    const row = (
      await db.pool.query<{ canceled_at: Date | null; executed_at: Date | null }>(
        "SELECT canceled_at, executed_at FROM account_deletions WHERE profile_id = $1",
        [leaver],
      )
    ).rows[0];
    expect(row.canceled_at).not.toBeNull();
    expect(row.executed_at).toBeNull();

    const notes = await notificationsFor(leaver);
    const canceled = notes.find((n) => n.template === "deletion-canceled");
    expect(canceled).toMatchObject({ category: "account", email_status: "queued" });
    expect(canceled!.payload).toMatchObject({ firstName: "Layla" });

    expect((await call(cookie, "GET", "/me/deletion")).body).toEqual({ deletion: null });
    // Nothing left to cancel.
    const again = await call(cookie, "DELETE", "/me/deletion");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("no_deletion");

    // A canceled deletion leaves nothing for the sweep.
    expect(await runSweep(new Date(Date.now() + 15 * DAY))).toEqual({ deleted: 0, errored: 0 });
    expect((await profileRow(leaver)).anonymized_at).toBeNull();
  });

  it("cancel_leaves_an_administrator_hide_in_place", async () => {
    const leaver = await makeLeaver({ adminHidden: true });
    await asSystem(db.pool, (client) =>
      client.query("UPDATE mentorship_settings SET previous_status = 'active', status = 'off' WHERE profile_id = $1", [leaver]),
    );
    const cookie = await cookieFor(leaver);
    expect((await call(cookie, "POST", "/me/deletion", { confirmName: "Layla" })).status).toBe(200);
    expect(await settingsRow(leaver)).toMatchObject({ status: "off", previous_status: "active" });
    expect((await call(cookie, "DELETE", "/me/deletion")).status).toBe(200);
    // Still off: the administrator's restore brings mentoring back, not the cancel.
    expect(await settingsRow(leaver)).toMatchObject({ status: "off", previous_status: "active" });
    expect((await profileRow(leaver)).visibility).toBe("public");
  });
});

describe("signing in during the grace period", () => {
  it("signin_during_grace_routes_to_deletion_screen", async () => {
    const leaver = await makeLeaver();
    expect((await requestDeletion(leaver)).status).toBe(200);
    const address = await emailOf(leaver);

    const asked = await call(null, "POST", "/auth/magic-link", { email: address });
    expect(asked.status).toBe(202);
    const link = (await call(null, "GET", `/auth/dev-last-link?email=${encodeURIComponent(address)}`)).body.link as string;
    const token = new URL(link).searchParams.get("token")!;
    const res = await app.request("/api/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({ token }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/network/scheduled-for-deletion");
    const cookie = /mest_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    expect(cookie).toBeTruthy();

    // The grace screen reads the date from here, and the session says so too.
    const me = await call(cookie!, "GET", "/auth/me");
    expect(me.body.user.hasDeletionScheduled).toBe(true);
    const status = await call(cookie!, "GET", "/me/deletion");
    expect(status.body.deletion.executeOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Keep my account, from that session.
    expect((await call(cookie!, "DELETE", "/me/deletion")).status).toBe(200);
    expect((await call(cookie!, "GET", "/auth/me")).body.user.hasDeletionScheduled).toBe(false);
  });
});

describe("the sweep", () => {
  it("sweep_leaves_no_personal_field_and_keeps_request_counts", async () => {
    const leaver = await makeLeaver();
    const address = await emailOf(leaver);
    const otherMentor = await makeMentor(db.pool, { firstName: "Fatima" });
    const mentee = await makeStudent(db.pool, { firstName: "Amina" });
    const reported = await makeMentor(db.pool, { firstName: "Bilal" });

    // Everything a member leaves behind.
    await asSystem(db.pool, async (client) => {
      await client.query(
        `INSERT INTO education (profile_id, degree, field, school, year) VALUES ($1, 'BS', 'Civil Engineering', 'Quintavalle College', 2010)`,
        [leaver],
      );
      await client.query(
        `INSERT INTO expertise_tags (label, slug, status) VALUES ('Levee design', 'levee-design', 'approved')`,
      );
      await client.query(
        `INSERT INTO profile_expertise (profile_id, tag_id) SELECT $1, id FROM expertise_tags WHERE slug = 'levee-design'`,
        [leaver],
      );
      await client.query("INSERT INTO notification_preferences (profile_id) VALUES ($1)", [leaver]);
      await client.query("INSERT INTO saved_profiles (saver_id, saved_id) VALUES ($1, $2), ($2, $1)", [leaver, otherMentor]);
      await client.query(
        `INSERT INTO profile_reviews (profile_id, decision, notes, snapshot, decided_at)
         VALUES ($1, 'approved', 'Looks right.', '{"firstName": "Layla", "lastName": "Quintavalle"}', now())`,
        [leaver],
      );
      await client.query(
        "INSERT INTO auth_tokens (email, token_hash, expires_at) VALUES ($1, 'stale-token-hash', now() - interval '1 day')",
        [address],
      );
      await client.query("UPDATE users SET google_sub = 'google-quintavalle' WHERE id = $1", [leaver]);
    });
    await runAs(db.pool, leaver, "SELECT report_profile($1, 'spam', 'Posting the same link everywhere.')", [reported]);
    await cookieFor(leaver);

    // An accepted mentorship as the mentee (holding Fatima's slot), an
    // accepted one as the mentor, and an older declined one.
    const asMentee = await sendRequest(db.pool, leaver, otherMentor, { why: `${WHY} Quintavalle asking.` });
    await acceptRequest(db.pool, otherMentor, asMentee);
    const asMentor = await sendRequest(db.pool, mentee, leaver, { schedulingNote: "Weekday evenings." });
    await acceptRequest(db.pool, leaver, asMentor, ["email", "phone"]);
    const mentee2 = await makeStudent(db.pool, { firstName: "Omar" });
    const declined = await sendRequest(db.pool, mentee2, leaver);
    await declineRequest(db.pool, leaver, declined, "not_fit");
    const activeBefore = await scalarAs<number>(db.pool, otherMentor, "SELECT active_count AS value FROM my_mentorship_summary()");
    expect(activeBefore).toBe(1);

    const countRequests = async () =>
      (
        await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM mentorship_requests WHERE mentee_id = $1 OR mentor_id = $1",
          [leaver],
        )
      ).rows[0].n;
    const requestsBefore = await countRequests();
    expect(requestsBefore).toBe(3);

    expect((await requestDeletion(leaver)).status).toBe(200);

    // Nothing happens before the grace period ends.
    expect(await runSweep(new Date(Date.now() + 13 * DAY))).toEqual({ deleted: 0, errored: 0 });
    expect((await profileRow(leaver)).first_name).toBe("Layla");

    const after = new Date(Date.now() + 14 * DAY + 60_000);
    expect(await runSweep(after)).toEqual({ deleted: 1, errored: 0 });
    // Exactly once.
    expect(await runSweep(new Date(after.getTime() + DAY))).toEqual({ deleted: 0, errored: 0 });

    // The tombstone.
    const profile = await profileRow(leaver);
    expect(profile).toMatchObject({
      first_name: "Former",
      last_name: "member",
      credentials: null,
      bio: null,
      location: null,
      linkedin_url: null,
      website_url: null,
      visibility: "hidden",
      kind: "professional",
      region: "greater-new-orleans",
    });
    expect(profile.anonymized_at).not.toBeNull();
    const user = (
      await db.pool.query<{ email: string | null; google_sub: string | null; deleted_at: Date | null }>(
        "SELECT email, google_sub, deleted_at FROM users WHERE id = $1",
        [leaver],
      )
    ).rows[0];
    expect(user).toMatchObject({ email: null, google_sub: null });
    expect(user.deleted_at).not.toBeNull();

    // Per-member tables are empty for them.
    for (const [table, column] of [
      ["professional_details", "profile_id"],
      ["student_details", "profile_id"],
      ["education", "profile_id"],
      ["profile_expertise", "profile_id"],
      ["mentorship_settings", "profile_id"],
      ["mentor_topics", "profile_id"],
      ["contact_preferences", "profile_id"],
      ["saved_profiles", "saver_id"],
      ["saved_profiles", "saved_id"],
      ["notifications", "recipient_id"],
      ["notification_preferences", "profile_id"],
      ["sessions", "user_id"],
    ]) {
      const left = await db.pool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [leaver]);
      expect(left.rowCount, `${table}.${column}`).toBe(0);
    }
    expect((await db.pool.query("SELECT 1 FROM auth_tokens WHERE email = $1", [address])).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM email_outbox WHERE to_email = $1", [address])).rowCount).toBe(0);
    const review = (await db.pool.query<{ decision: string; snapshot: unknown }>(
      "SELECT decision::text, snapshot FROM profile_reviews WHERE profile_id = $1",
      [leaver],
    )).rows;
    expect(review).toEqual([{ decision: "approved", snapshot: {} }]);
    const report = (await db.pool.query<{ reporter_id: string | null; detail: string }>(
      "SELECT reporter_id, detail FROM reports WHERE profile_id = $1",
      [reported],
    )).rows;
    expect(report).toEqual([{ reporter_id: null, detail: "Posting the same link everywhere." }]);

    // Requests stay, counted, with their text gone; active ones are completed.
    expect(await countRequests()).toBe(requestsBefore);
    const requests = (
      await db.pool.query<{ id: string; status: string; why: string; goals: string | null; scheduling_note: string | null; mentor_note: string | null; decline_reason: string | null }>(
        `SELECT id, status::text, why, goals, scheduling_note, mentor_note, decline_reason
           FROM mentorship_requests WHERE mentee_id = $1 OR mentor_id = $1 ORDER BY created_at`,
        [leaver],
      )
    ).rows;
    expect(requests.map((r) => [r.id, r.status])).toEqual([
      [asMentee, "completed"],
      [asMentor, "completed"],
      [declined, "declined"],
    ]);
    for (const r of requests) {
      expect(r).toMatchObject({ why: "", goals: null, scheduling_note: null, mentor_note: null });
    }
    expect(requests[2].decline_reason).toBe("not_fit");
    const open = await db.pool.query(
      "SELECT 1 FROM mentorship_relationships WHERE (mentee_id = $1 OR mentor_id = $1) AND completed_at IS NULL",
      [leaver],
    );
    expect(open.rowCount).toBe(0);
    // Fatima's slot is free again.
    expect(await scalarAs<number>(db.pool, otherMentor, "SELECT active_count AS value FROM my_mentorship_summary()")).toBe(0);

    // The other party's history shows "Former member", with no text.
    const history = await rowsAs<{ counterparty_first_name: string; counterparty_last_name: string; counterparty_former: boolean; why: string }>(
      db.pool,
      mentee,
      "SELECT counterparty_first_name, counterparty_last_name, counterparty_former, why FROM my_requests WHERE id = $1",
      [asMentor],
    );
    expect(history).toEqual([
      { counterparty_first_name: "Former", counterparty_last_name: "member", counterparty_former: true, why: "" },
    ]);
    // The handoff is gone with the contact values.
    await expect(runAs(db.pool, mentee, "SELECT * FROM get_request_handoff($1)", [asMentor])).rejects.toThrow(
      /mest\.no_handoff/,
    );

    // No personal value of theirs is left anywhere in the database.
    const personal = [
      address,
      "layla.work@example.test",
      LEAVER_PHONE,
      "Quintavalle",
      "quintavalle",
      "linkedin.com/in/layla",
      "Metairie",
      "google-quintavalle",
      "Weekday evenings",
    ];
    const tables = (
      await db.pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    ).rows.map((r) => r.tablename);
    for (const table of tables) {
      const dump = await db.pool.query<{ row: string }>(`SELECT t::text AS row FROM "${table}" t`);
      for (const { row } of dump.rows) {
        for (const value of personal) {
          expect(row.toLowerCase().includes(value.toLowerCase()), `${table} still holds ${value}: ${row}`).toBe(false);
        }
      }
    }

    // The audit entry names the tombstone only.
    const audit = (
      await db.pool.query<{ actor_id: string | null; detail: Record<string, unknown> }>(
        "SELECT actor_id, detail FROM audit_log WHERE action = 'account.deleted' AND subject_id = $1",
        [leaver],
      )
    ).rows;
    expect(audit).toEqual([{ actor_id: null, detail: { immediate: false, reason: null } }]);

    // The old address can sign up again, as a new account.
    const fresh = await call(null, "POST", "/auth/magic-link", { email: address });
    expect(fresh.status).toBe(202);
    const link = (await call(null, "GET", `/auth/dev-last-link?email=${encodeURIComponent(address)}`)).body.link as string;
    const res = await app.request("/api/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({ token: new URL(link).searchParams.get("token")! }).toString(),
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/network/onboarding");
    const newId = (await db.pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [address])).rows[0].id;
    expect(newId).not.toBe(leaver);
  });

  it("admin_remove_account_deletes_at_the_next_sweep", async () => {
    const target = await makeLeaver();
    const reporter = await makeStudent(db.pool, { firstName: "Amina" });
    const admin = await makePerson(db.pool, { admin: true });
    await makePerson(db.pool, { admin: true });
    const waiting = await sendRequest(db.pool, reporter, target);
    const reportId = await scalarAs<string>(
      db.pool,
      reporter,
      "SELECT report_profile($1, 'unsafe', 'Asked me to meet somewhere private.') AS value",
      [target],
    );

    await runAs(db.pool, admin, "SELECT admin_resolve_report($1, 'resolved', 'Repeated unsafe behavior.', 'remove_account')", [
      reportId,
    ]);

    // Hidden at once, its requests closed, and due now.
    expect((await profileRow(target)).visibility).toBe("hidden");
    expect(await requestStatus(db.pool, waiting)).toBe("declined");
    const row = (
      await db.pool.query<{ immediate: boolean; reason: string; due: boolean }>(
        "SELECT immediate, reason, execute_after <= now() AS due FROM account_deletions WHERE profile_id = $1",
        [target],
      )
    ).rows[0];
    expect(row).toEqual({ immediate: true, reason: "Repeated unsafe behavior.", due: true });
    const report = (await db.pool.query<{ status: string; action: string }>(
      "SELECT status::text, action FROM reports WHERE id = $1",
      [reportId],
    )).rows[0];
    expect(report).toEqual({ status: "resolved", action: "remove_account" });
    // The member is told, without who reported them.
    const told = (await notificationsFor(target)).find((n) => n.template === "moderation-action");
    expect(told?.payload).toMatchObject({ action: "remove_account" });
    expect(JSON.stringify(told)).not.toContain("Amina");

    // They cannot keep the account from the grace screen.
    const kept = await call(await cookieFor(target), "DELETE", "/me/deletion");
    expect(kept.status).toBe(409);
    expect(kept.body.code).toBe("removed_by_admin");

    // A minute later the removal email has not gone yet, so the sweep waits for it.
    expect(await runSweep(new Date(Date.now() + 60_000))).toEqual({ deleted: 0, errored: 0 });
    expect(await runSweep(new Date(Date.now() + 2 * 3_600_000))).toEqual({ deleted: 1, errored: 0 });
    expect((await profileRow(target)).first_name).toBe("Former");
    const audit = (
      await db.pool.query<{ detail: Record<string, unknown> }>(
        "SELECT detail FROM audit_log WHERE action = 'account.deleted' AND subject_id = $1",
        [target],
      )
    ).rows;
    expect(audit).toEqual([{ detail: { immediate: true, reason: "Repeated unsafe behavior." } }]);
  });

  it("an_owner_deletion_already_open_becomes_immediate_on_removal", async () => {
    const target = await makeLeaver();
    const reporter = await makeStudent(db.pool);
    const admin = await makePerson(db.pool, { admin: true });
    const reportId = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'spam', NULL) AS value", [target]);
    expect((await requestDeletion(target)).status).toBe(200);
    await runAs(db.pool, admin, "SELECT admin_resolve_report($1, 'resolved', NULL, 'remove_account')", [reportId]);
    const rows = (
      await db.pool.query<{ immediate: boolean; reason: string; due: boolean; previous_visibility: string }>(
        "SELECT immediate, reason, execute_after <= now() AS due, previous_visibility::text FROM account_deletions WHERE profile_id = $1",
        [target],
      )
    ).rows;
    expect(rows).toEqual([{ immediate: true, reason: "Report: spam", due: true, previous_visibility: "public" }]);
  });

  it("sweep_removes_the_leavers_name_from_other_members_notifications", async () => {
    const leaver = await makeLeaver();
    const mentee = await makeStudent(db.pool, { firstName: "Amina" });
    await sendRequest(db.pool, mentee, leaver);
    expect((await requestDeletion(leaver)).status).toBe(200);
    expect(JSON.stringify(await notificationsFor(mentee))).toContain("Layla");

    await db.pool.query("UPDATE email_outbox SET sent_at = now()");
    expect(await runSweep(new Date(Date.now() + 15 * DAY))).toEqual({ deleted: 1, errored: 0 });
    const after = JSON.stringify(await notificationsFor(mentee));
    expect(after).not.toContain("Layla");
    expect(after).not.toContain("Quintavalle");
    expect(after).toContain("Former member");
  });

  it("the_sweep_is_for_the_jobs_only", async () => {
    const leaver = await makeLeaver();
    expect((await requestDeletion(leaver)).status).toBe(200);
    const id = (await db.pool.query<{ id: string }>("SELECT id FROM account_deletions WHERE profile_id = $1", [leaver])).rows[0].id;
    for (const caller of [leaver, await makePerson(db.pool, { admin: true })]) {
      await expect(runAs(db.pool, caller, "SELECT execute_account_deletion($1)", [id])).rejects.toThrow(/permission denied/);
      await expect(
        runAs(db.pool, caller, "SELECT schedule_account_deletion($1, true, NULL)", [leaver]),
      ).rejects.toThrow(/permission denied/);
    }
    // The table owner with an acting user set is refused too.
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [leaver]);
        await client.query("SELECT execute_account_deletion($1, now() + interval '30 days')", [id]);
      }),
    ).rejects.toThrow(/mest\.forbidden/);
    expect((await profileRow(leaver)).anonymized_at).toBeNull();
  });
});
