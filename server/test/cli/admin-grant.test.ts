import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminGrantError, grantAdminByEmail, parseAdminGrantArgs } from "../../src/cli/admin-grant";
import { withSystem } from "../../src/db/tx";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, scalarAs } from "../policies/fixtures";

/**
 * `npm run admin:grant -- <email>`: the one command-line path that makes an
 * administrator (02 section 10). It runs as the table owner, so these tests
 * pin what it refuses as well as what it grants.
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

const grant = (email: string) => withSystem((tx) => grantAdminByEmail(tx, email));

async function roleRow(profileId: string) {
  const result = await db.pool.query<{ granted_by: string | null; revoked_at: Date | null }>(
    "SELECT granted_by, revoked_at FROM admin_roles WHERE profile_id = $1",
    [profileId],
  );
  return result.rows;
}

async function auditRows(profileId: string) {
  const result = await db.pool.query<{ actor_id: string | null; action: string; detail: Record<string, unknown> }>(
    "SELECT actor_id, action, detail FROM audit_log WHERE subject_id = $1 ORDER BY id",
    [profileId],
  );
  return result.rows;
}

describe("grantAdminByEmail", () => {
  it("grants_a_signed_in_member_who_can_then_act_as_administrator", async () => {
    const email = "first.admin@example.test";
    const id = await makePerson(db.pool, { email, kind: "student", visibility: "hidden" });
    expect(await scalarAs<boolean>(db.pool, id, "SELECT is_admin() AS value")).toBe(false);

    const outcome = await grant(email);

    expect(outcome).toEqual({ status: "granted", profileId: id, activeAdmins: 1 });
    expect(await roleRow(id)).toEqual([{ granted_by: null, revoked_at: null }]);
    expect(await scalarAs<boolean>(db.pool, id, "SELECT is_admin() AS value")).toBe(true);
    // The audit entry has no actor (the command line has no signed-in user)
    // and never the address.
    const audit = await auditRows(id);
    expect(audit).toEqual([{ actor_id: null, action: "admin.granted", detail: { via: "admin-grant" } }]);
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it("matches_the_address_ignoring_case_and_surrounding_space", async () => {
    const id = await makePerson(db.pool, { email: "Mixed.Case@Example.test" });
    const outcome = await grant("  mixed.case@example.TEST ");
    expect(outcome.profileId).toBe(id);
    expect(await scalarAs<boolean>(db.pool, id, "SELECT is_admin() AS value")).toBe(true);
  });

  it("refuses_an_address_with_no_account_and_creates_nothing", async () => {
    await expect(grant("nobody@example.test")).rejects.toMatchObject({ code: "not_found" });
    const users = await db.pool.query("SELECT 1 FROM users");
    const roles = await db.pool.query("SELECT 1 FROM admin_roles");
    expect(users.rowCount).toBe(0);
    expect(roles.rowCount).toBe(0);
  });

  it("refuses_unverified_suspended_deleting_and_anonymized_accounts", async () => {
    const unverified = await makePerson(db.pool, { email: "unverified@example.test", verified: false });
    const suspended = await makePerson(db.pool, { email: "suspended@example.test", suspended: true });
    const anonymized = await makePerson(db.pool, { email: "anonymized@example.test", anonymized: true });
    const leaving = await makePerson(db.pool, { email: "leaving@example.test" });
    await db.pool.query(
      `INSERT INTO account_deletions (profile_id, requested_at, execute_after, previous_visibility, immediate)
       VALUES ($1, now(), now() + interval '14 days', 'public', false)`,
      [leaving],
    );

    await expect(grant("unverified@example.test")).rejects.toMatchObject({ code: "not_verified" });
    await expect(grant("suspended@example.test")).rejects.toMatchObject({ code: "suspended" });
    await expect(grant("anonymized@example.test")).rejects.toMatchObject({ code: "deleted" });
    await expect(grant("leaving@example.test")).rejects.toMatchObject({ code: "deleting" });

    for (const id of [unverified, suspended, anonymized, leaving]) {
      expect(await roleRow(id)).toEqual([]);
      expect(await auditRows(id)).toEqual([]);
    }
  });

  it("restores_a_revoked_role_and_a_repeat_changes_nothing", async () => {
    const other = await makePerson(db.pool, { email: "other@example.test", admin: true });
    const id = await makePerson(db.pool, { email: "returning@example.test" });
    await db.pool.query(
      "INSERT INTO admin_roles (profile_id, granted_by, granted_at, revoked_at) VALUES ($1, $2, now() - interval '1 year', now())",
      [id, other],
    );

    const restored = await grant("returning@example.test");
    expect(restored).toEqual({ status: "restored", profileId: id, activeAdmins: 2 });
    expect(await roleRow(id)).toEqual([{ granted_by: null, revoked_at: null }]);

    const repeat = await grant("returning@example.test");
    expect(repeat).toEqual({ status: "already_admin", profileId: id, activeAdmins: 2 });
    // One audit entry for the one change.
    expect((await auditRows(id)).map((row) => row.action)).toEqual(["admin.granted"]);
  });

  it("errors_are_admin_grant_errors", async () => {
    const error = await grant("nobody@example.test").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdminGrantError);
    expect((error as Error).message).not.toContain("nobody@example.test");
  });
});

describe("parseAdminGrantArgs", () => {
  it("takes_exactly_one_address", () => {
    expect(parseAdminGrantArgs(["someone@example.test"])).toBe("someone@example.test");
    expect(() => parseAdminGrantArgs([])).toThrow(/usage/i);
    expect(() => parseAdminGrantArgs(["a@example.test", "b@example.test"])).toThrow(/usage/i);
    expect(() => parseAdminGrantArgs(["not-an-address"])).toThrow(/address/i);
  });
});
