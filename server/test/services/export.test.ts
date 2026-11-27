import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataExport } from "@shared/types/export";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { exportRoutes } from "../../src/routes/export";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs } from "../policies/fixtures";
import {
  MENTOR_PHONE,
  STUDENT_GOALS,
  WHY,
  acceptRequest,
  declineRequest,
  makeMentor,
  makeStudent,
  resetRequestConfig,
  sendRequest,
} from "../policies/request-fixtures";

/**
 * `GET /api/me/export` (Task 27, ACC-7): the caller's own data as a JSON
 * attachment. The other party of a request appears as a display name and
 * nothing else: no id, no title or organization, no contact value, no
 * student details. Audit entries come from `my_audit_entries()`, which
 * returns only entries whose subject is the caller and never names who
 * acted when that was somebody else.
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

const app = testApp(exportRoutes);

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Download {
  status: number;
  headers: Headers;
  text: string;
  body: any;
}

async function download(cookie: string | null): Promise<Download> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  const res = await app.request("/api/export", { headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
}

const LAYLA_CONTACT_EMAIL = "layla.contact@example.test";
const LAYLA_SIGNIN_EMAIL = "layla.signin@example.test";
const AMINA_SIGNIN_EMAIL = "amina.signin@example.test";
const LAYLA_TITLE = "Senior Coastal Engineer";
const LAYLA_ORGANIZATION = "Gulf Shore Partners";
const OMAR_ORGANIZATION = "Pontchartrain Design Group";
const AMINA_PROGRAM = "BS Civil Engineering, junior";
const LICENSURE_WHY = "I would like to understand the order of the licensure exams and the experience.";
const INTRO_WHY = "I would value an introduction to someone working on coastal restoration projects.";

/**
 * Amina (a student) asked Layla, who accepted and shared email and phone;
 * asked Omar, who declined; and asked Yusuf, whose account was later
 * deleted. Layla also got a request from Hamza, still pending.
 */
async function arrange() {
  const layla = await makeMentor(db.pool, {
    firstName: "Layla",
    lastName: "Haddad",
    email: LAYLA_SIGNIN_EMAIL,
    title: LAYLA_TITLE,
    organization: LAYLA_ORGANIZATION,
    methods: ["mest", "email", "phone"],
    share: ["email"],
    contactEmail: LAYLA_CONTACT_EMAIL,
  });
  const omar = await makeMentor(db.pool, { firstName: "Omar", lastName: "Siddiqui", organization: OMAR_ORGANIZATION });
  const yusuf = await makeMentor(db.pool, { firstName: "Yusuf", lastName: "Hassan" });
  const amina = await makeStudent(db.pool, { firstName: "Amina", lastName: "Rahman", email: AMINA_SIGNIN_EMAIL });
  const hamza = await makeStudent(db.pool, { firstName: "Hamza", lastName: "Ali", goals: "Learn to lead a project team well." });

  const accepted = await sendRequest(db.pool, amina, layla, { why: WHY });
  await acceptRequest(db.pool, layla, accepted, ["email", "phone"], "Happy to help, send your resume first.");
  const declined = await sendRequest(db.pool, amina, omar, { topic: "professional-licensure", why: LICENSURE_WHY });
  await declineRequest(db.pool, omar, declined, "no_capacity");
  const toYusuf = await sendRequest(db.pool, amina, yusuf, { kind: "introduction", why: INTRO_WHY });
  const fromHamza = await sendRequest(db.pool, hamza, layla, { why: "I am leading a student team for the first time." });

  // Yusuf's account is swept later. Only the tombstone flag is set, his
  // names are left in place, so the export has to go by the flag.
  await asSystem(db.pool, (client) => client.query("UPDATE profiles SET anonymized_at = now() WHERE id = $1", [yusuf]));

  return { layla, omar, yusuf, amina, hamza, accepted, declined, toYusuf, fromHamza };
}

describe("GET /api/me/export", () => {
  it("export_contains_own_data_and_only_display_names_for_others", async () => {
    const p = await arrange();

    const res = await download(await cookieFor(p.amina));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="mest-network-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const data = res.body as DataExport;
    expect(data.format).toBe("mest-network-export");
    expect(data.version).toBe(1);
    expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);

    // Her own profile and settings, in full.
    expect(data.profile).toMatchObject({ id: p.amina, kind: "student", firstName: "Amina", lastName: "Rahman" });
    expect(data.profile?.student).toMatchObject({ program: AMINA_PROGRAM, goals: STUDENT_GOALS });
    expect(data.settings).toMatchObject({ visibility: "hidden" });

    // Requests in the direction she sent them, with her own words in them.
    const byCounterparty = Object.fromEntries(data.requests.map((r) => [r.counterparty, r]));
    expect(Object.keys(byCounterparty).sort()).toEqual(["Former member", "Layla Haddad", "Omar Siddiqui"]);
    expect(byCounterparty["Layla Haddad"]).toMatchObject({
      id: p.accepted,
      role: "mentee",
      status: "accepted",
      why: WHY,
      mentorNote: "Happy to help, send your resume first.",
    });
    expect(byCounterparty["Omar Siddiqui"]).toMatchObject({ status: "declined", declineReason: "no_capacity" });
    expect(byCounterparty["Former member"]).toMatchObject({ kind: "introduction", why: INTRO_WHY });

    // The relationship that came of the accepted request.
    expect(data.relationships).toEqual([
      expect.objectContaining({
        requestId: p.accepted,
        role: "mentee",
        counterparty: "Layla Haddad",
        completedAt: null,
        completedBy: null,
        sharedMethods: ["email", "phone"],
      }),
    ]);

    // Her notifications (the accept and the decline reached her).
    expect(data.notifications.length).toBeGreaterThanOrEqual(2);
    for (const n of data.notifications) {
      expect(Object.keys(n).sort()).toEqual(["body", "category", "createdAt", "link", "readAt", "title"]);
    }

    // Nothing else about anyone else: no ids, no affiliation, no contact
    // value, no sign-in address, and none of Hamza's request to Layla.
    for (const leak of [
      p.layla,
      p.omar,
      p.yusuf,
      p.hamza,
      p.fromHamza,
      LAYLA_CONTACT_EMAIL,
      LAYLA_SIGNIN_EMAIL,
      MENTOR_PHONE,
      LAYLA_TITLE,
      LAYLA_ORGANIZATION,
      OMAR_ORGANIZATION,
      "Hassan",
      "Yusuf",
      "I am leading a student team",
    ]) {
      expect(res.text).not.toContain(leak);
    }
    // Her own sign-in address stays in users, as everywhere else.
    expect(res.text).not.toContain(AMINA_SIGNIN_EMAIL);
  });

  it("export_for_a_mentor_lists_received_requests_without_the_mentees_details", async () => {
    const p = await arrange();
    // Layla marks the mentorship with Amina completed.
    await runAs(db.pool, p.layla, "SELECT complete_relationship($1)", [p.accepted]);

    const res = await download(await cookieFor(p.layla));
    expect(res.status).toBe(200);
    const data = res.body as DataExport;

    expect(data.profile).toMatchObject({ id: p.layla, kind: "professional" });
    expect(data.profile?.professional).toMatchObject({ title: LAYLA_TITLE, organization: LAYLA_ORGANIZATION });
    // Her own contact preferences are hers to take with her.
    expect(data.settings?.contact).toMatchObject({ contactEmail: LAYLA_CONTACT_EMAIL, phone: MENTOR_PHONE });

    expect(data.requests.map((r) => [r.role, r.counterparty, r.status]).sort()).toEqual([
      ["mentor", "Amina Rahman", "completed"],
      ["mentor", "Hamza Ali", "pending"],
    ]);
    expect(data.relationships.map((r) => [r.role, r.counterparty, r.completedBy])).toEqual([["mentor", "Amina Rahman", "me"]]);
    expect(data.relationships[0].completedAt).not.toBeNull();

    // Amina's side of the same relationship was completed by the other party.
    const amina = (await download(await cookieFor(p.amina))).body as DataExport;
    expect(amina.relationships.map((r) => [r.counterparty, r.completedBy])).toEqual([["Layla Haddad", "them"]]);

    // The mentees' ids, programs, goals and addresses are not in it, and
    // nor are Amina's requests to other mentors.
    for (const leak of [
      p.amina,
      p.hamza,
      p.omar,
      p.declined,
      p.toYusuf,
      AMINA_SIGNIN_EMAIL,
      AMINA_PROGRAM,
      STUDENT_GOALS,
      "Learn to lead a project team well.",
      "A Louisiana research university",
      LICENSURE_WHY,
      "Omar",
    ]) {
      expect(res.text).not.toContain(leak);
    }
  });

  it("export_includes_only_audit_entries_about_the_caller", async () => {
    const p = await arrange();
    const admin = await makePerson(db.pool, { firstName: "Admin", lastName: "One", admin: true });

    // About Layla: an administrator verified her; Amina released her contact.
    await runAs(db.pool, admin, "SELECT admin_set_verified($1, 'linkedin')", [p.layla]);
    await runAs(db.pool, p.amina, "SELECT * FROM release_contact($1)", [p.layla]);
    // About Amina: a system entry whose detail was written without the strip.
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO audit_log (actor_id, action, subject_type, subject_id, detail)
         VALUES (NULL, 'test.raw', 'profile', $1, $2::jsonb)`,
        [p.amina, JSON.stringify({ kept: "yes", email: AMINA_SIGNIN_EMAIL, nested: { phone: "+15045550199" } })],
      ),
    );

    const layla = (await download(await cookieFor(p.layla))).body as DataExport;
    const laylaActions = layla.audit.map((a) => [a.action, a.actor]);
    expect(laylaActions).toContainEqual(["profile.verified", "other"]);
    expect(laylaActions).toContainEqual(["contact.viewed", "other"]);
    const laylaText = JSON.stringify(layla.audit);
    expect(laylaText).not.toContain(p.amina);
    expect(laylaText).not.toContain(admin);

    const aminaRes = await download(await cookieFor(p.amina));
    const amina = aminaRes.body as DataExport;
    expect(amina.audit.map((a) => a.action)).not.toContain("profile.verified");
    expect(amina.audit.map((a) => a.action)).not.toContain("contact.viewed");
    expect(amina.audit.find((a) => a.action === "test.raw")).toMatchObject({
      actor: "system",
      subjectType: "profile",
      detail: { kept: "yes", nested: {} },
    });
    expect(aminaRes.text).not.toContain("+15045550199");
    expect(aminaRes.text).not.toContain(AMINA_SIGNIN_EMAIL);
  });

  it("my_audit_entries_returns_the_callers_rows_only", async () => {
    const amina = await makeStudent(db.pool, { firstName: "Amina" });
    const layla = await makeMentor(db.pool, { firstName: "Layla" });
    await asSystem(db.pool, async (client) => {
      for (const [actor, subject, action] of [
        [amina, amina, "own.by_self"],
        [null, amina, "own.by_system"],
        [layla, amina, "own.by_other"],
        [amina, layla, "other.by_amina"],
        [null, layla, "other.by_system"],
      ] as const) {
        await client.query(
          "INSERT INTO audit_log (actor_id, action, subject_type, subject_id) VALUES ($1, $2, 'profile', $3)",
          [actor, action, subject],
        );
      }
    });

    const mine = await rowsAs<{ action: string; actor: string }>(
      db.pool,
      amina,
      "SELECT action, actor FROM my_audit_entries() ORDER BY action",
    );
    expect(mine).toEqual([
      { action: "own.by_other", actor: "other" },
      { action: "own.by_self", actor: "you" },
      { action: "own.by_system", actor: "system" },
    ]);
    // The function names no actor id, and a visitor gets nothing.
    const columns = await rowsAs<Record<string, unknown>>(db.pool, amina, "SELECT * FROM my_audit_entries() LIMIT 1");
    expect(Object.keys(columns[0]).sort()).toEqual(["action", "actor", "created_at", "detail", "id", "subject_type"]);
    expect(await rowsAs(db.pool, null, "SELECT * FROM my_audit_entries()")).toEqual([]);
    // The table itself stays closed to members.
    expect(await rowsAs(db.pool, amina, "SELECT id FROM audit_log")).toEqual([]);
  });

  it("export_works_during_the_grace_period_and_while_suspended", async () => {
    // Leaving or suspended members can no longer act, but their data is still theirs.
    const { amina, layla } = await arrange();
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility) VALUES ($1, now() + interval '14 days', 'hidden')`,
        [amina],
      ),
    );
    await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [layla]));
    for (const who of [amina, layla]) {
      const res = await download(await cookieFor(who));
      expect(res.status).toBe(200);
      const data = res.body as DataExport;
      expect(data.profile).toMatchObject({ id: who });
      expect(data.requests.length).toBeGreaterThan(0);
    }
  });

  it("export_works_before_onboarding_and_needs_a_session", async () => {
    expect((await download(null)).status).toBe(401);

    const fresh = await makePerson(db.pool, { kind: null, approval: "pending" });
    const res = await download(await cookieFor(fresh));
    expect(res.status).toBe(200);
    const data = res.body as DataExport;
    expect(data.profile).toMatchObject({ id: fresh, kind: null, professional: null, student: null });
    expect(data.requests).toEqual([]);
    expect(data.relationships).toEqual([]);
  });
});
