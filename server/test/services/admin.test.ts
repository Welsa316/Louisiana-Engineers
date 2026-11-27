import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Paged } from "@shared/types/common";
import type {
  AdminConfig,
  AdminDashboard,
  AdminMember,
  AdminReviewDetail,
  AdminReviewItem,
  AdminRole,
  AdminTag,
  AdminVocabularyLists,
} from "@shared/types/admin";
import { seedRequestId } from "../../seed/requests";
import { SEED, runSeed } from "../../seed/seed";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminRoutes } from "../../src/routes/admin";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, visibleProfileIds } from "../policies/fixtures";
import { acceptRequest, makeMentor, makeStudent, sendRequest } from "../policies/request-fixtures";

/**
 * The administration area's routes (`/api/admin/*`) over the 0004 admin
 * functions: the review queue, verification and hiding, the members list,
 * administrators, tags, vocabulary and configuration.
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
  await db.pool.query(
    `UPDATE config SET value = CASE key
       WHEN 'request_expiry_days' THEN '14'::jsonb WHEN 'reminder_days' THEN '[5, 10]'::jsonb
       WHEN 'pending_cap' THEN '3'::jsonb WHEN 'platform_paused' THEN 'false'::jsonb ELSE value END`,
  );
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(new Hono().route("/admin", adminRoutes));

async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

/** Two administrators (the minimum) and a cookie for the first. */
async function admins(): Promise<{ admin: string; admin2: string; cookie: string }> {
  const admin = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Ada", lastName: "Admin" });
  const admin2 = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Bea", lastName: "Admin" });
  return { admin, admin2, cookie: await cookieFor(admin) };
}

/** A professional who finished onboarding and waits in the queue. */
async function submitted(overrides: Record<string, unknown> = {}): Promise<{ profile: string; review: string }> {
  const profile = await newAccount(db.pool, { email: `${overrides.firstName ?? "noor"}-${Date.now()}@delta-drainage.test` });
  await onboard(db.pool, profile, professionalPayload(overrides));
  const review = await db.pool.query<{ id: string }>("SELECT id FROM profile_reviews WHERE profile_id = $1", [profile]);
  return { profile, review: review.rows[0].id };
}

describe("review queue", () => {
  it("review_approve_lists_and_notifies", async () => {
    const { admin, cookie } = await admins();
    const { profile, review } = await submitted();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    // Waiting: in the queue, invisible to visitors and members.
    const queue = await json<Paged<AdminReviewItem>>(await call(cookie, "GET", "/reviews?status=pending"));
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({
      id: review,
      profileId: profile,
      firstName: "Noor",
      title: "Water Resources Engineer",
      organization: "Delta Drainage Partners",
      disciplineLabel: "Coastal & environmental",
      decision: null,
      approvalState: "pending",
      wantsToMentor: true,
    });
    expect(await visibleProfileIds(db.pool, null)).not.toContain(profile);

    // The detail shows the submission and the sign-up domain, never the address.
    const detail = await json<AdminReviewDetail>(await call(cookie, "GET", `/reviews/${review}`));
    expect(detail.snapshot).toMatchObject({ firstName: "Noor", bio: expect.any(String), expertise: expect.any(Array) });
    expect(detail.emailDomain).toBe("delta-drainage.test");
    expect(JSON.stringify(detail)).not.toMatch(/@/);

    const res = await call(cookie, "POST", `/reviews/${review}`, { decision: "approved" });
    expect(res.status, await res.clone().text()).toBe(200);

    // Listed: a visitor and a member now read it, in the directory view too.
    expect(await visibleProfileIds(db.pool, null)).toContain(profile);
    expect((await rowsAs(db.pool, member, "SELECT id FROM directory_entries")).map((r) => r.id)).toContain(profile);
    // The member is told, and the decision is audited as the administrator.
    const notes = await db.pool.query("SELECT template FROM notifications WHERE recipient_id = $1", [profile]);
    expect(notes.rows.map((r) => r.template)).toContain("profile-approved");
    const audit = await db.pool.query("SELECT actor_id FROM audit_log WHERE action = 'profile.approved' AND subject_id = $1", [
      profile,
    ]);
    expect(audit.rows).toEqual([{ actor_id: admin }]);
    // The queue is empty again; the approved tab holds it.
    expect((await json<Paged<AdminReviewItem>>(await call(cookie, "GET", "/reviews?status=pending"))).total).toBe(0);
    const approved = await json<Paged<AdminReviewItem>>(await call(cookie, "GET", "/reviews?status=approved"));
    expect(approved.items.map((r) => r.id)).toEqual([review]);
    // A decided review stays decided.
    const again = await call(cookie, "POST", `/reviews/${review}`, { decision: "declined", notes: "Too late." });
    expect(await json(again, 409)).toEqual({ code: "review_closed" });
  });

  it("review_decline_keeps_hidden_with_notes", async () => {
    const { cookie } = await admins();
    const { profile, review } = await submitted();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    // Declining needs notes: they are what the member reads.
    const missing = await call(cookie, "POST", `/reviews/${review}`, { decision: "declined" });
    expect((await json<{ code: string }>(missing, 400)).code).toBe("validation");

    const notes = "Please describe the projects you lead and remove the consultation offer.";
    expect((await call(cookie, "POST", `/reviews/${review}`, { decision: "declined", notes })).status).toBe(200);

    // Still unlisted for visitors and members.
    expect(await visibleProfileIds(db.pool, null)).not.toContain(profile);
    expect(await visibleProfileIds(db.pool, member)).not.toContain(profile);
    // The owner reads the decision and the notes, and was told them.
    expect(await rowsAs(db.pool, profile, "SELECT decision, notes FROM profile_reviews WHERE profile_id = app_uid()")).toEqual([
      { decision: "declined", notes },
    ]);
    const told = await db.pool.query("SELECT template, body FROM notifications WHERE recipient_id = $1", [profile]);
    expect(told.rows).toContainEqual({ template: "profile-declined", body: notes });

    // The declined tab holds it with the notes.
    const declined = await json<Paged<AdminReviewItem>>(await call(cookie, "GET", "/reviews?status=declined"));
    expect(declined.items).toHaveLength(1);
    expect(declined.items[0]).toMatchObject({ id: review, decision: "declined", notes, approvalState: "declined" });

    // A resubmission is a new queue row that shows the earlier decision beside it.
    await onboard(db.pool, profile, professionalPayload({ bio: `${"I lead drainage studies for parishes. ".repeat(4)}`.trim() }));
    const queue = await json<Paged<AdminReviewItem>>(await call(cookie, "GET", "/reviews?status=pending"));
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].previousReviews).toBe(1);
    const detail = await json<AdminReviewDetail>(await call(cookie, "GET", `/reviews/${queue.items[0].id}`));
    expect(detail.history).toEqual([expect.objectContaining({ id: review, decision: "declined", notes })]);
  });

  it("unknown_review_is_404_and_bad_status_is_400", async () => {
    const { cookie } = await admins();
    expect((await call(cookie, "GET", "/reviews/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call(cookie, "GET", "/reviews/not-a-uuid")).status).toBe(400);
    expect((await call(cookie, "GET", "/reviews?status=everything")).status).toBe(400);
  });
});

describe("profile actions", () => {
  it("verify_hide_and_restore", async () => {
    const { cookie } = await admins();
    const listed = await makePerson(db.pool, { firstName: "Layla" });

    const verified = await call(cookie, "POST", `/profiles/${listed}/verified`, { method: "work_email" });
    expect(verified.status).toBe(200);
    expect(
      (await db.pool.query("SELECT verified, verified_method FROM professional_details WHERE profile_id = $1", [listed])).rows,
    ).toEqual([{ verified: true, verified_method: "work_email" }]);
    expect((await call(cookie, "POST", `/profiles/${listed}/verified`, { method: null })).status).toBe(200);
    expect(
      (await db.pool.query("SELECT verified FROM professional_details WHERE profile_id = $1", [listed])).rows[0].verified,
    ).toBe(false);
    expect((await call(cookie, "POST", `/profiles/${listed}/verified`, { method: "guesswork" })).status).toBe(400);

    expect((await call(cookie, "POST", `/profiles/${listed}/hide`)).status).toBe(200);
    expect(await visibleProfileIds(db.pool, null)).not.toContain(listed);
    expect((await call(cookie, "POST", `/profiles/${listed}/restore`)).status).toBe(200);
    expect(await visibleProfileIds(db.pool, null)).toContain(listed);
  });
});

describe("members", () => {
  it("members_list_has_no_email", async () => {
    const { cookie } = await admins();
    await makePerson(db.pool, { firstName: "Layla", lastName: "Haddad", email: "layla.haddad@coastal-firm.test" });
    const hidden = await makePerson(db.pool, { firstName: "Tariq", lastName: "Mansour", adminHidden: true });
    await makePerson(db.pool, { kind: "student", firstName: "Amina", lastName: "Rahman", visibility: "hidden" });

    const res = await call(cookie, "GET", "/members");
    const text = await res.clone().text();
    const all = await json<Paged<AdminMember>>(res);
    expect(all.total).toBe(5);
    // Not one address: the domain alone.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/layla\.haddad/);
    const layla = all.items.find((m) => m.firstName === "Layla");
    expect(layla).toMatchObject({ emailDomain: "coastal-firm.test", kind: "professional", isAdmin: false, adminHidden: false });
    expect(layla).not.toHaveProperty("email");
    expect(all.items.find((m) => m.id === hidden)).toMatchObject({ adminHidden: true });
    expect(all.items.filter((m) => m.isAdmin)).toHaveLength(2);

    // Search by name, paged.
    const found = await json<Paged<AdminMember>>(await call(cookie, "GET", "/members?q=hadd"));
    expect(found.items.map((m) => m.lastName)).toEqual(["Haddad"]);
    const page = await json<Paged<AdminMember>>(await call(cookie, "GET", "/members?page=2&size=2"));
    expect(page).toMatchObject({ total: 5 });
    expect(page.items).toHaveLength(2);
    expect((await call(cookie, "GET", "/members?size=51")).status).toBe(400);
  });
});

describe("administrators", () => {
  it("grant_and_revoke_keep_two", async () => {
    const { admin, admin2, cookie } = await admins();
    const candidate = await makePerson(db.pool, { firstName: "Cara", lastName: "Candidate" });

    const page = await json<Paged<AdminRole>>(await call(cookie, "GET", "/admins"));
    expect(page.total).toBe(2);
    const listed = page.items;
    expect(listed.map((a) => a.profileId).sort()).toEqual([admin, admin2].sort());
    expect(listed.find((a) => a.profileId === admin)?.isSelf).toBe(true);

    // Two is the minimum: revoking either is refused.
    expect(await json(await call(cookie, "DELETE", `/admins/${admin2}`), 409)).toEqual({ code: "admin_minimum" });

    expect((await call(cookie, "POST", "/admins", { profileId: candidate })).status).toBe(200);
    const three = (await json<Paged<AdminRole>>(await call(cookie, "GET", "/admins?page=1&size=2")));
    expect(three.total).toBe(3);
    expect(three.items).toHaveLength(2);
    const all = (await json<Paged<AdminRole>>(await call(cookie, "GET", "/admins"))).items;
    expect(all.find((a) => a.profileId === candidate)).toMatchObject({ grantedByName: "Ada Admin" });

    expect((await call(cookie, "DELETE", `/admins/${candidate}`)).status).toBe(200);
    expect((await json<Paged<AdminRole>>(await call(cookie, "GET", "/admins"))).items.map((a) => a.profileId)).not.toContain(candidate);
    expect((await call(cookie, "POST", "/admins", { profileId: "nope" })).status).toBe(400);
  });
});

describe("tags and vocabulary", () => {
  it("tags_and_vocabulary_round_trip", async () => {
    const { cookie } = await admins();
    await submitted({ expertise: ["Hydraulic modeling", "Marsh hydrology"] });

    const proposed = await json<Paged<AdminTag>>(await call(cookie, "GET", "/tags?status=proposed"));
    const marsh = proposed.items.find((t) => t.label === "Marsh hydrology");
    expect(marsh).toMatchObject({ status: "proposed", proposedByName: "Noor Bayou", usage: 1 });
    expect((await call(cookie, "POST", `/tags/${marsh!.id}`, { decision: "approved" })).status).toBe(200);
    const approved = await json<Paged<AdminTag>>(await call(cookie, "GET", "/tags?status=approved"));
    expect(approved.items.map((t) => t.label)).toContain("Marsh hydrology");
    expect((await call(cookie, "POST", `/tags/${marsh!.id}`, { decision: "proposed" })).status).toBe(400);

    expect(
      (await call(cookie, "POST", "/vocabulary", { kind: "discipline", id: "geotechnical", label: "Geotechnical", groupName: "Engineering" }))
        .status,
    ).toBe(200);
    expect((await call(cookie, "POST", "/vocabulary", { kind: "topic", id: "public-speaking", label: "Public speaking" })).status).toBe(
      200,
    );
    expect(await json(await call(cookie, "POST", "/vocabulary", { kind: "topic", id: "public-speaking", label: "Again" }), 409)).toEqual({
      code: "duplicate",
    });
    const lists = await json<AdminVocabularyLists>(await call(cookie, "GET", "/vocabulary"));
    expect(lists.disciplines.find((d) => d.id === "geotechnical")).toEqual({
      id: "geotechnical",
      label: "Geotechnical",
      groupName: "Engineering",
      active: true,
    });
    expect(lists.topics.at(-1)).toMatchObject({ id: "public-speaking" });
  });
});

describe("dashboard and configuration", () => {
  it("dashboard_counts", async () => {
    const { cookie } = await admins();
    await submitted();
    await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const counts = await json<AdminDashboard>(await call(cookie, "GET", "/dashboard"));
    expect(counts).toMatchObject({ approvedProfessionals: 2, pendingProfessionals: 1, students: 1, activeMentors: 0 });
    // Nothing to measure yet: rates and medians are null, not zero.
    expect(counts).toMatchObject({
      requestsSent: 0,
      answeredWithin7DaysPct: null,
      acceptanceRatePct: null,
      expiryRatePct: null,
      medianHoursToApproval: null,
      medianPausedDays: null,
      oldestOpenReportAt: null,
      requestsByTopic: [],
    });
    expect(counts.byMonth.map((m) => m.requestsSent)).toEqual([0, 0, 0]);
  });

  it("dashboard_leaves_withdrawn_requests_out_of_the_answer_rates", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const mentor = await makeMentor(db.pool);
    const answered = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    await acceptRequest(db.pool, mentor, answered);
    // Withdrawn by its mentee after ten days: no mentor ever owed it an answer.
    const mentee = await makeStudent(db.pool);
    const withdrawn = await sendRequest(db.pool, mentee, mentor);
    await asUser(db.pool, mentee, (client) => client.query("SELECT cancel_request($1)", [withdrawn]));
    await db.pool.query("UPDATE mentorship_requests SET created_at = now() - interval '10 days' WHERE id = $1", [withdrawn]);

    const got = await json<AdminDashboard>(await call(await cookieFor(admin), "GET", "/dashboard"));
    expect(got).toMatchObject({ answeredWithin7DaysPct: 100, acceptanceRatePct: 100, expiryRatePct: 0 });
  });

  it("dashboard_matches_hand_counts", async () => {
    await runSeed();
    const cookie = await cookieFor(SEED.admin.id);
    const id = (key: string) => SEED[key].id;

    // Arranged on top of the seed, each with a known answer:
    // an introduction, which the mentorship measures leave out;
    await sendRequest(db.pool, id("amina-rahman"), id("ibrahim-okafor"), { kind: "introduction" });
    // the seed's three submissions, decided after 6, 30 and 72 hours (median 30);
    const open = await db.pool.query<{ id: string }>("SELECT id FROM profile_reviews WHERE decision IS NULL ORDER BY profile_id");
    expect(open.rows).toHaveLength(3);
    const decisions = [
      { body: { decision: "approved" }, hours: 6 },
      { body: { decision: "declined", notes: "Add your current role." }, hours: 30 },
      { body: { decision: "approved" }, hours: 72 },
    ];
    for (const [i, row] of open.rows.entries()) {
      expect((await call(cookie, "POST", `/reviews/${row.id}`, decisions[i].body)).status).toBe(200);
      await db.pool.query("UPDATE profile_reviews SET submitted_at = decided_at - $2::interval WHERE id = $1", [
        row.id,
        `${decisions[i].hours} hours`,
      ]);
    }
    // Fatima (seeded paused) 10 days into her pause and Nadia 4 days (median
    // 7); Zainab paused 30 days but hidden by an administrator, so not counted.
    for (const key of ["nadia-el-amin", "zainab-qureshi"]) {
      await asUser(db.pool, id(key), (client) => client.query("SELECT set_mentorship_status('paused', current_date + 30)"));
    }
    const started = await db.pool.query<{ fresh: boolean }>(
      "SELECT paused_at > now() - interval '1 minute' AS fresh FROM mentorship_settings WHERE profile_id = $1",
      [id("nadia-el-amin")],
    );
    expect(started.rows).toEqual([{ fresh: true }]);
    const pauses: [string, number][] = [
      ["fatima-noor", 10],
      ["nadia-el-amin", 4],
      ["zainab-qureshi", 30],
    ];
    for (const [key, days] of pauses) {
      await db.pool.query("UPDATE mentorship_settings SET paused_at = now() - $2::interval WHERE profile_id = $1", [
        id(key),
        `${days} days`,
      ]);
    }
    expect((await call(cookie, "POST", `/profiles/${id("zainab-qureshi")}/hide`)).status).toBe(200);
    // Yusuf at his limit (one accepted mentee, limit 1) is not an active mentor.
    await db.pool.query("UPDATE mentorship_settings SET max_active = 1 WHERE profile_id = $1", [id("yusuf-hassan")]);
    // Leen's pending request to Layla (req-1004) declined because Layla left
    // (what the deletion flow records): no mentor answered it.
    await db.pool.query(
      "UPDATE mentorship_requests SET status = 'declined', decline_reason = 'member_left', responded_at = now() WHERE id = $1",
      [seedRequestId("req-1004")],
    );
    // Hamza has not been seen for 200 days.
    await db.pool.query("UPDATE profiles SET last_active_at = now() - interval '200 days' WHERE id = $1", [id("hamza-ali")]);

    const got = await json<AdminDashboard>(await call(cookie, "GET", "/dashboard"));

    // The request measures, counted by hand from server/seed/requests.ts:
    // nine mentorship requests; answered within 7 days are 1001, 1002, 1005,
    // 1006 and 1007, of the seven whose first week is over or that a mentor
    // answered (1003 is pending and younger, 1004 ended with member_left);
    // accepted 1001, 1005, 1006 (completed) and 1007 against declined 1002;
    // expired 1008 and 1009, of the eight no longer pending.
    expect(got).toMatchObject({
      requestsSent: 9,
      introductionsSent: 1,
      answeredWithin7DaysPct: 71,
      acceptanceRatePct: 80,
      expiryRatePct: 25,
      activeRelationships: 3,
      completedRelationships: 1,
      medianHoursToApproval: 30,
      pausedMentors: 2,
      medianPausedDays: 7,
      pendingProfessionals: 0,
    });
    const labels = new Map(
      (await db.pool.query<{ id: string; label: string }>("SELECT id, label FROM mentorship_topics")).rows.map((t) => [t.id, t.label]),
    );
    const topic = (topicId: string, requests: number) => ({ topicId, label: labels.get(topicId), requests });
    expect(got.requestsByTopic).toEqual([
      topic("internships-and-first-jobs", 2),
      topic("resume-and-portfolio", 2),
      topic("choosing-a-major", 1),
      topic("leadership-and-management", 1),
      topic("negotiating-offers", 1),
      topic("professional-licensure", 1),
      topic("research-and-publishing", 1),
    ]);

    // The people measures, counted here from the raw rows.
    const profiles = (
      await db.pool.query<{
        id: string;
        kind: string | null;
        approval_state: string;
        hidden: boolean;
        anonymized: boolean;
        deleted: boolean;
        inactive: boolean;
      }>(
        `SELECT p.id, p.kind::text AS kind, p.approval_state::text AS approval_state,
                p.admin_hidden_at IS NOT NULL AS hidden, p.anonymized_at IS NOT NULL AS anonymized,
                u.deleted_at IS NOT NULL AS deleted,
                coalesce(p.last_active_at, p.created_at) < now() - interval '6 months' AS inactive
           FROM profiles p JOIN users u ON u.id = p.id`,
      )
    ).rows;
    const settings = (
      await db.pool.query<{ profile_id: string; status: string; max_active: number }>(
        "SELECT profile_id, status::text AS status, max_active FROM mentorship_settings",
      )
    ).rows;
    const relationships = (
      await db.pool.query<{ mentor_id: string; kind: string; completed: boolean }>(
        `SELECT rel.mentor_id, r.kind::text AS kind, rel.completed_at IS NOT NULL AS completed
           FROM mentorship_relationships rel JOIN mentorship_requests r ON r.id = rel.request_id`,
      )
    ).rows;
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const live = profiles.filter((p) => !p.anonymized);
    const busy = (mentor: string) =>
      relationships.filter((r) => r.mentor_id === mentor && r.kind === "mentorship" && !r.completed).length;
    const listedActive = settings.filter((s) => {
      const p = byId.get(s.profile_id)!;
      return s.status === "active" && p.approval_state === "approved" && !p.hidden && !p.anonymized;
    });
    const activeMentors = listedActive.filter((s) => busy(s.profile_id) < s.max_active).length;
    expect(activeMentors).toBeLessThan(listedActive.length); // Yusuf is full: the free-slot rule is exercised
    const inactive = live.filter((p) => !p.deleted && p.inactive).length;
    expect(inactive).toBeGreaterThan(0);
    const reports = (
      await db.pool.query<{ created_at: Date }>("SELECT created_at FROM reports WHERE status = 'open' ORDER BY created_at")
    ).rows;
    expect(reports.length).toBeGreaterThan(0);
    expect(got).toMatchObject({
      approvedProfessionals: live.filter((p) => p.kind === "professional" && p.approval_state === "approved").length,
      pendingProfessionals: live.filter((p) => p.kind === "professional" && p.approval_state === "pending").length,
      students: live.filter((p) => p.kind === "student").length,
      activeMentors,
      membersInactive6Months: inactive,
      openReports: reports.length,
      oldestOpenReportAt: reports[0].created_at.toISOString(),
    });

    // The last three months (America/Chicago), counted from the request rows.
    const monthOf = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(d);
      return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
    };
    const [year, month] = monthOf(new Date()).split("-").map(Number);
    const months = [2, 1, 0].map((back) => {
      const d = new Date(Date.UTC(year, month - 1 - back, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const requests = (
      await db.pool.query<{ kind: string; status: string; reason: string | null; created_at: Date; responded_at: Date | null }>(
        "SELECT kind::text AS kind, status::text AS status, decline_reason AS reason, created_at, responded_at FROM mentorship_requests",
      )
    ).rows.filter((r) => r.kind === "mentorship");
    const completions = (
      await db.pool.query<{ completed_at: Date }>(
        `SELECT rel.completed_at FROM mentorship_relationships rel JOIN mentorship_requests r ON r.id = rel.request_id
          WHERE r.kind = 'mentorship' AND rel.completed_at IS NOT NULL`,
      )
    ).rows;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    expect(got.byMonth).toEqual(
      months.map((m) => {
        const sent = requests.filter((r) => monthOf(r.created_at) === m);
        return {
          month: m,
          requestsSent: sent.length,
          answeredWithin7Days: sent.filter(
            (r) =>
              ["accepted", "declined", "completed"].includes(r.status) &&
              r.reason !== "member_left" &&
              r.responded_at !== null &&
              r.responded_at.getTime() - r.created_at.getTime() <= WEEK_MS,
          ).length,
          expired: sent.filter((r) => r.status === "expired").length,
          completedRelationships: completions.filter((c) => monthOf(c.completed_at) === m).length,
        };
      }),
    );
    expect(got.byMonth.reduce((n, m) => n + m.requestsSent, 0)).toBeGreaterThan(0);
  });

  it("config_update_audited", async () => {
    const { admin, cookie } = await admins();

    // Lowering the expiry below the stored reminders works when both change together.
    const res = await call(cookie, "PATCH", "/config", { request_expiry_days: 8, reminder_days: [3, 6], pending_cap: 4 });
    const config = await json<AdminConfig>(res);
    expect(config).toMatchObject({ request_expiry_days: 8, reminder_days: [3, 6], pending_cap: 4, platform_paused: false });
    expect(await json<AdminConfig>(await call(cookie, "GET", "/config"))).toEqual(config);

    // And raising it with later reminders.
    await json<AdminConfig>(await call(cookie, "PATCH", "/config", { request_expiry_days: 21, reminder_days: [7, 14] }));

    const audit = await db.pool.query<{ actor_id: string; key: string; value: unknown }>(
      "SELECT actor_id, detail->>'key' AS key, detail->'value' AS value FROM audit_log WHERE action = 'config.updated' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.actor_id)).toEqual(Array(5).fill(admin));
    expect(audit.rows.map((r) => r.key).sort()).toEqual(
      ["pending_cap", "reminder_days", "reminder_days", "request_expiry_days", "request_expiry_days"].sort(),
    );

    // A patch the schema refuses changes nothing; one the function refuses rolls back whole.
    expect((await call(cookie, "PATCH", "/config", { pending_cap: 11 })).status).toBe(400);
    expect((await call(cookie, "PATCH", "/config", { surprise: 1 })).status).toBe(400);
    expect(await json(await call(cookie, "PATCH", "/config", { pending_cap: 2, reminder_days: [22] }), 409)).toEqual({
      code: "invalid_config",
    });
    expect((await json<AdminConfig>(await call(cookie, "GET", "/config"))).pending_cap).toBe(4);
  });
});

describe("access", () => {
  it("non_admin_403", async () => {
    await admins();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const memberCookie = await cookieFor(member);
    const { review } = await submitted();

    const reads = ["/dashboard", "/reviews?status=pending", `/reviews/${review}`, "/members", "/admins", "/tags", "/vocabulary", "/config"];
    for (const path of reads) {
      expect(await json(await call(memberCookie, "GET", path), 403)).toEqual({ code: "not_admin" });
      expect(await json(await call(null, "GET", path), 401)).toEqual({ code: "unauthenticated" });
    }
    const writes: [string, string, unknown?][] = [
      ["POST", `/reviews/${review}`, { decision: "approved" }],
      ["POST", `/profiles/${member}/hide`],
      ["POST", "/admins", { profileId: member }],
      ["PATCH", "/config", { pending_cap: 5 }],
    ];
    for (const [method, path, body] of writes) {
      expect(await json(await call(memberCookie, method, path, body), 403)).toEqual({ code: "not_admin" });
    }
    // Nothing moved.
    expect((await db.pool.query("SELECT decision FROM profile_reviews WHERE id = $1", [review])).rows[0].decision).toBeNull();
    expect((await db.pool.query("SELECT count(*)::int AS n FROM admin_roles")).rows[0].n).toBe(2);

    // An administrator's write still needs the app's Origin.
    const { cookie } = await admins();
    const foreign = await app.request(`/api/admin/reviews/${review}`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(await json(foreign, 403)).toEqual({ code: "bad_origin" });
  });
});
