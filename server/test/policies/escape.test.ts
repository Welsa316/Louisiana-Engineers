import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, scalarAs } from "./fixtures";

/**
 * Findings from the Phase 1A privacy audit. Each test pins a way a request
 * could step outside Row Level Security, or a column or right the spec says
 * it must not have.
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

describe("request role containment", () => {
  it("reset_role_stays_inside_row_level_security", async () => {
    // SET ROLE is reversible, so a request must not log in as a role that
    // RESET ROLE could return to with more power than app_user.
    const member = await makePerson(db.pool);
    await asUser(db.pool, member, async (client) => {
      await client.query("RESET ROLE");
      const role = await client.query<{ name: string; superuser: boolean; bypass: boolean }>(
        `SELECT current_user AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypass
           FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(role.rows[0].superuser).toBe(false);
      expect(role.rows[0].bypass).toBe(false);
    });
    await expect(
      asUser(db.pool, member, async (client) => {
        await client.query("RESET ROLE");
        await client.query("SELECT count(*) FROM users");
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("temp_tables_cannot_shadow_real_tables", async () => {
    // pg_temp is searched first unless listed; a temp admin_roles would make
    // is_admin() true for anyone.
    const member = await makePerson(db.pool);
    await expect(
      asUser(db.pool, member, (client) => client.query("CREATE TEMP TABLE admin_roles (profile_id uuid)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("every_definer_function_searches_pg_temp_last", async () => {
    const loose = await db.pool.query<{ name: string; config: string[] | null }>(
      `SELECT p.proname AS name, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
             WHERE c ~ '^search_path=.*pg_temp\\s*$'
          )`,
    );
    expect(loose.rows).toEqual([]);
  });
});

describe("profile columns and rights", () => {
  it("member_with_open_deletion_cannot_relist_profile", async () => {
    const leaving = await makePerson(db.pool, { visibility: "hidden" });
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'public')`,
        [leaving],
      ),
    );
    await asUser(db.pool, leaving, (client) =>
      client.query("UPDATE profiles SET visibility = 'public' WHERE id = app_uid()"),
    );
    const after = await db.pool.query<{ visibility: string }>("SELECT visibility FROM profiles WHERE id = $1", [
      leaving,
    ]);
    expect(after.rows[0].visibility).toBe("hidden");
  });

  it("linkedin_url_is_not_readable_by_requests", async () => {
    // It leaves only through release_contact (a definer function).
    const owner = await makePerson(db.pool);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/x' WHERE id = $1", [owner]),
    );
    for (const viewer of [null, await makePerson(db.pool), owner]) {
      await expect(
        asUser(db.pool, viewer, (client) => client.query("SELECT linkedin_url FROM profiles")),
      ).rejects.toThrow(/permission denied/);
    }
    // The public columns are still readable.
    const names = await scalarAs<number>(db.pool, null, "SELECT count(first_name)::int AS value FROM profiles");
    expect(names).toBeGreaterThan(0);
  });

  it("suspended_or_leaving_admin_loses_admin_rights", async () => {
    const suspended = await makePerson(db.pool, { admin: true, suspended: true });
    const leaving = await makePerson(db.pool, { admin: true });
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'public')`,
        [leaving],
      ),
    );
    for (const admin of [suspended, leaving]) {
      expect(await scalarAs<boolean>(db.pool, admin, "SELECT is_admin() AS value")).toBe(false);
      await expect(
        asUser(db.pool, admin, (client) => client.query("SELECT admin_update_config('pending_cap', '4')")),
      ).rejects.toThrow(/mest\.forbidden/);
    }
  });
});
