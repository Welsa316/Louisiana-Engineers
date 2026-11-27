import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DirectoryResponse } from "@shared/types/directory";
import type { AdminReport, AdminReportsResponse, AdminRequestsResponse, ReportCreated } from "@shared/types/reports";
import type { RequestDetail } from "@shared/types/requests";
import { SEED_REPORTS, seedReportId, seedReports } from "../../seed/reports";
import { runSeed } from "../../seed/seed";
import { seedUserId } from "../../seed/users";
import { createSession } from "../../src/auth/session";
import { withSystem, wrapClient } from "../../src/db/tx";
import { directoryRoutes } from "../../src/routes/directory";
import { adminReportRoutes, profileReportRoutes } from "../../src/routes/reports";
import { requestRoutes } from "../../src/routes/requests";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs } from "../policies/fixtures";
import {
  MENTOR_PHONE,
  WHY,
  acceptRequest,
  makeMentor,
  makeStudent,
  resetRequestConfig,
  sendRequest,
  setConfig,
} from "../policies/request-fixtures";

/**
 * Reports and moderation (Task 24): `POST /api/profiles/:id/report` for
 * members and `/api/admin/reports*` and `/api/admin/requests` for
 * administrators, over `report_profile`, `admin_resolve_report` and the
 * `admin_requests` view in 0007, through the real guards and `withUser`.
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
  await setConfig(db.pool, "daily_report_limit", 3);
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(
  new Hono()
    .route("/profiles", profileReportRoutes)
    .route("/admin", adminReportRoutes)
    .route("/directory", directoryRoutes)
    .route("/requests", requestRoutes),
);

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Call {
  status: number;
  body: any;
}

async function call(userId: string | null, method: string, path: string, body?: unknown): Promise<Call> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (userId) headers.cookie = `mest_session=${await cookieFor(userId)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function admins(): Promise<{ admin: string; admin2: string }> {
  const admin = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Ada", lastName: "Admin" });
  const admin2 = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Bea", lastName: "Admin" });
  return { admin, admin2 };
}

const DETAIL = "The bio advertises a paid consultation rather than offering mentorship.";
const NOTE = "Spoke with the member; the bio was edited to remove the advertisement.";

async function report(reporter: string, profile: string, body: Record<string, unknown> = {}): Promise<Call> {
  return call(reporter, "POST", `/profiles/${profile}/report`, { reason: "promotional", detail: DETAIL, ...body });
}

async function notificationsOf(recipient: string) {
  return (
    await db.pool.query<{
      template: string;
      category: string;
      email_status: string;
      title: string;
      body: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT template, category::text AS category, email_status, title, body, payload
         FROM notifications WHERE recipient_id = $1 ORDER BY created_at, id`,
      [recipient],
    )
  ).rows;
}

async function outboxFor(userId: string) {
  return (
    await db.pool.query<{ template: string; payload: Record<string, unknown> }>(
      `SELECT o.template, o.payload FROM email_outbox o JOIN users u ON u.email = o.to_email
        WHERE u.id = $1 ORDER BY o.created_at`,
      [userId],
    )
  ).rows;
}

async function directoryIds(viewer: string | null): Promise<string[]> {
  const res = await call(viewer, "GET", "/directory?size=50");
  expect(res.status).toBe(200);
  return (res.body as DirectoryResponse).items.map((item) => item.id);
}

describe("filing a report", () => {
  it("report_files_and_notifies_admins_without_the_detail", async () => {
    const { admin, admin2 } = await admins();
    const pro = await makePerson(db.pool, { firstName: "Bilal", lastName: "Chowdhury" });
    const reporter = await makeStudent(db.pool, { firstName: "Amina" });

    const res = await report(reporter, pro);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { id } = res.body as ReportCreated;

    const stored = await db.pool.query(
      "SELECT profile_id, reporter_id, reason::text, detail, status::text FROM reports WHERE id = $1",
      [id],
    );
    expect(stored.rows[0]).toEqual({
      profile_id: pro,
      reporter_id: reporter,
      reason: "promotional",
      detail: DETAIL,
      status: "open",
    });

    // Every active administrator hears about it; the first open report is emailed at once.
    for (const who of [admin, admin2]) {
      const [note] = await notificationsOf(who);
      expect(note).toMatchObject({ template: "report-received", category: "report", email_status: "queued" });
      expect(JSON.stringify(note)).not.toContain(DETAIL);
      expect(JSON.stringify(note)).not.toContain(reporter);
      expect(JSON.stringify(note)).not.toContain("Amina");
    }
    // A second report while one is open waits for the digest: in-app only.
    const other = await makeStudent(db.pool);
    expect((await report(other, pro)).status).toBe(201);
    const second = (await notificationsOf(admin))[1];
    expect(second).toMatchObject({ template: "report-received", email_status: "skipped" });
    expect((await outboxFor(admin)).map((o) => o.template)).toEqual(["report-received"]);
    // The reported member is told nothing.
    expect(await notificationsOf(pro)).toEqual([]);
  });

  it("report_rate_limited", async () => {
    await admins();
    const reporter = await makeStudent(db.pool);
    const targets = await Promise.all([1, 2, 3, 4].map(() => makePerson(db.pool)));
    for (const target of targets.slice(0, 3)) {
      expect((await report(reporter, target)).status).toBe(201);
    }
    const refused = await report(reporter, targets[3]);
    expect(refused).toEqual({ status: 409, body: { code: "rate_limited" } });

    // The limit is the config row, not a constant.
    await setConfig(db.pool, "daily_report_limit", 4);
    expect((await report(reporter, targets[3])).status).toBe(201);

    // Only the last 24 hours count.
    await setConfig(db.pool, "daily_report_limit", 1);
    const later = await makePerson(db.pool);
    expect((await report(reporter, later)).status).toBe(409);
    await db.pool.query("UPDATE reports SET created_at = now() - interval '25 hours' WHERE reporter_id = $1", [reporter]);
    expect((await report(reporter, later)).status).toBe(201);
  });

  it("report_requires_a_member_and_a_visible_profile", async () => {
    const pro = await makePerson(db.pool);
    const reporter = await makeStudent(db.pool);
    // A visitor is asked to sign in.
    expect((await report(null as unknown as string, pro)).status).toBe(401);
    // A suspended account is not a member.
    const suspended = await makeStudent(db.pool, { suspended: true });
    expect((await report(suspended, pro)).body).toEqual({ code: "not_member" });
    // A profile the reporter cannot see does not exist for them.
    const hidden = await makePerson(db.pool, { visibility: "hidden" });
    expect((await report(reporter, hidden)).status).toBe(404);
    expect((await call(reporter, "POST", "/profiles/not-a-uuid/report", { reason: "spam" })).status).toBe(404);
    // Nobody reports themselves.
    expect((await report(pro, pro)).body).toEqual({ code: "invalid_report" });
    // The shared schema: a known reason, at most 1000 characters of detail.
    expect((await report(reporter, pro, { reason: "rude" })).status).toBe(400);
    expect((await report(reporter, pro, { detail: "x".repeat(1001) })).status).toBe(400);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM reports")).rows[0].n).toBe(0);
  });
});

describe("who can read a report", () => {
  it("reported_member_cannot_read_report", async () => {
    const { admin } = await admins();
    const pro = await makePerson(db.pool, { firstName: "Bilal" });
    const reporter = await makeStudent(db.pool);
    const bystander = await makeStudent(db.pool);
    const { id } = (await report(reporter, pro)).body as ReportCreated;
    await call(admin, "POST", `/admin/reports/${id}/resolve`, { status: "resolved", note: NOTE });

    // The reported member sees no row, and nothing names the reporter anywhere they can read.
    expect(await rowsAs(db.pool, pro, "SELECT id FROM reports")).toEqual([]);
    expect(await rowsAs(db.pool, bystander, "SELECT id FROM reports")).toEqual([]);
    expect(await rowsAs(db.pool, null, "SELECT id FROM reports")).toEqual([]);
    expect(JSON.stringify(await notificationsOf(pro))).not.toContain(reporter);

    // The reporter sees their own row's status, never the resolution note or who resolved it.
    const own = await rowsAs(db.pool, reporter, "SELECT id, status::text AS status FROM reports");
    expect(own).toEqual([{ id, status: "resolved" }]);
    await expect(rowsAs(db.pool, reporter, "SELECT resolution_note FROM reports")).rejects.toThrow(/permission denied/);
    await expect(rowsAs(db.pool, reporter, "SELECT resolved_by FROM reports")).rejects.toThrow(/permission denied/);

    // Nobody writes the table directly, not even an administrator.
    await expect(
      asUser(db.pool, admin, (client) => client.query("UPDATE reports SET status = 'dismissed' WHERE id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, reporter, (client) =>
        client.query("INSERT INTO reports (profile_id, reporter_id, reason) VALUES ($1, $2, 'spam')", [pro, reporter]),
      ),
    ).rejects.toThrow(/permission denied/);

    // Only administrators get the admin list.
    expect((await call(reporter, "GET", "/admin/reports")).status).toBe(403);
    expect((await call(pro, "GET", "/admin/reports")).status).toBe(403);
    expect((await call(reporter, "GET", "/admin/requests")).status).toBe(403);
    expect((await call(reporter, "POST", `/admin/reports/${id}/resolve`, { status: "dismissed" })).status).toBe(403);
  });

  it("admin_lists_open_reports_with_the_reporter", async () => {
    const { admin } = await admins();
    const pro = await makePerson(db.pool, { firstName: "Bilal", lastName: "Chowdhury", title: "Structural Engineer" });
    const reporter = await makeStudent(db.pool, { firstName: "Amina", lastName: "Rahman" });
    const { id } = (await report(reporter, pro)).body as ReportCreated;

    const open = (await call(admin, "GET", "/admin/reports?status=open")).body as AdminReportsResponse;
    expect(open.total).toBe(1);
    expect(open.items[0]).toMatchObject({
      id,
      status: "open",
      reason: "promotional",
      detail: DETAIL,
      resolutionNote: null,
      action: null,
      profile: {
        id: pro,
        firstName: "Bilal",
        lastName: "Chowdhury",
        title: "Structural Engineer",
        adminHidden: false,
        suspended: false,
      },
      reporter: { id: reporter, firstName: "Amina", lastName: "Rahman" },
      openReportsOnProfile: 1,
    });
    // No address or contact value reaches the list.
    expect(JSON.stringify(open)).not.toMatch(/@/);
    expect((await call(admin, "GET", "/admin/reports?status=resolved")).body).toEqual({ items: [], total: 0 });
    expect((await call(admin, "GET", "/admin/reports?status=bogus")).status).toBe(400);
  });
});

describe("resolving a report", () => {
  it("resolve_hide_removes_from_directory_and_pauses_mentoring", async () => {
    const { admin } = await admins();
    const mentor = await makeMentor(db.pool, { firstName: "Bilal" });
    const reporter = await makeStudent(db.pool);
    expect(await directoryIds(null)).toContain(mentor);
    const { id } = (await report(reporter, mentor)).body as ReportCreated;

    const res = await call(admin, "POST", `/admin/reports/${id}/resolve`, {
      status: "resolved",
      action: "hide_profile",
      note: NOTE,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body as AdminReport).toMatchObject({
      status: "resolved",
      action: "hide_profile",
      resolutionNote: NOTE,
      resolvedBy: { id: admin },
      profile: { adminHidden: true },
      openReportsOnProfile: 0,
    });

    // Gone from the directory for visitors and members, and mentoring is off with the old status kept.
    expect(await directoryIds(null)).not.toContain(mentor);
    expect(await directoryIds(reporter)).not.toContain(mentor);
    const settings = await db.pool.query(
      "SELECT status::text, previous_status::text FROM mentorship_settings WHERE profile_id = $1",
      [mentor],
    );
    expect(settings.rows[0]).toEqual({ status: "off", previous_status: "active" });

    // Closed once: a second resolution is refused.
    expect((await call(admin, "POST", `/admin/reports/${id}/resolve`, { status: "dismissed" })).body).toEqual({
      code: "report_closed",
    });

    // Audited as the administrator, without the reporter's text.
    const audit = await db.pool.query(
      "SELECT actor_id, detail FROM audit_log WHERE action = 'report.resolved' AND subject_id = $1",
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(admin);
    expect(audit.rows[0].detail).toMatchObject({ status: "resolved", action: "hide_profile" });
    expect(JSON.stringify(audit.rows[0].detail)).not.toContain(DETAIL);
  });

  it("suspend_blocks_request_creation", async () => {
    const { admin } = await admins();
    const mentor = await makeMentor(db.pool);
    const other = await makeMentor(db.pool);
    const student = await makeStudent(db.pool, { firstName: "Hamza" });
    const reporter = await makeStudent(db.pool);
    // Before: the student can ask.
    await sendRequest(db.pool, student, other);

    // The mentor the student asked can see the student, so can report them.
    const { id } = (await report(other, student)).body as ReportCreated;
    const res = await call(admin, "POST", `/admin/reports/${id}/resolve`, {
      status: "resolved",
      action: "suspend_requests",
      note: NOTE,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as AdminReport).profile.suspended).toBe(true);

    // A suspended account is no longer a member: no new request, by route or by function.
    const refused = await call(student, "POST", "/requests", {
      mentorId: mentor,
      kind: "mentorship",
      topicId: "internships-and-first-jobs",
      why: WHY,
      format: "one-time",
      mode: "online",
    });
    expect(refused).toEqual({ status: 403, body: { code: "not_member" } });
    await expect(sendRequest(db.pool, student, mentor)).rejects.toThrow(/mest\.forbidden/);

    // Told why, with no trace of who reported them or of the note.
    const notes = await notificationsOf(student);
    const moderation = notes.find((n) => n.template === "moderation-action");
    expect(moderation).toMatchObject({ category: "account", email_status: "queued" });
    expect(JSON.stringify(notes)).not.toContain(other);
    expect(JSON.stringify(notes)).not.toContain(NOTE);
    expect(JSON.stringify(await outboxFor(student))).not.toContain(NOTE);
    // A stranger cannot see a student at all, so cannot report one.
    expect((await report(reporter, student)).status).toBe(404);
  });

  it("reporter_status_without_note", async () => {
    const { admin } = await admins();
    const pro = await makePerson(db.pool, { firstName: "Bilal" });
    const reporter = await makeStudent(db.pool);
    const { id } = (await report(reporter, pro)).body as ReportCreated;

    await call(admin, "POST", `/admin/reports/${id}/resolve`, { status: "dismissed", note: NOTE });

    const notes = await notificationsOf(reporter);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ template: "report-status", category: "report", email_status: "queued" });
    expect(notes[0].payload).toMatchObject({ status: "dismissed" });
    expect(JSON.stringify(notes)).not.toContain(NOTE);
    expect(JSON.stringify(notes)).not.toContain(admin);
    const outbox = await outboxFor(reporter);
    expect(outbox.map((o) => o.template)).toEqual(["report-status"]);
    expect(JSON.stringify(outbox)).not.toContain(NOTE);
  });

  it("resolve_checks_status_and_action", async () => {
    const { admin, admin2 } = await admins();
    const pro = await makePerson(db.pool);
    const reporter = await makeStudent(db.pool);
    const { id } = (await report(reporter, pro)).body as ReportCreated;
    const path = `/admin/reports/${id}/resolve`;

    // The schema refuses a dismissal that acts, and an "open" resolution.
    expect((await call(admin, "POST", path, { status: "dismissed", action: "hide_profile" })).status).toBe(400);
    expect((await call(admin, "POST", path, { status: "open" })).status).toBe(400);
    // Removing an account arrives with account deletion (Task 26).
    expect((await call(admin, "POST", path, { status: "resolved", action: "remove_account" })).body).toEqual({
      code: "not_available",
    });
    // The function checks the same rules for a direct caller.
    await expect(
      asUser(db.pool, admin, (c) => c.query("SELECT admin_resolve_report($1, 'dismissed', NULL, 'hide_profile')", [id])),
    ).rejects.toThrow(/mest\.invalid_action/);
    await expect(
      asUser(db.pool, admin, (c) => c.query("SELECT admin_resolve_report($1, 'open', NULL, 'none')", [id])),
    ).rejects.toThrow(/mest\.invalid_status/);
    await expect(
      asUser(db.pool, reporter, (c) => c.query("SELECT admin_resolve_report($1, 'dismissed', NULL, 'none')", [id])),
    ).rejects.toThrow(/mest\.forbidden/);
    // An administrator cannot suspend themselves.
    const self = (await report(admin2, admin)).body as ReportCreated;
    expect(
      (await call(admin, "POST", `/admin/reports/${self.id}/resolve`, { status: "resolved", action: "suspend_requests" })).body,
    ).toEqual({
      code: "invalid_action",
    });
    // Unknown ids answer 404.
    expect(
      (await call(admin, "POST", "/admin/reports/00000000-0000-4000-8000-000000000000/resolve", { status: "dismissed" })).status,
    ).toBe(404);
    // Still open after every refusal.
    expect((await db.pool.query("SELECT status::text AS s FROM reports WHERE id = $1", [id])).rows[0].s).toBe("open");
  });
});

describe("requests under report", () => {
  it("admin_requests_masks_text_unless_reported", async () => {
    const { admin } = await admins();
    const mentor = await makeMentor(db.pool, { firstName: "Layla" });
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const bystander = await makeMentor(db.pool);
    const otherStudent = await makeStudent(db.pool);
    const reporter = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, student, mentor, { schedulingNote: "Evenings after 6 PM." });
    await acceptRequest(db.pool, mentor, requestId, ["email"], "Happy to help with the internship search.");
    const unrelated = await sendRequest(db.pool, otherStudent, bystander);

    const list = async () => ((await call(admin, "GET", "/admin/requests?size=50")).body as AdminRequestsResponse).items;
    const masked = await list();
    expect(masked).toHaveLength(2);
    for (const item of masked) {
      expect(item).toMatchObject({ underReport: false, why: null, goals: null, schedulingNote: null, mentorNote: null });
    }
    expect(masked.find((i) => i.id === requestId)).toMatchObject({
      kind: "mentorship",
      status: "accepted",
      topicLabel: "Internships and first jobs",
      mentee: { id: student, firstName: "Amina" },
      mentor: { id: mentor, firstName: "Layla" },
    });
    expect(JSON.stringify(masked)).not.toContain(WHY);

    // An open report about the mentor unmasks that pair's requests, and only theirs.
    const { id: reportId } = (await report(reporter, mentor)).body as ReportCreated;
    const reported = await list();
    expect(reported.find((i) => i.id === requestId)).toMatchObject({
      underReport: true,
      why: WHY,
      schedulingNote: "Evenings after 6 PM.",
      mentorNote: "Happy to help with the internship search.",
    });
    expect(reported.find((i) => i.id === unrelated)).toMatchObject({ underReport: false, why: null });
    // Filtering by a party narrows the list.
    const byMentor = (await call(admin, "GET", `/admin/requests?profile=${mentor}`)).body as AdminRequestsResponse;
    expect(byMentor.items.map((i) => i.id)).toEqual([requestId]);

    // Closing the report masks the text again.
    await call(admin, "POST", `/admin/reports/${reportId}/resolve`, { status: "dismissed" });
    expect((await list()).find((i) => i.id === requestId)).toMatchObject({ underReport: false, why: null });

    // The view answers nobody else, and the parties still read their own text through the table.
    expect(await rowsAs(db.pool, student, "SELECT id FROM admin_requests")).toEqual([]);
    expect(await rowsAs(db.pool, mentor, "SELECT id FROM admin_requests")).toEqual([]);
    // An administrator never reads the requests table directly.
    expect(await rowsAs(db.pool, admin, "SELECT id FROM mentorship_requests")).toEqual([]);
  });

  it("dashboard_counts_open_reports", async () => {
    const { admin } = await admins();
    const pro = await makePerson(db.pool);
    const reporter = await makeStudent(db.pool);
    const count = async () => (await rowsAs<{ n: number }>(db.pool, admin, "SELECT open_reports AS n FROM admin_dashboard"))[0].n;
    expect(await count()).toBe(0);
    const { id } = (await report(reporter, pro)).body as ReportCreated;
    await report(reporter, pro);
    expect(await count()).toBe(2);
    await call(admin, "POST", `/admin/reports/${id}/resolve`, { status: "dismissed" });
    expect(await count()).toBe(1);
    expect(await rowsAs(db.pool, reporter, "SELECT open_reports FROM admin_dashboard")).toEqual([]);
  });
});

describe("contact and answers stop with a suspension", () => {
  async function suspend(userId: string): Promise<void> {
    await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [userId]));
  }

  it("suspended_mentor_handoff_stops", async () => {
    const mentor = await makeMentor(db.pool, { methods: ["mest", "email", "phone"], share: [] });
    const student = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, student, mentor);
    await acceptRequest(db.pool, mentor, requestId, ["phone"]);

    const handoff = () =>
      rowsAs<{ method: string; value: string }>(db.pool, student, "SELECT method::text, value FROM get_request_handoff($1)", [
        requestId,
      ]);
    const released = () =>
      rowsAs<{ method: string; value: string }>(db.pool, student, "SELECT method::text, value FROM release_contact($1)", [
        mentor,
      ]);
    expect(await handoff()).toEqual([{ method: "phone", value: MENTOR_PHONE }]);
    expect(await released()).toEqual([{ method: "phone", value: MENTOR_PHONE }]);
    const detail = (await call(student, "GET", `/requests/${requestId}`)).body as RequestDetail;
    expect(detail.handoff?.methods).toEqual([{ method: "phone", value: MENTOR_PHONE }]);

    await suspend(mentor);
    expect(await handoff()).toEqual([]);
    expect(await released()).toEqual([]);
    const after = await call(student, "GET", `/requests/${requestId}`);
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body)).not.toContain(MENTOR_PHONE);
  });

  it("accepting_a_suspended_mentee_is_refused", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, student, mentor);
    await suspend(student);

    await expect(acceptRequest(db.pool, mentor, requestId, ["email"])).rejects.toThrow(/mest\.mentee_unavailable/);
    const res = await call(mentor, "POST", `/requests/${requestId}/respond`, { decision: "accept", shareMethods: ["email"] });
    expect(res).toEqual({ status: 409, body: { code: "mentee_unavailable" } });
    expect((await db.pool.query("SELECT status::text AS s FROM mentorship_requests WHERE id = $1", [requestId])).rows[0].s).toBe(
      "pending",
    );
    // Declining stays possible, so the request does not sit until it expires.
    const declined = await call(mentor, "POST", `/requests/${requestId}/respond`, {
      decision: "decline",
      declineReason: "other",
    });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
  });
});

describe("seed", () => {
  it("seed_reports_open_the_prototype_report_and_reset_on_rerun", async () => {
    await runSeed();
    await withSystem(seedReports);
    const musa = seedUserId("musa-grant");
    const rows = async () =>
      (await db.pool.query("SELECT id, profile_id, reporter_id, status::text AS status FROM reports ORDER BY created_at")).rows;
    expect(await rows()).toEqual([
      { id: seedReportId("rep-1"), profile_id: musa, reporter_id: seedUserId("admin2"), status: "open" },
    ]);
    expect(SEED_REPORTS).toHaveLength(1);
    // Written as the owner: no notification, no email.
    expect((await db.pool.query("SELECT count(*)::int AS n FROM notifications")).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n).toBe(0);

    // A report an end-to-end run files, and a resolution of the seeded one, are undone by a re-run.
    const amina = seedUserId("amina-rahman");
    expect((await report(amina, seedUserId("bilal-chowdhury"))).status).toBe(201);
    await call(seedUserId("admin"), "POST", `/admin/reports/${seedReportId("rep-1")}/resolve`, { status: "dismissed" });
    await withSystem(seedReports);
    expect(await rows()).toEqual([
      { id: seedReportId("rep-1"), profile_id: musa, reporter_id: seedUserId("admin2"), status: "open" },
    ]);
    // Reports about people the seed did not write are left alone.
    const stranger = await makePerson(db.pool);
    const other = await makeStudent(db.pool);
    expect((await report(other, stranger)).status).toBe(201);
    await withSystem(seedReports);
    expect(await rows()).toHaveLength(2);
  });
});
