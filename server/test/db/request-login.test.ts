import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
