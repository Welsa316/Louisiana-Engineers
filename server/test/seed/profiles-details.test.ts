import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withSystem } from "../../src/db/tx";
import { SEED, seedAll } from "../../seed/seed";
import { SEED_PROFESSIONAL_DETAILS, SEED_STUDENT_DETAILS, seedProfilesDetails } from "../../seed/profiles-details";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { rowsAs, scalarAs, visibleProfileIds } from "../policies/fixtures";

/**
 * The detail seed on top of the core seed. Calls seedProfilesDetails itself
 * after seedAll, so it holds whether or not seed.ts already calls it.
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

const seedEverything = () =>
  withSystem(async (tx) => {
    await seedAll(tx);
    await seedProfilesDetails(tx);
  });

async function counts() {
  const result = await db.pool.query(
    `SELECT (SELECT count(*)::int FROM professional_details) AS professional_details,
            (SELECT count(*)::int FROM student_details) AS student_details,
            (SELECT count(*)::int FROM mentorship_settings) AS mentorship_settings,
            (SELECT count(*)::int FROM contact_preferences) AS contact_preferences,
            (SELECT count(*)::int FROM notification_preferences) AS notification_preferences,
            (SELECT count(*)::int FROM saved_profiles) AS saved,
            (SELECT count(*)::int FROM profile_reviews WHERE decision IS NULL) AS open_reviews,
            (SELECT count(*)::int FROM profile_expertise) AS expertise_links,
            (SELECT count(*)::int FROM education) AS education,
            (SELECT count(*)::int FROM professional_details WHERE verified) AS verified`,
  );
  return result.rows[0];
}

describe("profile detail seed", () => {
  it("seed_details_list_the_prototype_directory", async () => {
    await seedEverything();

    expect(await counts()).toEqual({
      professional_details: 18,
      student_details: 5,
      mentorship_settings: 18,
      contact_preferences: 18,
      notification_preferences: 25,
      saved: 2,
      open_reviews: 3,
      expertise_links: SEED_PROFESSIONAL_DETAILS.reduce((n, p) => n + p.expertise.length, 0),
      education: SEED_PROFESSIONAL_DETAILS.reduce((n, p) => n + p.education.length, 0),
      verified: SEED_PROFESSIONAL_DETAILS.filter((p) => p.verified).length,
    });
    expect(SEED_STUDENT_DETAILS).toHaveLength(5);

    // The directory the prototype showed: 14 to a visitor, 15 to a member.
    expect(await visibleProfileIds(db.pool, null)).toHaveLength(14);
    const visitor = await rowsAs<{ id: string }>(db.pool, null, "SELECT id FROM directory_entries");
    expect(visitor).toHaveLength(14);
    const member = await rowsAs<{ id: string }>(db.pool, SEED["amina-rahman"].id, "SELECT id FROM directory_entries");
    expect(member).toHaveLength(15);
    expect(member.map((r) => r.id)).toContain(SEED["tariq-mansour"].id);

    // Layla: verified, mentoring, tags approved.
    const [layla] = await rowsAs<Record<string, unknown>>(db.pool, null, "SELECT * FROM directory_entries WHERE id = $1", [
      SEED["layla-haddad"].id,
    ]);
    expect(layla).toMatchObject({
      title: "Senior Coastal Engineer",
      verified: true,
      mentor_status: "active",
      has_capacity: true,
      experience_band: "10-19",
    });
    expect(layla.tags).toContain("Levee design");
    // Fatima is paused until January; Ibrahim does not mentor.
    expect(await scalarAs(db.pool, null, "SELECT mentor_status::text AS value FROM directory_entries WHERE id = $1", [SEED["fatima-noor"].id])).toBe(
      "paused",
    );
    expect(await scalarAs(db.pool, null, "SELECT mentor_status::text AS value FROM directory_entries WHERE id = $1", [SEED["ibrahim-okafor"].id])).toBe(
      "off",
    );

    // Pending professionals' new labels wait as proposed tags; their bios meet the limit.
    const proposed = await db.pool.query<{ label: string }>("SELECT label FROM expertise_tags WHERE status = 'proposed' ORDER BY label");
    expect(proposed.rows.map((r) => r.label)).toContain("Websites");
    const musa = await db.pool.query<{ n: number }>("SELECT char_length(bio) AS n FROM profiles WHERE id = $1", [SEED["musa-grant"].id]);
    expect(musa.rows[0].n).toBeGreaterThanOrEqual(120);

    // Contact: a member sees what is shared; the phone stays back.
    const laylaContact = await rowsAs<{ method: string }>(
      db.pool,
      SEED["amina-rahman"].id,
      "SELECT method::text FROM release_contact($1)",
      [SEED["layla-haddad"].id],
    );
    expect(laylaContact.map((r) => r.method)).toEqual(["linkedin", "booking"]);
    const khalid = await rowsAs<{ method: string; value: string }>(
      db.pool,
      SEED["amina-rahman"].id,
      "SELECT method::text, value FROM release_contact($1)",
      [SEED["khalid-boudreaux"].id],
    );
    expect(khalid).toEqual([{ method: "email", value: "khalid-boudreaux@example.test" }]);
    expect(await rowsAs(db.pool, null, "SELECT * FROM release_contact($1)", [SEED["layla-haddad"].id])).toEqual([]);
  });

  it("seed_details_run_twice_without_duplicating", async () => {
    await seedEverything();
    const first = await counts();
    // A local change the second run puts back.
    await db.pool.query("UPDATE professional_details SET participation = '{networking}' WHERE profile_id = $1", [
      SEED["layla-haddad"].id,
    ]);
    await seedEverything();
    expect(await counts()).toEqual(first);
    expect(await rowsAs(db.pool, null, "SELECT id FROM directory_entries")).toHaveLength(14);
  });
});
