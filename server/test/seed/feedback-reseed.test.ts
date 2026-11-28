import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEED, runSeed } from "../../seed/seed";
import { asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { acceptRequest, makeMentor, sendRequest } from "../policies/request-fixtures";

/**
 * The e2e suite re-seeds after specs that complete mentorships and leave
 * feedback. The seed removes relationships it did not write, so the feedback
 * hanging off them has to go first.
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

describe("re-seeding after feedback", () => {
  it("reseed_clears_feedback_on_relationships_it_did_not_write", async () => {
    await runSeed();
    const mentee = SEED["hamza-ali"].id;
    // A seeded mentee is enough: the seed clears requests involving its people.
    const mentor = await makeMentor(db.pool);
    const id = await sendRequest(db.pool, mentee, mentor);
    await acceptRequest(db.pool, mentor, id);
    await asUser(db.pool, mentee, (c) => c.query("SELECT complete_relationship($1)", [id]));
    await asUser(db.pool, mentee, (c) => c.query("SELECT leave_feedback($1, 5, 'Very helpful.')", [id]));

    await expect(runSeed()).resolves.toBeUndefined();
    const left = await db.pool.query("SELECT 1 FROM relationship_feedback f JOIN mentorship_relationships r ON r.id = f.relationship_id WHERE r.request_id = $1", [id]);
    expect(left.rowCount).toBe(0);
  });
});
