import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disciplines, mentorshipTopics } from "@shared/taxonomy";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import {
  makePerson,
  newAccount,
  onboard,
  professionalPayload,
  rowsAs,
  runAs,
  scalarAs,
  sorted,
  studentPayload,
  visibleProfileIds,
} from "./fixtures";

/**
 * Profile detail tables (02 sections 4.3, 5.3 and 5.4): professional and
 * student details, education, expertise, the vocabularies, the directory
 * view, and complete_onboarding.
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
});

const ids = (rows: { id?: unknown; profile_id?: unknown }[]) =>
  sorted(rows.map((row) => String(row.profile_id ?? row.id)));

/** Who can read which professional_details, student_details, education and expertise rows. */
async function population() {
  const pool = db.pool;
  const publicPro = await makePerson(pool);
  const membersPro = await makePerson(pool, { visibility: "members" });
  const hiddenPro = await makePerson(pool, { visibility: "hidden" });
  const pendingPro = await makePerson(pool, { approval: "pending" });
  const student = await makePerson(pool, { kind: "student", visibility: "hidden" });
  const admin = await makePerson(pool, { admin: true, visibility: "hidden" });
  await asSystem(pool, async (client) => {
    for (const id of [publicPro, membersPro, hiddenPro, pendingPro]) {
      await client.query(
        "INSERT INTO education (profile_id, degree, field, school, year) VALUES ($1, 'BS', 'Civil Engineering', 'A university', 2010)",
        [id],
      );
    }
    await client.query(
      `INSERT INTO student_details (profile_id, program, level, institution, goals, topics_needed)
       VALUES ($1, 'BS Civil Engineering', 'undergrad', 'A university', 'Find a first internship in water resources.', '{internships-and-first-jobs}')`,
      [student],
    );
  });
  return { publicPro, membersPro, hiddenPro, pendingPro, student, admin };
}

describe("detail tables follow the parent profile", () => {
  it("professional_details_visitor_member_owner_admin", async () => {
    const p = await population();
    const sql = "SELECT profile_id FROM professional_details";
    expect(ids(await rowsAs(db.pool, null, sql))).toEqual([p.publicPro]);
    expect(ids(await rowsAs(db.pool, p.student, sql))).toEqual(sorted([p.publicPro, p.membersPro]));
    expect(ids(await rowsAs(db.pool, p.pendingPro, sql))).toEqual(sorted([p.publicPro, p.membersPro, p.pendingPro]));
    expect(ids(await rowsAs(db.pool, p.hiddenPro, sql))).toEqual(sorted([p.publicPro, p.membersPro, p.hiddenPro]));
    // Administrators read every row (their own included: they are professionals here).
    expect(ids(await rowsAs(db.pool, p.admin, sql))).toEqual(
      sorted([p.publicPro, p.membersPro, p.hiddenPro, p.pendingPro, p.admin]),
    );
  });

  it("education_and_expertise_follow_the_profile", async () => {
    const p = await population();
    await asSystem(db.pool, async (client) => {
      const tag = await client.query<{ id: string }>(
        "INSERT INTO expertise_tags (label, slug, status) VALUES ('Levee design', 'levee-design', 'approved') RETURNING id",
      );
      for (const id of [p.publicPro, p.membersPro, p.hiddenPro]) {
        await client.query("INSERT INTO profile_expertise (profile_id, tag_id) VALUES ($1, $2)", [id, tag.rows[0].id]);
      }
    });
    for (const table of ["education", "profile_expertise"]) {
      const sql = `SELECT DISTINCT profile_id FROM ${table}`;
      expect(ids(await rowsAs(db.pool, null, sql))).toEqual([p.publicPro]);
      expect(ids(await rowsAs(db.pool, p.student, sql))).toEqual(sorted([p.publicPro, p.membersPro]));
      expect(ids(await rowsAs(db.pool, p.hiddenPro, sql))).toContain(p.hiddenPro);
      expect((await rowsAs(db.pool, p.admin, sql)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("student_details_owner_and_admin_only", async () => {
    const p = await population();
    const sql = "SELECT profile_id FROM student_details";
    expect(await rowsAs(db.pool, null, sql)).toEqual([]);
    expect(await rowsAs(db.pool, p.publicPro, sql)).toEqual([]);
    expect(ids(await rowsAs(db.pool, p.student, sql))).toEqual([p.student]);
    expect(ids(await rowsAs(db.pool, p.admin, sql))).toEqual([p.student]);
  });

  it("professional_without_directory_participation_is_unlisted", async () => {
    const listed = await makePerson(db.pool);
    const networkingOnly = await makePerson(db.pool, { participation: ["networking", "mentoring"] });
    const noDetails = await makePerson(db.pool, { participation: false });
    const membersOnly = await makePerson(db.pool, { visibility: "members", participation: ["speaking"] });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    expect(await visibleProfileIds(db.pool, null)).toEqual([listed]);
    expect(await visibleProfileIds(db.pool, member)).toEqual(sorted([listed, member]));
    expect(await scalarAs(db.pool, null, "SELECT profile_access($1) AS value", [networkingOnly])).toBe("none");
    expect(await scalarAs(db.pool, member, "SELECT profile_access($1) AS value", [membersOnly])).toBe("none");
    expect(await scalarAs(db.pool, null, "SELECT profile_access($1) AS value", [noDetails])).toBe("none");
    // The owner still reads their own profile.
    expect(await visibleProfileIds(db.pool, networkingOnly)).toContain(networkingOnly);
    const view = await rowsAs<{ id: string }>(db.pool, member, "SELECT id FROM directory_entries");
    expect(view.map((row) => row.id)).toEqual([listed]);
  });

  it("owner_writes_own_details_but_not_verification", async () => {
    const owner = await makePerson(db.pool);
    const other = await makePerson(db.pool);
    await runAs(db.pool, owner, "UPDATE professional_details SET title = 'Lead Engineer' WHERE profile_id = app_uid()");
    await runAs(db.pool, owner, "UPDATE professional_details SET title = 'Stolen' WHERE profile_id = $1", [other]);
    const titles = await db.pool.query<{ profile_id: string; title: string }>(
      "SELECT profile_id, title FROM professional_details",
    );
    expect(Object.fromEntries(titles.rows.map((r) => [r.profile_id, r.title]))).toEqual({
      [owner]: "Lead Engineer",
      [other]: "Engineer",
    });
    await expect(
      runAs(db.pool, owner, "UPDATE professional_details SET verified = true WHERE profile_id = app_uid()"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(db.pool, owner, "UPDATE professional_details SET search_tsv = to_tsvector('x') WHERE profile_id = app_uid()"),
    ).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, owner, "DELETE FROM professional_details WHERE profile_id = app_uid()")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("professional_bio_required", async () => {
    // No bio, no details row.
    const noBio = await makePerson(db.pool, { bio: null, participation: false });
    await expect(
      asSystem(db.pool, (client) =>
        client.query(
          `INSERT INTO professional_details (profile_id, title, organization, discipline_id, years_experience)
           VALUES ($1, 'Engineer', 'Org', 'civil', 3)`,
          [noBio],
        ),
      ),
    ).rejects.toThrow(/mest\.bio_required/);
    // And a professional with details cannot clear it.
    const owner = await makePerson(db.pool);
    await expect(runAs(db.pool, owner, "UPDATE profiles SET bio = NULL WHERE id = app_uid()")).rejects.toThrow(
      /mest\.bio_required/,
    );
    // Onboarding refuses a professional without one.
    const account = await newAccount(db.pool);
    await expect(onboard(db.pool, account, professionalPayload({ bio: undefined }))).rejects.toThrow(/mest\.bio_required/);
  });
});

describe("vocabularies and expertise tags", () => {
  it("vocabularies_match_shared_taxonomy_and_are_read_only", async () => {
    const d = await rowsAs<{ id: string; label: string; group_name: string }>(
      db.pool,
      null,
      "SELECT id, label, group_name FROM disciplines ORDER BY sort_order",
    );
    expect(d).toEqual(disciplines.map((x) => ({ id: x.id, label: x.label, group_name: x.group })));
    const t = await rowsAs<{ id: string; label: string }>(
      db.pool,
      null,
      "SELECT id, label FROM mentorship_topics ORDER BY sort_order",
    );
    expect(t).toEqual(mentorshipTopics.map((x) => ({ id: x.id, label: x.label })));

    const admin = await makePerson(db.pool, { admin: true });
    for (const sql of [
      "INSERT INTO disciplines (id, label, group_name, sort_order) VALUES ('x', 'X', 'Science', 99)",
      "UPDATE mentorship_topics SET label = 'Changed'",
      "DELETE FROM disciplines",
    ]) {
      await expect(runAs(db.pool, admin, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it("proposed_tag_visible_to_proposer_and_admin_only", async () => {
    const proposer = await newAccount(db.pool);
    await onboard(db.pool, proposer, professionalPayload({ expertise: ["Levee design", "Marsh terracing"] }));
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true });

    const proposed = await db.pool.query<{ status: string; proposed_by: string }>(
      "SELECT status, proposed_by FROM expertise_tags WHERE label = 'Marsh terracing'",
    );
    expect(proposed.rows).toEqual([{ status: "proposed", proposed_by: proposer }]);

    const sql = "SELECT label FROM expertise_tags WHERE label = 'Marsh terracing'";
    expect(await rowsAs(db.pool, null, sql)).toEqual([]);
    expect(await rowsAs(db.pool, member, sql)).toEqual([]);
    expect(await rowsAs(db.pool, proposer, sql)).toEqual([{ label: "Marsh terracing" }]);
    expect(await rowsAs(db.pool, admin, sql)).toEqual([{ label: "Marsh terracing" }]);

    // An approved tag is readable by everyone.
    await asSystem(db.pool, (client) => client.query("UPDATE expertise_tags SET status = 'approved' WHERE label = 'Levee design'"));
    expect(await rowsAs(db.pool, null, "SELECT label FROM expertise_tags WHERE label = 'Levee design'")).toEqual([
      { label: "Levee design" },
    ]);
  });

  it("a_tag_another_member_proposed_first_still_shows_on_your_own_profile", async () => {
    const first = await newAccount(db.pool);
    await onboard(db.pool, first, professionalPayload({ expertise: ["Levee design", "Marsh terracing"] }));
    const second = await newAccount(db.pool);
    await onboard(db.pool, second, professionalPayload({ expertise: ["Levee design", "Marsh terracing"] }));
    const own = `SELECT t.label FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
                  WHERE pe.profile_id = app_uid() ORDER BY t.label`;
    expect(await rowsAs(db.pool, second, own)).toEqual([{ label: "Levee design" }, { label: "Marsh terracing" }]);
    // Everyone else still sees proposed tags only once approved.
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    expect(await rowsAs(db.pool, member, "SELECT label FROM expertise_tags WHERE label = 'Marsh terracing'")).toEqual([]);
  });

  it("members_propose_tags_only_through_the_profile_functions", async () => {
    const member = await makePerson(db.pool);
    await expect(
      runAs(db.pool, member, "INSERT INTO expertise_tags (label, slug, proposed_by) VALUES ('Direct tag', 'direct-tag', app_uid())"),
    ).rejects.toThrow(/permission denied/);
  });

  it("expertise_count_and_label_limits", async () => {
    const account = await newAccount(db.pool);
    await expect(onboard(db.pool, account, professionalPayload({ expertise: ["Only one"] }))).rejects.toThrow(
      /mest\.invalid_expertise/,
    );
    const thirteen = Array.from({ length: 13 }, (_, i) => `Skill number ${i}`);
    await expect(onboard(db.pool, account, professionalPayload({ expertise: thirteen }))).rejects.toThrow(
      /mest\.invalid_expertise/,
    );
    // The same label in another case is one tag, and the case-insensitive match reuses it.
    await onboard(db.pool, account, professionalPayload({ expertise: ["Levee Design", "levee design", "Permitting"] }));
    const tags = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM profile_expertise WHERE profile_id = $1",
      [account],
    );
    expect(tags.rows[0].n).toBe(2);
    const other = await newAccount(db.pool);
    await onboard(db.pool, other, professionalPayload({ expertise: ["LEVEE DESIGN", "Permitting"] }));
    const labels = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM expertise_tags");
    expect(labels.rows[0].n).toBe(2);
  });
});

describe("directory view", () => {
  it("linkedin_absent_from_directory_view", async () => {
    const pro = await makePerson(db.pool);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/example' WHERE id = $1", [pro]),
    );
    const columns = await db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('directory_entries', 'profile_entries')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("has_capacity");
    for (const forbidden of ["linkedin_url", "contact_email", "phone", "booking_url", "methods", "share_with_members", "max_active", "email"]) {
      expect(names).not.toContain(forbidden);
    }
    // A visitor can read every column the view has, and no value carries the link.
    const rows = await rowsAs(db.pool, null, "SELECT * FROM directory_entries");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("linkedin.com");
  });

  it("directory_view_derives_band_tags_capacity_and_search", async () => {
    const account = await newAccount(db.pool);
    await onboard(db.pool, account, professionalPayload({ yearsExperience: 12 }));
    // Approved by an administrator, with the tags approved.
    await asSystem(db.pool, async (client) => {
      await client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [account]);
      await client.query("UPDATE expertise_tags SET status = 'approved'");
    });
    const [row] = await rowsAs<Record<string, unknown>>(db.pool, null, "SELECT * FROM directory_entries WHERE id = $1", [
      account,
    ]);
    expect(row).toMatchObject({
      title: "Water Resources Engineer",
      organization: "Delta Drainage Partners",
      discipline_id: "coastal",
      discipline_label: "Coastal & environmental",
      experience_band: "10-19",
      verified: false,
      participation: ["directory", "networking", "mentoring"],
      tags: ["Hydraulic modeling", "Levee design"],
      mentor_status: "active",
      mentor_topics: ["internships-and-first-jobs", "professional-licensure"],
      has_capacity: true,
      location: "New Orleans, LA",
    });
    for (const [years, band] of [[0, "0-2"], [2, "0-2"], [3, "3-9"], [19, "10-19"], [20, "20+"], [60, "20+"]] as const) {
      await asSystem(db.pool, (client) =>
        client.query("UPDATE professional_details SET years_experience = $2 WHERE profile_id = $1", [account, years]),
      );
      expect(
        await scalarAs(db.pool, null, "SELECT experience_band AS value FROM directory_entries WHERE id = $1", [account]),
      ).toBe(band);
    }
    // Full-text search covers title, organization, bio and approved tags.
    for (const term of ["drainage", "hydraulic", "levees", "Noor"]) {
      const hits = await rowsAs(
        db.pool,
        null,
        `SELECT id FROM directory_entries
          WHERE search_tsv @@ (websearch_to_tsquery('english', $1) || websearch_to_tsquery('simple', $1))`,
        [term],
      );
      expect(hits, term).toHaveLength(1);
    }
    // A mentor who turns mentoring off has no capacity.
    await asSystem(db.pool, (client) =>
      client.query("UPDATE mentorship_settings SET status = 'off' WHERE profile_id = $1", [account]),
    );
    expect(await scalarAs(db.pool, null, "SELECT has_capacity AS value FROM directory_entries WHERE id = $1", [account])).toBe(
      false,
    );
  });
});

describe("complete_onboarding", () => {
  it("complete_onboarding_student_approved", async () => {
    const account = await newAccount(db.pool);
    await onboard(db.pool, account, studentPayload());
    const profile = await db.pool.query(
      `SELECT kind, approval_state, visibility, first_name, mission_accepted_at IS NOT NULL AS accepted
         FROM profiles WHERE id = $1`,
      [account],
    );
    expect(profile.rows[0]).toEqual({
      kind: "student",
      approval_state: "approved",
      visibility: "hidden",
      first_name: "Sami",
      accepted: true,
    });
    const details = await db.pool.query("SELECT program, level, topics_needed FROM student_details WHERE profile_id = $1", [
      account,
    ]);
    expect(details.rows[0]).toEqual({
      program: "BS Civil Engineering, junior",
      level: "undergrad",
      topics_needed: ["internships-and-first-jobs"],
    });
    const counts = await db.pool.query(
      `SELECT (SELECT count(*)::int FROM profile_reviews WHERE profile_id = $1) AS reviews,
              (SELECT count(*)::int FROM mentorship_settings WHERE profile_id = $1) AS settings,
              (SELECT count(*)::int FROM notification_preferences WHERE profile_id = $1) AS prefs,
              (SELECT count(*)::int FROM audit_log WHERE subject_id = $1 AND action = 'profile.submitted') AS audits`,
      [account],
    );
    expect(counts.rows[0]).toEqual({ reviews: 0, settings: 0, prefs: 1, audits: 1 });
    // The student is a member at once, and is never listed.
    expect(await visibleProfileIds(db.pool, null)).toEqual([]);
    // Running it again is refused.
    await expect(onboard(db.pool, account, studentPayload())).rejects.toThrow(/mest\.already_onboarded/);
  });

  it("complete_onboarding_professional_opens_review_and_notifies_admins_when_queue_empty", async () => {
    const admin1 = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const admin2 = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const revoked = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await asSystem(db.pool, (client) => client.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [revoked]));

    const first = await newAccount(db.pool);
    await onboard(
      db.pool,
      first,
      professionalPayload({
        linkedinUrl: "https://www.linkedin.com/in/example-noor",
        contact: { methods: ["mest", "phone", "linkedin"], shareWithMembers: ["linkedin"], phone: "+15045550123" },
      }),
    );

    const profile = await db.pool.query(
      "SELECT kind, approval_state, visibility, mission_accepted_at IS NOT NULL AS accepted FROM profiles WHERE id = $1",
      [first],
    );
    expect(profile.rows[0]).toEqual({ kind: "professional", approval_state: "pending", visibility: "public", accepted: true });
    const reviews = await db.pool.query<{ decision: string | null; snapshot: Record<string, unknown> }>(
      "SELECT decision, snapshot FROM profile_reviews WHERE profile_id = $1",
      [first],
    );
    expect(reviews.rows).toHaveLength(1);
    expect(reviews.rows[0].decision).toBeNull();
    expect(reviews.rows[0].snapshot).toMatchObject({ firstName: "Noor", title: "Water Resources Engineer" });
    // The snapshot an administrator reads carries no contact value.
    const snapshot = JSON.stringify(reviews.rows[0].snapshot);
    expect(snapshot).not.toContain("5550123");
    expect(snapshot).not.toContain("linkedin.com");

    const settings = await db.pool.query(
      "SELECT status, max_active, audience::text[] AS audience, format, mode, availability, duration_min FROM mentorship_settings WHERE profile_id = $1",
      [first],
    );
    expect(settings.rows[0]).toEqual({
      status: "active",
      max_active: 3,
      audience: ["undergrad", "early-career"],
      format: "either",
      mode: "online",
      availability: "Weekday evenings",
      duration_min: 45,
    });
    const contact = await db.pool.query("SELECT methods::text[] AS methods, share_with_members::text[] AS share_with_members, phone FROM contact_preferences WHERE profile_id = $1", [
      first,
    ]);
    expect(contact.rows[0]).toEqual({ methods: ["mest", "linkedin", "phone"], share_with_members: ["linkedin"], phone: "+15045550123" });

    const notified = await db.pool.query<{ recipient_id: string; category: string; template: string }>(
      "SELECT recipient_id, category, template FROM notifications ORDER BY recipient_id",
    );
    expect(notified.rows).toEqual(
      sorted([admin1, admin2]).map((id) => ({ recipient_id: id, category: "profile", template: "profile-submitted" })),
    );
    expect(
      (await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'profile.submitted' AND actor_id = $1", [first])).rowCount,
    ).toBe(1);

    // A second submission while the queue is not empty notifies nobody.
    const second = await newAccount(db.pool);
    await onboard(db.pool, second, professionalPayload({ firstName: "Second" }));
    expect((await db.pool.query("SELECT 1 FROM notifications")).rowCount).toBe(2);
    expect((await db.pool.query("SELECT 1 FROM profile_reviews WHERE decision IS NULL")).rowCount).toBe(2);
  });

  it("complete_onboarding_refuses_bad_payloads", async () => {
    const account = await newAccount(db.pool);
    const cases: [Record<string, unknown>, RegExp][] = [
      [professionalPayload({ acceptMission: false }), /mest\.mission_required/],
      [professionalPayload({ disciplineId: "not-a-discipline" }), /mest\.invalid_onboarding|foreign key/],
      [professionalPayload({ participation: ["directory"] }), /mest\.invalid_onboarding/], // mentorship without mentoring
      [professionalPayload({ contact: { methods: ["email"], shareWithMembers: [] } }), /mest\.invalid_contact/],
      [professionalPayload({ contact: { methods: ["mest", "linkedin"], shareWithMembers: [] } }), /mest\.invalid_contact/],
      [
        professionalPayload({ mentorship: { ...(professionalPayload().mentorship as object), topics: ["no-such-topic"] } }),
        /mest\.invalid_onboarding/,
      ],
      [studentPayload({ topicsNeeded: ["no-such-topic"] }), /mest\.invalid_onboarding/],
      [{ kind: "admin", acceptMission: true }, /mest\.invalid_onboarding/],
    ];
    for (const [payload, error] of cases) {
      await expect(onboard(db.pool, account, payload), JSON.stringify(payload).slice(0, 80)).rejects.toThrow(error);
    }
    // A visitor cannot onboard anyone.
    await expect(runAs(db.pool, null, "SELECT complete_onboarding($1::jsonb)", [JSON.stringify(studentPayload())])).rejects.toThrow(
      /mest\.forbidden/,
    );
  });

  it("affiliation_change_clears_verified", async () => {
    const owner = await makePerson(db.pool);
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await runAs(db.pool, admin, "SELECT admin_set_verified($1, 'work_email')", [owner]);
    const verified = () =>
      db.pool.query("SELECT verified, verified_method, verified_at IS NOT NULL AS at FROM professional_details WHERE profile_id = $1", [owner]);
    expect((await verified()).rows[0]).toEqual({ verified: true, verified_method: "work_email", at: true });

    // Other edits keep it.
    await runAs(db.pool, owner, "UPDATE professional_details SET years_experience = 9 WHERE profile_id = app_uid()");
    expect((await verified()).rows[0].verified).toBe(true);

    await runAs(db.pool, owner, "UPDATE professional_details SET organization = 'New Firm LLC' WHERE profile_id = app_uid()");
    expect((await verified()).rows[0]).toEqual({ verified: false, verified_method: null, at: false });
    const audit = await db.pool.query<{ actor_id: string; detail: Record<string, unknown> }>(
      "SELECT actor_id, detail FROM audit_log WHERE action = 'profile.affiliation_changed' AND subject_id = $1",
      [owner],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(owner);
    // Which fields changed, never their values: the audit log outlives account deletion.
    expect(audit.rows[0].detail).toEqual({ fields: ["organization"] });
    expect(JSON.stringify(audit.rows[0].detail)).not.toContain("Bayou Works");

    // An unverified row changes title silently.
    await runAs(db.pool, owner, "UPDATE professional_details SET title = 'Principal' WHERE profile_id = app_uid()");
    expect(
      (await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'profile.affiliation_changed'")).rowCount,
    ).toBe(1);
  });
});
