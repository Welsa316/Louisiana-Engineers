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
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminRoutes } from "../../src/routes/admin";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, visibleProfileIds } from "../policies/fixtures";

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
    expect(counts).toEqual({ approvedProfessionals: 2, pendingProfessionals: 1, students: 1, activeMentors: 0 });
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
