import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signInEmail } from "../../src/auth/magic-link";
import { withSystem } from "../../src/db/tx";
import { env, loadEnv } from "../../src/env";
import { createTestDb, truncateAll, type TestDb } from "../harness";

/**
 * ADMIN_EMAILS: a listed address becomes an administrator the first time it
 * signs in, and lands on the admin area without filling in a profile. It is
 * a bootstrap, not a standing rule: a role revoked later stays revoked.
 */

let db: TestDb;
const saved = env.ADMIN_EMAILS;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  env.ADMIN_EMAILS = saved;
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  env.ADMIN_EMAILS = ["first-admin@example.test"];
});

const isAdmin = async (userId: string) =>
  (
    await db.pool.query<{ active: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM admin_roles WHERE profile_id = $1 AND revoked_at IS NULL) AS active",
      [userId],
    )
  ).rows[0].active;

describe("ADMIN_EMAILS", () => {
  it("listed_address_becomes_admin_and_skips_onboarding", async () => {
    const signIn = await withSystem((tx) => signInEmail(tx, "First-Admin@Example.test"));
    expect(await isAdmin(signIn.userId)).toBe(true);
    expect(signIn.redirect).toBe("/network/admin");

    // Every later sign-in lands there too while no profile has been filled in.
    const again = await withSystem((tx) => signInEmail(tx, "first-admin@example.test"));
    expect(again.redirect).toBe("/network/admin");
  });

  it("unlisted_address_is_an_ordinary_new_member", async () => {
    const signIn = await withSystem((tx) => signInEmail(tx, "someone@example.test"));
    expect(await isAdmin(signIn.userId)).toBe(false);
    expect(signIn.redirect).toBe("/network/onboarding");
  });

  it("a_revoked_role_is_not_granted_again", async () => {
    const first = await withSystem((tx) => signInEmail(tx, "first-admin@example.test"));
    await db.pool.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [first.userId]);

    const again = await withSystem((tx) => signInEmail(tx, "first-admin@example.test"));
    expect(await isAdmin(first.userId)).toBe(false);
    expect(again.redirect).toBe("/network/onboarding");
  });

  it("parses_a_comma_separated_list_and_refuses_a_bad_address", () => {
    const base = { DATABASE_URL: "postgres://x", APP_ORIGIN: "http://127.0.0.1:1", SESSION_SECRET: "s".repeat(32), EMAIL_FROM: "a@b.test" };
    expect(loadEnv({ ...base, ADMIN_EMAILS: " A@Example.test, b@example.test ," }).ADMIN_EMAILS).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
    expect(loadEnv(base).ADMIN_EMAILS).toEqual([]);
    expect(() => loadEnv({ ...base, ADMIN_EMAILS: "not-an-address" })).toThrow(/ADMIN_EMAILS/);
  });
});
