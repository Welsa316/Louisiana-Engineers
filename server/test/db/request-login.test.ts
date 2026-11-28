import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, disableRequestPool, getRequestPool, requestPoolDisabledReason, setRequestPool } from "../../src/db/pool";
import { verifyRequestLogin } from "../../src/db/request-login";
import { createTestDb, type TestDb } from "../harness";

/**
 * The production start check on the request pool's login (runbook: "The
 * request login"). A REQUEST_DATABASE_URL that points at the owner, or at a
 * superuser, would let SQL in a request RESET ROLE out of row-level
 * security, so the server refuses to start with one.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe("verifyRequestLogin", () => {
  it("accepts_mest_request", async () => {
    await expect(verifyRequestLogin(db.requestPool)).resolves.toBe("mest_request");
  });

  it("refuses_the_owner_login", async () => {
    // The harness's owner pool logs in as the table owner (a superuser locally and in CI).
    await expect(verifyRequestLogin(db.pool)).rejects.toThrow(/REQUEST_DATABASE_URL/);
  });

  // Each condition on its own, with a throwaway login that is not a superuser.
  const cases: [string, string][] = [
    ["not_in_app_user", "CREATE ROLE %I LOGIN"],
    ["bypassrls", "CREATE ROLE %I LOGIN BYPASSRLS IN ROLE app_user"],
    ["table_owner_member", "CREATE ROLE %I LOGIN IN ROLE app_user"],
  ];
  for (const [label, create] of cases) {
    it(`refuses_a_login_that_is_${label}`, async () => {
      const role = `mest_check_${label}_${process.pid}`;
      await db.pool.query(create.replace("%I", `"${role}"`));
      if (label === "table_owner_member") {
        const owner = await db.pool.query<{ owner: string }>(
          "SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'",
        );
        await db.pool.query(`GRANT "${owner.rows[0].owner}" TO "${role}"`);
      }
      const url = new URL(db.url);
      url.username = role;
      url.password = "";
      const pool = createPool(url.toString(), { max: 1 });
      try {
        const superuser = await pool.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
        expect(superuser.rows[0].s).toBe(false);
        await expect(verifyRequestLogin(pool)).rejects.toThrow(/REQUEST_DATABASE_URL/);
      } finally {
        await pool.end();
        await db.pool.query(`DROP OWNED BY "${role}"`);
        await db.pool.query(`DROP ROLE "${role}"`);
      }
    });
  }

  it("a_failed_check_switches_requests_off_instead_of_using_the_login", () => {
    // A pool of its own to switch off: disabling ends the current pool, and
    // the harness closes db.requestPool itself after the suite.
    setRequestPool(createPool(db.url, { max: 1 }));
    disableRequestPool("REQUEST_DATABASE_URL logs in as postgres");
    try {
      expect(requestPoolDisabledReason()).toMatch(/postgres/);
      expect(() => getRequestPool()).toThrow(/requests are switched off/);
    } finally {
      setRequestPool(db.requestPool);
    }
    expect(requestPoolDisabledReason()).toBeUndefined();
  });
});
