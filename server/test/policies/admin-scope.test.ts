import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs, scalarAs, sorted } from "./fixtures";
import { makeMentor, makeStudent, sendRequest } from "./request-fixtures";

/**
 * What a chapter administrator reads and changes (Task 39, migration 0023).
 * A chapter (region-scoped) administrator reads and acts only inside its
 * region; a network-wide change (settings, vocabulary, tags) needs an
 * administrator for every region. Each path is checked both ways: the
 * chapter administrator outside its region gets nothing or
 * mest.out_of_region, and an administrator for every region still works.
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
  await db.pool.query("DELETE FROM regions WHERE id <> 'greater-new-orleans'");
  await db.pool.query("UPDATE config SET value = '7' WHERE key = 'pending_cap'");
  // Vocabulary rows are seeded by migrations, so the ones a test adds go here.
  await db.pool.query("DELETE FROM mentorship_topics WHERE id IN ('flood-risk', 'levee-careers')");
  await db.pool.query("DELETE FROM disciplines WHERE id = 'subsea-pipelines'");
});

const BR = "baton-rouge";

/** Two administrators for every region and one chapter administrator for Baton Rouge. */
async function admins() {
  await db.pool.query("INSERT INTO regions (id, label, sort_order) VALUES ($1, 'Greater Baton Rouge', 2)", [BR]);
  const global = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gia" });
  const global2 = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gus" });
  const chapter = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden", firstName: "Cara" });
  return { global, global2, chapter };
}

async function tag(label: string, status: "approved" | "proposed" = "approved"): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO expertise_tags (label, slug, status) VALUES ($1, $2, $3::tag_status) RETURNING id",
    [label, label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), status],
  );
  return rows[0].id;
}

describe("network-wide changes need an administrator for every region", () => {
  it("chapter_admin_cannot_change_settings_vocabulary_or_tags", async () => {
    const { global, chapter } = await admins();
    const keep = await tag("Levee design");
    const dupe = await tag("Levee designs");
    const proposed = await tag("Coastal modeling", "proposed");
    await db.pool.query("INSERT INTO mentorship_topics (id, label, sort_order) VALUES ('levee-careers', 'Levee careers', 99)");

    const calls: [string, unknown[]][] = [
      ["SELECT admin_update_config('pending_cap', '4'::jsonb)", []],
      ["SELECT admin_add_vocabulary('topic', 'flood-risk', 'Flood risk')", []],
      ["SELECT admin_add_vocabulary('discipline', 'subsea-pipelines', 'Subsea pipelines')", []],
      ["SELECT admin_rename_vocabulary('topic', 'levee-careers', 'Careers on the levees')", []],
      ["SELECT admin_rename_vocabulary('tag', $1, 'Levee engineering')", [keep]],
      ["SELECT admin_retire_topic('levee-careers')", []],
      ["SELECT admin_merge_tags($1::uuid, $2::uuid)", [dupe, keep]],
      ["SELECT admin_review_tag($1, 'approved')", [proposed]],
    ];
    for (const [sql, params] of calls) {
      await expect(runAs(db.pool, chapter, sql, params), sql).rejects.toThrow(/mest\.out_of_region/);
    }

    // Nothing changed.
    expect((await db.pool.query("SELECT value FROM config WHERE key = 'pending_cap'")).rows[0].value).toBe(7);
    expect((await db.pool.query("SELECT 1 FROM mentorship_topics WHERE id = 'flood-risk'")).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM disciplines WHERE id = 'subsea-pipelines'")).rowCount).toBe(0);
    const topic = await db.pool.query<{ label: string; active: boolean }>(
      "SELECT label, active FROM mentorship_topics WHERE id = 'levee-careers'",
    );
    expect(topic.rows[0]).toEqual({ label: "Levee careers", active: true });
    const tags = await db.pool.query<{ id: string; label: string; status: string; merged_into: string | null }>(
      "SELECT id, label, status::text AS status, merged_into FROM expertise_tags ORDER BY label",
    );
    expect(tags.rows.map((t) => [t.label, t.status, t.merged_into])).toEqual([
      ["Coastal modeling", "proposed", null],
      ["Levee design", "approved", null],
      ["Levee designs", "approved", null],
    ]);
    expect((await db.pool.query("SELECT 1 FROM audit_log WHERE actor_id = $1", [chapter])).rowCount).toBe(0);

    // An administrator for every region makes each change.
    for (const [sql, params] of calls) {
      await runAs(db.pool, global, sql, params);
    }
    expect((await db.pool.query("SELECT value FROM config WHERE key = 'pending_cap'")).rows[0].value).toBe(4);
    expect((await db.pool.query("SELECT active FROM mentorship_topics WHERE id = 'levee-careers'")).rows[0].active).toBe(
      false,
    );
    expect((await db.pool.query("SELECT merged_into FROM expertise_tags WHERE id = $1", [dupe])).rows[0].merged_into).toBe(keep);
    expect((await db.pool.query("SELECT status::text AS s FROM expertise_tags WHERE id = $1", [proposed])).rows[0].s).toBe(
      "approved",
    );
  });
});

describe("chapter administrators read only their region", () => {
  it("profiles_student_details_and_reviews_stop_at_the_region", async () => {
    const { global, chapter } = await admins();
    // Hidden profiles, so only an administrator policy can show them.
    const nolaStudent = await makeStudent(db.pool, { firstName: "Nina" });
    const brStudent = await makeStudent(db.pool, { firstName: "Bea", region: BR });
    const nolaPending = await newAccount(db.pool);
    await onboard(db.pool, nolaPending, professionalPayload({ visibility: "hidden" }));
    const brPending = await newAccount(db.pool);
    await onboard(db.pool, brPending, professionalPayload({ region: BR, visibility: "hidden" }));

    const ids = async (who: string, sql: string) => sorted((await rowsAs<{ id: string }>(db.pool, who, sql)).map((r) => r.id));
    const people = [nolaStudent, brStudent, nolaPending, brPending];
    const profiles = (who: string) => ids(who, `SELECT id FROM profiles WHERE id IN ('${people.join("','")}')`);
    const students = (who: string) => ids(who, "SELECT profile_id AS id FROM student_details");
    const reviews = (who: string) => ids(who, "SELECT profile_id AS id FROM profile_reviews");
    // The detail tables follow the profile's policies, so they stop at the region too.
    const work = (who: string) => ids(who, `SELECT profile_id AS id FROM professional_details WHERE profile_id IN ('${people.join("','")}')`);
    const schooling = (who: string) => ids(who, "SELECT DISTINCT profile_id AS id FROM education");

    expect(await profiles(chapter)).toEqual(sorted([brStudent, brPending]));
    expect(await students(chapter)).toEqual([brStudent]);
    expect(await reviews(chapter)).toEqual([brPending]);
    expect(await work(chapter)).toEqual([brPending]);
    expect(await schooling(chapter)).toEqual([brPending]);

    expect(await profiles(global)).toEqual(sorted(people));
    expect(await students(global)).toEqual(sorted([nolaStudent, brStudent]));
    expect(await reviews(global)).toEqual(sorted([nolaPending, brPending]));
    expect(await work(global)).toEqual(sorted([nolaPending, brPending]));
    expect(await schooling(global)).toEqual(sorted([nolaPending, brPending]));
  });

  it("admin_reports_lists_only_reports_on_the_region", async () => {
    const { global, chapter } = await admins();
    const nolaPro = await makePerson(db.pool, { firstName: "Nolan" });
    const brPro = await makePerson(db.pool, { firstName: "Brett", region: BR });
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const onNola = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'spam', 'Selling courses.') AS value", [
      nolaPro,
    ]);
    const onBr = await scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'spam', 'Selling courses.') AS value", [
      brPro,
    ]);

    const seen = async (who: string) =>
      sorted((await rowsAs<{ id: string }>(db.pool, who, "SELECT id FROM admin_reports")).map((r) => r.id));
    expect(await seen(chapter)).toEqual([onBr]);
    expect(await seen(global)).toEqual(sorted([onNola, onBr]));
  });

  it("admin_requests_needs_a_party_in_the_region_and_text_needs_the_reported_one", async () => {
    const { global, chapter } = await admins();
    const nolaMentor = await makeMentor(db.pool, { firstName: "Noel" });
    const nolaStudent = await makeStudent(db.pool, { firstName: "Nina" });
    const brStudent = await makeStudent(db.pool, { firstName: "Bea", region: BR });
    const inNola = await sendRequest(db.pool, nolaStudent, nolaMentor);
    const across = await sendRequest(db.pool, brStudent, nolaMentor);

    type Row = { id: string; under_report: boolean; why: string | null };
    const view = async (who: string) =>
      Object.fromEntries(
        (await rowsAs<Row>(db.pool, who, "SELECT id, under_report, why FROM admin_requests")).map((r) => [r.id, r]),
      );

    // Only requests with a party in the region.
    expect(Object.keys(await view(chapter))).toEqual([across]);
    expect(Object.keys(await view(global)).sort()).toEqual(sorted([inNola, across]));

    // A member's report on the New Orleans mentor opens the text for an
    // administrator who covers New Orleans, not for the chapter one.
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await scalarAs(db.pool, reporter, "SELECT report_profile($1, 'unsafe', null) AS value", [nolaMentor]);
    expect((await view(chapter))[across]).toMatchObject({ under_report: false, why: null });
    expect((await view(global))[across]).toMatchObject({ under_report: true });
    expect((await view(global))[across].why).not.toBeNull();

    // A report on the Baton Rouge student opens it for the chapter administrator.
    await scalarAs(db.pool, nolaMentor, "SELECT report_profile($1, 'unsafe', null) AS value", [brStudent]);
    expect((await view(chapter))[across]).toMatchObject({ under_report: true });
    expect((await view(chapter))[across].why).not.toBeNull();
  });

  it("relationships_need_a_party_in_the_region", async () => {
    const { global, chapter } = await admins();
    const nolaMentor = await makeMentor(db.pool);
    const nolaStudent = await makeStudent(db.pool);
    const brStudent = await makeStudent(db.pool, { region: BR });
    const inNola = await sendRequest(db.pool, nolaStudent, nolaMentor);
    const across = await sendRequest(db.pool, brStudent, nolaMentor);
    for (const id of [inNola, across]) {
      await runAs(db.pool, nolaMentor, "SELECT respond_to_request($1, 'accept', NULL, NULL, '{email}'::contact_method[])", [id]);
    }
    const seen = async (who: string) =>
      sorted((await rowsAs<{ id: string }>(db.pool, who, "SELECT request_id AS id FROM mentorship_relationships")).map((r) => r.id));
    expect(await seen(chapter)).toEqual([across]);
    expect(await seen(global)).toEqual(sorted([inNola, across]));
  });
});

describe("administrator notifications follow the region", () => {
  const recipients = async (template: string) =>
    sorted(
      (await db.pool.query<{ recipient_id: string }>("SELECT recipient_id FROM notifications WHERE template = $1", [template])).rows.map(
        (r) => r.recipient_id,
      ),
    );

  it("a_submission_outside_the_region_reaches_only_every_region_administrators", async () => {
    const { global, global2 } = await admins();
    const pro = await newAccount(db.pool);
    await onboard(db.pool, pro, professionalPayload());
    expect(await recipients("profile-submitted")).toEqual(sorted([global, global2]));
  });

  it("a_submission_inside_the_region_reaches_its_chapter_administrator", async () => {
    const { global, global2, chapter } = await admins();
    const pro = await newAccount(db.pool);
    await onboard(db.pool, pro, professionalPayload({ region: BR }));
    expect(await recipients("profile-submitted")).toEqual(sorted([global, global2, chapter]));
  });

  it("a_report_reaches_only_administrators_who_cover_the_reported_profile", async () => {
    const { global, global2, chapter } = await admins();
    const nolaPro = await makePerson(db.pool);
    const brPro = await makePerson(db.pool, { region: BR });
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await scalarAs(db.pool, reporter, "SELECT report_profile($1, 'spam', null) AS value", [nolaPro]);
    expect(await recipients("report-received")).toEqual(sorted([global, global2]));

    await db.pool.query("DELETE FROM notifications");
    await scalarAs(db.pool, reporter, "SELECT report_profile($1, 'spam', null) AS value", [brPro]);
    expect(await recipients("report-received")).toEqual(sorted([global, global2, chapter]));
  });
});

describe("the administrators list", () => {
  it("names_every_administrator_to_a_chapter_administrator", async () => {
    // The roster is not member data: a chapter administrator needs to know
    // who acts for every region, whose profiles it can no longer read.
    const { global, global2, chapter } = await admins();
    const rows = await rowsAs<{ profile_id: string; first_name: string; region_id: string | null }>(
      db.pool,
      chapter,
      "SELECT profile_id, first_name, region_id FROM admin_roster ORDER BY first_name",
    );
    expect(rows).toEqual([
      { profile_id: chapter, first_name: "Cara", region_id: BR },
      { profile_id: global, first_name: "Gia", region_id: null },
      { profile_id: global2, first_name: "Gus", region_id: null },
    ]);
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    expect(await rowsAs(db.pool, member, "SELECT * FROM admin_roster")).toEqual([]);
  });
});
