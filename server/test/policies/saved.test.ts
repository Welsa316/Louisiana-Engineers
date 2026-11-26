import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs, scalarAs } from "./fixtures";

/**
 * saved_profiles: only the saver ever sees a save (not the saved person, not
 * administrators), and saves go through save_profile and unsave_profile.
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

const saves = (viewer: string | null) =>
  rowsAs<{ saver_id: string; saved_id: string }>(db.pool, viewer, "SELECT saver_id, saved_id FROM saved_profiles ORDER BY saved_id");

describe("saved_profiles", () => {
  it("saved_profiles_visible_to_the_saver_only", async () => {
    const pro = await makePerson(db.pool);
    const saver = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });

    await runAs(db.pool, saver, "SELECT save_profile($1)", [pro]);
    // Saving twice is one save.
    await runAs(db.pool, saver, "SELECT save_profile($1)", [pro]);

    expect(await saves(saver)).toEqual([{ saver_id: saver, saved_id: pro }]);
    for (const viewer of [null, pro, admin]) {
      expect(await saves(viewer)).toEqual([]);
    }
    // Direct writes are refused; the functions are the way in.
    await expect(
      runAs(db.pool, saver, "INSERT INTO saved_profiles (saver_id, saved_id) VALUES (app_uid(), $1)", [pro]),
    ).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, saver, "DELETE FROM saved_profiles")).rejects.toThrow(/permission denied/);

    await runAs(db.pool, saver, "SELECT unsave_profile($1)", [pro]);
    expect(await saves(saver)).toEqual([]);
  });

  it("save_profile_needs_a_member_and_a_visible_professional", async () => {
    const pro = await makePerson(db.pool);
    const hidden = await makePerson(db.pool, { visibility: "hidden" });
    const membersOnly = await makePerson(db.pool, { visibility: "members" });
    const student = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const unverified = await makePerson(db.pool, { kind: "student", visibility: "hidden", verified: false });

    await expect(runAs(db.pool, null, "SELECT save_profile($1)", [pro])).rejects.toThrow(/mest\.forbidden/);
    await expect(runAs(db.pool, unverified, "SELECT save_profile($1)", [pro])).rejects.toThrow(/mest\.forbidden/);
    for (const target of [hidden, student]) {
      await expect(runAs(db.pool, student, "SELECT save_profile($1)", [target])).rejects.toThrow(/mest\.not_found/);
    }
    await runAs(db.pool, student, "SELECT save_profile($1)", [membersOnly]);
    expect(await scalarAs<number>(db.pool, student, "SELECT count(*)::int AS value FROM saved_profiles")).toBe(1);
    // A professional cannot save themselves.
    await expect(runAs(db.pool, pro, "SELECT save_profile($1)", [pro])).rejects.toThrow(/mest\.not_found/);
  });
});
