import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEED, runSeed } from "../../seed/seed";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { scalarAs, visibleProfileIds } from "../policies/fixtures";

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

async function counts() {
  const result = await db.pool.query<{ users: number; profiles: number; admins: number; professionals: number; students: number; pending: number }>(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM profiles) AS profiles,
            (SELECT count(*)::int FROM admin_roles WHERE revoked_at IS NULL) AS admins,
            (SELECT count(*)::int FROM profiles WHERE kind = 'professional' AND id NOT IN (SELECT profile_id FROM admin_roles)) AS professionals,
            (SELECT count(*)::int FROM profiles WHERE kind = 'student') AS students,
            (SELECT count(*)::int FROM profiles WHERE approval_state = 'pending') AS pending`,
  );
  return result.rows[0];
}

describe("development seed", () => {
  it("seed_inserts_23_profiles_and_2_admins", async () => {
    await runSeed();

    expect(await counts()).toEqual({ users: 25, profiles: 25, admins: 2, professionals: 18, students: 5, pending: 3 });

    // Every seeded account is verified at its <key>@example.test address and id.
    const users = await db.pool.query<{ id: string; email: string; verified: boolean }>(
      "SELECT id, email::text AS email, email_verified_at IS NOT NULL AS verified FROM users ORDER BY email",
    );
    const expected = Object.values(SEED)
      .map((identity) => ({ ...identity, verified: true }))
      .sort((a, b) => a.email.localeCompare(b.email));
    expect(users.rows).toEqual(expected);
    expect(SEED["layla-haddad"].email).toBe("layla-haddad@example.test");
    expect(SEED.admin.email).toBe("admin@example.test");
    expect(SEED.admin2.email).toBe("admin2@example.test");

    // Everyone has accepted the mission statement; kinds and states come from the prototype.
    const layla = await db.pool.query(
      "SELECT kind, approval_state, visibility, mission_accepted_at IS NOT NULL AS accepted FROM profiles WHERE id = $1",
      [SEED["layla-haddad"].id],
    );
    expect(layla.rows[0]).toEqual({ kind: "professional", approval_state: "approved", visibility: "public", accepted: true });
    const amina = await db.pool.query("SELECT kind, approval_state FROM profiles WHERE id = $1", [SEED["amina-rahman"].id]);
    expect(amina.rows[0]).toEqual({ kind: "student", approval_state: "approved" });
    const pending = await db.pool.query<{ id: string }>("SELECT id FROM profiles WHERE approval_state = 'pending' ORDER BY id");
    expect(pending.rows.map((row) => row.id).sort()).toEqual(
      [SEED["dawud-jenkins"].id, SEED["samira-benali"].id, SEED["musa-grant"].id].sort(),
    );
    const missing = await db.pool.query("SELECT 1 FROM profiles WHERE mission_accepted_at IS NULL");
    expect(missing.rowCount).toBe(0);
  });

  it("seed_directory_counts_match_the_prototype_for_visitors_and_members", async () => {
    await runSeed();
    const admins = new Set([SEED.admin.id, SEED.admin2.id]);

    // A visitor sees the 14 approved public professionals; Tariq is members-only.
    const visitor = await visibleProfileIds(db.pool, null);
    expect(visitor).toHaveLength(14);
    expect(visitor).not.toContain(SEED["tariq-mansour"].id);
    expect(visitor).not.toContain(SEED["dawud-jenkins"].id);
    expect(visitor).not.toContain(SEED["amina-rahman"].id);

    // A member (a student) sees 15 plus their own profile; administrators stay hidden.
    const member = await visibleProfileIds(db.pool, SEED["amina-rahman"].id);
    expect(member).toHaveLength(16);
    expect(member).toContain(SEED["tariq-mansour"].id);
    expect(member.some((id) => admins.has(id))).toBe(false);

    expect(await scalarAs<boolean>(db.pool, SEED.admin.id, "SELECT is_admin() AS value")).toBe(true);
    expect(await scalarAs<boolean>(db.pool, SEED.admin2.id, "SELECT is_admin() AS value")).toBe(true);
    expect(await scalarAs<boolean>(db.pool, SEED["layla-haddad"].id, "SELECT is_admin() AS value")).toBe(false);
    expect(await scalarAs<boolean>(db.pool, SEED["layla-haddad"].id, "SELECT is_member() AS value")).toBe(true);
  });

  it("seed_runs_twice_without_duplicating", async () => {
    await runSeed();
    // A local change the second run puts back.
    await db.pool.query("UPDATE profiles SET approval_state = 'declined' WHERE id = $1", [SEED["layla-haddad"].id]);
    await db.pool.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [SEED.admin2.id]);

    await runSeed();

    expect(await counts()).toEqual({ users: 25, profiles: 25, admins: 2, professionals: 18, students: 5, pending: 3 });
    const layla = await db.pool.query("SELECT approval_state FROM profiles WHERE id = $1", [SEED["layla-haddad"].id]);
    expect(layla.rows[0].approval_state).toBe("approved");
  });

  it("seed_refuses_an_address_taken_by_another_account", async () => {
    await db.pool.query("INSERT INTO users (email, email_verified_at) VALUES ('layla-haddad@example.test', now())");
    await expect(runSeed()).rejects.toThrow(/already belongs to another account/);
    // Nothing was half-written.
    expect((await counts()).profiles).toBe(0);
  });
});
