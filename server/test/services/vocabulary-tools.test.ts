import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disciplines as seededDisciplines, mentorshipTopics } from "@shared/taxonomy";
import type { AdminTag, AdminVocabularyLists } from "@shared/types/admin";
import type { Paged } from "@shared/types/common";
import type { PublicVocabulary } from "@shared/types/vocabulary";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminRoutes } from "../../src/routes/admin";
import { configRoutes } from "../../src/routes/config";
import { meRoutes } from "../../src/routes/me";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs, studentPayload } from "../policies/fixtures";
import { makeMentor, makeStudent } from "../policies/request-fixtures";

/**
 * Vocabulary tooling (Task 34, migration 0017): merging expertise tags,
 * renaming a discipline, topic or tag, and retiring a mentorship topic so it
 * is no longer offered while the choices members already made stay.
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
  // The vocabularies are seeded by the migrations and survive truncation, so
  // undo what a previous test renamed, retired or added.
  await db.pool.query("DELETE FROM mentorship_topics WHERE NOT (id = ANY ($1::text[]))", [mentorshipTopics.map((t) => t.id)]);
  for (const t of mentorshipTopics) {
    await db.pool.query("UPDATE mentorship_topics SET label = $2, active = true WHERE id = $1", [t.id, t.label]);
  }
  for (const d of seededDisciplines) {
    await db.pool.query("UPDATE disciplines SET label = $2, active = true WHERE id = $1", [d.id, d.label]);
  }
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(new Hono().route("/admin", adminRoutes).route("/config", configRoutes).route("/me", meRoutes));

async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(`/api${path}`, {
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

async function admins(): Promise<{ admin: string; cookie: string }> {
  const admin = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Ada", lastName: "Admin" });
  await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Bea", lastName: "Admin" });
  return { admin, cookie: await cookieFor(admin) };
}

/** A professional who onboarded with these expertise labels (unknown labels become proposed tags). */
async function professional(expertise: string[], firstName = "Noor"): Promise<string> {
  const id = await newAccount(db.pool);
  await onboard(db.pool, id, professionalPayload({ expertise, firstName }));
  return id;
}

async function tagId(label: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>("SELECT id FROM expertise_tags WHERE lower(label) = lower($1)", [label]);
  expect(rows, `tag ${label}`).toHaveLength(1);
  return rows[0].id;
}

async function approve(cookie: string, label: string): Promise<string> {
  const id = await tagId(label);
  expect((await call(cookie, "POST", `/admin/tags/${id}`, { decision: "approved" })).status).toBe(200);
  return id;
}

async function labelsOf(profileId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ label: string }>(
    `SELECT t.label FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
      WHERE pe.profile_id = $1 ORDER BY t.label`,
    [profileId],
  );
  return rows.map((r) => r.label);
}

async function audits(action: string): Promise<{ actor_id: string; subject_id: string | null; detail: Record<string, unknown> }[]> {
  const { rows } = await db.pool.query(
    "SELECT actor_id, subject_id, detail FROM audit_log WHERE action = $1 ORDER BY id",
    [action],
  );
  return rows;
}

describe("merging expertise tags", () => {
  it("merge_moves_links_removes_duplicates_and_retires_the_old_tag", async () => {
    const { admin, cookie } = await admins();
    const a = await professional(["Hydraulic modeling", "Levee design"], "Ana");
    const b = await professional(["Hydraulic modelling", "Levee design"], "Ben");
    const c = await professional(["Hydraulic modeling", "Hydraulic modelling", "Surveying"], "Cal");
    const into = await approve(cookie, "Hydraulic modeling");
    await approve(cookie, "Levee design");
    const from = await tagId("Hydraulic modelling");

    const merged = await json<{ moved: number }>(await call(cookie, "POST", `/admin/tags/${from}/merge`, { intoTagId: into }));
    expect(merged).toEqual({ moved: 2 });

    expect(await labelsOf(a)).toEqual(["Hydraulic modeling", "Levee design"]);
    expect(await labelsOf(b)).toEqual(["Hydraulic modeling", "Levee design"]);
    expect(await labelsOf(c)).toEqual(["Hydraulic modeling", "Surveying"]);
    const { rows } = await db.pool.query("SELECT status::text AS status, merged_into FROM expertise_tags WHERE id = $1", [from]);
    expect(rows[0]).toEqual({ status: "rejected", merged_into: into });
    expect(await audits("tag.merged")).toEqual([
      {
        actor_id: admin,
        subject_id: from,
        detail: { label: "Hydraulic modelling", intoId: into, intoLabel: "Hydraulic modeling", moved: 2 },
      },
    ]);

    // Ben's search document now carries the approved tag he was moved to.
    const found = await db.pool.query<{ profile_id: string }>(
      "SELECT profile_id FROM professional_details WHERE search_tsv @@ plainto_tsquery('english', 'hydraulic') ORDER BY profile_id",
    );
    expect(found.rows.map((r) => r.profile_id)).toEqual([a, b, c].sort());

    // The admin list shows where the retired tag went.
    const rejected = await json<Paged<AdminTag>>(await call(cookie, "GET", "/admin/tags?status=rejected"));
    expect(rejected.items).toEqual([
      expect.objectContaining({ id: from, label: "Hydraulic modelling", usage: 0, mergedIntoLabel: "Hydraulic modeling" }),
    ]);
    const approved = await json<Paged<AdminTag>>(await call(cookie, "GET", "/admin/tags?status=approved"));
    expect(approved.items.find((t) => t.id === into)).toMatchObject({ usage: 3, mergedIntoLabel: null });

    // The merge picker searches approved tags by label; LIKE wildcards are literal.
    const search = await json<Paged<AdminTag>>(await call(cookie, "GET", "/admin/tags?status=approved&q=HYDRAULIC"));
    expect(search).toEqual({ total: 1, items: [expect.objectContaining({ id: into })] });
    const wildcard = await json<Paged<AdminTag>>(await call(cookie, "GET", "/admin/tags?status=approved&q=%25"));
    expect(wildcard).toEqual({ total: 0, items: [] });
  });

  it("typing_a_merged_label_links_the_tag_it_was_merged_into", async () => {
    const { cookie } = await admins();
    await professional(["Hydraulic modeling", "Levee design"], "Ana");
    const b = await professional(["Hydraulic modelling", "Levee design"], "Ben");
    const into = await approve(cookie, "Hydraulic modeling");
    const from = await tagId("Hydraulic modelling");
    await json(await call(cookie, "POST", `/admin/tags/${from}/merge`, { intoTagId: into }));

    const bCookie = await cookieFor(b);
    const res = await call(bCookie, "PATCH", "/me/profile", { expertise: ["hydraulic MODELLING", "Coastal surveys"] });
    expect(res.status, await res.text()).toBe(200);
    expect(await labelsOf(b)).toEqual(["Coastal surveys", "Hydraulic modeling"]);

    // Two labels that now name one tag count once against the two-tag minimum.
    const twice = await call(bCookie, "PATCH", "/me/profile", { expertise: ["Hydraulic modelling", "Hydraulic modeling"] });
    expect(await json(twice, 409)).toEqual({ code: "invalid_expertise" });
    expect(await labelsOf(b)).toEqual(["Coastal surveys", "Hydraulic modeling"]);
  });

  it("merging_into_a_tag_that_is_merged_later_repoints_the_first_tag", async () => {
    const { cookie } = await admins();
    await professional(["Levee design", "Levee designs", "Levees"]);
    const levee = await approve(cookie, "Levee design");
    const levees = await approve(cookie, "Levees");
    const designs = await tagId("Levee designs");

    await json(await call(cookie, "POST", `/admin/tags/${designs}/merge`, { intoTagId: levees }));
    await json(await call(cookie, "POST", `/admin/tags/${levees}/merge`, { intoTagId: levee }));

    const { rows } = await db.pool.query<{ id: string; merged_into: string }>(
      "SELECT id, merged_into FROM expertise_tags WHERE id = ANY ($1::uuid[]) ORDER BY label",
      [[designs, levees]],
    );
    expect(rows).toEqual([
      { id: designs, merged_into: levee },
      { id: levees, merged_into: levee },
    ]);
  });

  it("merge_refuses_bad_targets_and_non_admins", async () => {
    const { cookie } = await admins();
    const owner = await professional(["Hydraulic modeling", "Hydraulic modelling", "Pumps"]);
    const approved = await approve(cookie, "Hydraulic modeling");
    const proposed = await tagId("Hydraulic modelling");
    const pumps = await tagId("Pumps");

    const refuse = async (from: string, into: string, code: string, status = 409) =>
      expect(await json(await call(cookie, "POST", `/admin/tags/${from}/merge`, { intoTagId: into }), status)).toMatchObject({
        code,
      });
    // The target must be an approved tag, and a different one.
    await refuse(approved, proposed, "invalid_merge");
    await refuse(approved, approved, "invalid_merge");
    await refuse(approved, "00000000-0000-4000-8000-000000000000", "not_found");
    expect((await call(cookie, "POST", `/admin/tags/${proposed}/merge`, { intoTagId: "nope" })).status).toBe(400);

    // A merged tag cannot be merged again or become a target.
    await json(await call(cookie, "POST", `/admin/tags/${proposed}/merge`, { intoTagId: approved }));
    await refuse(proposed, approved, "invalid_merge");
    await refuse(pumps, proposed, "invalid_merge");
    // Nor approved back beside its replacement, or renamed.
    expect(await json(await call(cookie, "POST", `/admin/tags/${proposed}`, { decision: "approved" }), 409)).toEqual({
      code: "tag_merged",
    });
    expect(await json(await call(cookie, "PATCH", `/admin/vocabulary/tag/${proposed}`, { label: "Hydraulics" }), 409)).toEqual({
      code: "tag_merged",
    });

    // A member can neither reach the route nor call the function.
    const memberCookie = await cookieFor(owner);
    expect(await json(await call(memberCookie, "POST", `/admin/tags/${pumps}/merge`, { intoTagId: approved }), 403)).toEqual({
      code: "not_admin",
    });
    await expect(runAs(db.pool, owner, "SELECT admin_merge_tags($1, $2)", [pumps, approved])).rejects.toThrow(/mest\.forbidden/);
    expect(await labelsOf(owner)).toEqual(["Hydraulic modeling", "Pumps"]);
  });
});

describe("renaming vocabulary", () => {
  it("rename_changes_labels_everywhere_and_is_audited", async () => {
    const { admin, cookie } = await admins();
    const owner = await professional(["Hydraulic modeling", "Levee design"]);
    const tag = await approve(cookie, "Hydraulic modeling");

    const rename = (kind: string, id: string, label: string) =>
      call(cookie, "PATCH", `/admin/vocabulary/${kind}/${id}`, { label });
    expect((await rename("topic", "professional-licensure", "Licensure (PE, FE, PG)")).status).toBe(200);
    expect((await rename("discipline", "coastal", "Coastal engineering")).status).toBe(200);
    expect((await rename("tag", tag, "Hydraulic modelling (1D and 2D)")).status).toBe(200);

    const pub = await json<PublicVocabulary>(await call(null, "GET", "/config/vocabulary"));
    expect(pub.topics.find((t) => t.id === "professional-licensure")?.label).toBe("Licensure (PE, FE, PG)");
    const lists = await json<AdminVocabularyLists>(await call(cookie, "GET", "/admin/vocabulary"));
    expect(lists.disciplines.find((d) => d.id === "coastal")?.label).toBe("Coastal engineering");
    expect(await labelsOf(owner)).toEqual(["Hydraulic modelling (1D and 2D)", "Levee design"]);
    // The slug a tag is filtered by does not change with its label.
    const { rows } = await db.pool.query("SELECT slug FROM expertise_tags WHERE id = $1", [tag]);
    expect(rows[0].slug).toBe("hydraulic-modeling");

    expect((await audits("vocabulary.renamed")).map((a) => [a.actor_id, a.detail])).toEqual([
      [admin, { kind: "topic", id: "professional-licensure", from: "Professional licensure (PE, FE)", to: "Licensure (PE, FE, PG)" }],
      [admin, { kind: "discipline", id: "coastal", from: "Coastal & environmental", to: "Coastal engineering" }],
      [admin, { kind: "tag", id: tag, from: "Hydraulic modeling", to: "Hydraulic modelling (1D and 2D)" }],
    ]);
  });

  it("rename_refuses_duplicates_bad_labels_and_non_admins", async () => {
    const { cookie } = await admins();
    const owner = await professional(["Hydraulic modeling", "Levee design"]);
    const tag = await approve(cookie, "Hydraulic modeling");
    await approve(cookie, "Levee design");
    const rename = (kind: string, id: string, label: string) =>
      call(cookie, "PATCH", `/admin/vocabulary/${kind}/${id}`, { label });

    // Two tags cannot share a label (case-insensitively): merge them instead.
    expect(await json(await rename("tag", tag, "levee DESIGN"), 409)).toEqual({ code: "duplicate" });
    // A change of case on the same tag is fine.
    expect((await rename("tag", tag, "Hydraulic Modeling")).status).toBe(200);
    // Tag labels follow the expertise limit (40), topic labels the vocabulary limit (80).
    expect(await json(await rename("tag", tag, "x".repeat(41)), 409)).toEqual({ code: "invalid_vocabulary" });
    expect((await rename("topic", "graduate-school", "x".repeat(81))).status).toBe(400);
    expect((await rename("topic", "graduate-school", "x")).status).toBe(400);
    expect(await json(await rename("topic", "no-such-topic", "Anything"), 409)).toEqual({ code: "not_found" });
    expect(await json(await rename("tag", "00000000-0000-4000-8000-000000000000", "Anything"), 409)).toEqual({ code: "not_found" });
    expect((await rename("tag", "not-a-uuid", "Anything")).status).toBe(400);
    expect((await rename("region", "graduate-school", "Anything")).status).toBe(400);

    const memberCookie = await cookieFor(owner);
    expect((await call(memberCookie, "PATCH", "/admin/vocabulary/topic/graduate-school", { label: "Mine" })).status).toBe(403);
    await expect(
      runAs(db.pool, owner, "SELECT admin_rename_vocabulary('topic', 'graduate-school', 'Mine')"),
    ).rejects.toThrow(/mest\.forbidden/);
    const { rows } = await db.pool.query("SELECT label FROM mentorship_topics WHERE id = 'graduate-school'");
    expect(rows[0].label).toBe("Graduate school applications");
  });
});

describe("retiring a mentorship topic", () => {
  it("retire_stops_offering_the_topic_and_keeps_existing_choices", async () => {
    const { admin, cookie } = await admins();
    const mentor = await makeMentor(db.pool, { topics: ["professional-licensure", "internships-and-first-jobs"] });
    const student = await makeStudent(db.pool, { topicsNeeded: ["internships-and-first-jobs", "graduate-school"] });

    expect(await json(await call(cookie, "POST", "/admin/topics/internships-and-first-jobs/retire"))).toEqual({ ok: true });
    expect(await audits("vocabulary.retired")).toEqual([
      { actor_id: admin, subject_id: null, detail: { kind: "topic", id: "internships-and-first-jobs", label: "Internships and first jobs" } },
    ]);
    // A second retire changes nothing and is not audited again.
    expect(await json(await call(cookie, "POST", "/admin/topics/internships-and-first-jobs/retire"))).toEqual({ ok: true });
    expect(await audits("vocabulary.retired")).toHaveLength(1);

    // Members are no longer offered it, but its label still resolves.
    const pub = await json<PublicVocabulary>(await call(null, "GET", "/config/vocabulary"));
    expect(pub.topics.map((t) => t.id)).not.toContain("internships-and-first-jobs");
    expect(pub.topics).toHaveLength(mentorshipTopics.length - 1);
    expect(pub.retiredTopics).toEqual([{ id: "internships-and-first-jobs", label: "Internships and first jobs" }]);
    const lists = await json<AdminVocabularyLists>(await call(cookie, "GET", "/admin/vocabulary"));
    expect(lists.topics.find((t) => t.id === "internships-and-first-jobs")).toMatchObject({ active: false });

    // The choices already made stay on the profiles.
    const mentorTopics = await rowsAs<{ mentor_topics: string[] }>(
      db.pool,
      null,
      "SELECT mentor_topics FROM directory_entries WHERE id = $1",
      [mentor],
    );
    expect(mentorTopics[0].mentor_topics.sort()).toEqual(["internships-and-first-jobs", "professional-licensure"]);
    const needed = await db.pool.query("SELECT topics_needed FROM student_details WHERE profile_id = $1", [student]);
    expect(needed.rows[0].topics_needed).toEqual(["internships-and-first-jobs", "graduate-school"]);

    // A mentor saving settings may keep the retired topic, and drop it.
    const mentorCookie = await cookieFor(mentor);
    const keep = await call(mentorCookie, "PATCH", "/me/settings", {
      mentorship: { topics: ["internships-and-first-jobs", "professional-licensure", "graduate-school"] },
    });
    expect(keep.status, await keep.text()).toBe(200);
    expect((await mentorTopicIds(mentor)).sort()).toEqual(["graduate-school", "internships-and-first-jobs", "professional-licensure"]);

    // A student may keep it in what they ask about too.
    const studentCookie = await cookieFor(student);
    const keepNeeded = await call(studentCookie, "PATCH", "/me/profile", {
      topicsNeeded: ["internships-and-first-jobs", "technical-interviews"],
    });
    expect(keepNeeded.status, await keepNeeded.text()).toBe(200);

    // Nobody can choose it afresh once it is retired.
    await json(await call(cookie, "POST", "/admin/topics/graduate-school/retire"));
    const other = await makeMentor(db.pool, { topics: ["professional-licensure"] });
    expect(
      await json(await call(await cookieFor(other), "PATCH", "/me/settings", { mentorship: { topics: ["internships-and-first-jobs"] } }), 409),
    ).toEqual({ code: "invalid_topic" });
    expect(await mentorTopicIds(other)).toEqual(["professional-licensure"]);
    const otherStudent = await makeStudent(db.pool, { topicsNeeded: ["technical-interviews"] });
    const addNeeded = await call(await cookieFor(otherStudent), "PATCH", "/me/profile", { topicsNeeded: ["graduate-school"] });
    expect(addNeeded.status).toBe(409);
    const fresh = await newAccount(db.pool);
    await expect(
      onboard(db.pool, fresh, studentPayload({ topicsNeeded: ["internships-and-first-jobs"] })),
    ).rejects.toThrow(/mest\.invalid_onboarding/);
    const freshPro = await newAccount(db.pool);
    await expect(
      onboard(
        db.pool,
        freshPro,
        professionalPayload({ mentorship: { ...(professionalPayload().mentorship as object), topics: ["internships-and-first-jobs"] } }),
      ),
    ).rejects.toThrow(/mest\.invalid_onboarding/);

    // And the mentor who kept both can still drop one.
    const drop = await call(mentorCookie, "PATCH", "/me/settings", { mentorship: { topics: ["professional-licensure", "graduate-school"] } });
    expect(drop.status, await drop.text()).toBe(200);
    expect((await mentorTopicIds(mentor)).sort()).toEqual(["graduate-school", "professional-licensure"]);
  });

  it("retire_refuses_unknown_topics_and_non_admins", async () => {
    const { cookie } = await admins();
    const member = await makePerson(db.pool);
    expect(await json(await call(cookie, "POST", "/admin/topics/no-such-topic/retire"), 409)).toEqual({ code: "not_found" });
    expect((await call(cookie, "POST", "/admin/topics/Not_A_Slug/retire")).status).toBe(400);
    expect((await call(await cookieFor(member), "POST", "/admin/topics/graduate-school/retire")).status).toBe(403);
    await expect(runAs(db.pool, member, "SELECT admin_retire_topic('graduate-school')")).rejects.toThrow(/mest\.forbidden/);
    const { rows } = await db.pool.query("SELECT active FROM mentorship_topics WHERE id = 'graduate-school'");
    expect(rows[0].active).toBe(true);
  });
});

async function mentorTopicIds(profileId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ topic_id: string }>(
    "SELECT topic_id FROM mentor_topics WHERE profile_id = $1 ORDER BY topic_id",
    [profileId],
  );
  return rows.map((r) => r.topic_id);
}
