import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, runAs } from "./fixtures";
import { chooseAs, makePair, proposeAs, slotAt, slotsOf, type Pair } from "./meeting-fixtures";
import { resetRequestConfig } from "./request-fixtures";

/**
 * Row policies and rights for availability_slots, meetings and my_meetings
 * (02 sections 5.3 and 5.4): both parties of the relationship read; nobody
 * else does, administrators included; nobody writes except through the
 * functions; the job functions refuse every member.
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
  await resetRequestConfig(db.pool);
});

async function countAs(userId: string | null, sql: string): Promise<number> {
  return asUser(db.pool, userId, async (client) => (await client.query<{ n: number }>(sql)).rows[0].n);
}

/** A pair with one proposal (two times) from the mentee and a meeting from one of them. */
async function scheduledPair(): Promise<Pair & { meetingId: string }> {
  const pair = await makePair(db.pool);
  const batch = await proposeAs(db.pool, pair.mentee, pair.relationshipId, [slotAt(48), slotAt(72)]);
  const [first] = await slotsOf(db.pool, batch);
  const meetingId = await chooseAs(db.pool, pair.mentor, first.id);
  return { ...pair, meetingId };
}

describe("who reads slots and meetings", () => {
  it("only_parties_read", async () => {
    const pair = await scheduledPair();
    const stranger = await makePerson(db.pool);
    const admin = await makePerson(db.pool, { admin: true });
    // A second pair's rows must not show up for the first pair either.
    const other = await scheduledPair();

    for (const party of [pair.mentee, pair.mentor]) {
      expect(await countAs(party, "SELECT count(*)::int AS n FROM availability_slots")).toBe(2);
      expect(await countAs(party, "SELECT count(*)::int AS n FROM meetings")).toBe(1);
      expect(await countAs(party, "SELECT count(*)::int AS n FROM my_meetings")).toBe(1);
      const ids = await asUser(db.pool, party, async (c) => (await c.query<{ id: string }>("SELECT id FROM meetings")).rows);
      expect(ids.map((r) => r.id)).toEqual([pair.meetingId]);
    }
    for (const outsider of [stranger, admin, null]) {
      expect(await countAs(outsider, "SELECT count(*)::int AS n FROM availability_slots")).toBe(0);
      expect(await countAs(outsider, "SELECT count(*)::int AS n FROM meetings")).toBe(0);
      expect(await countAs(outsider, "SELECT count(*)::int AS n FROM my_meetings")).toBe(0);
    }
    expect(other.meetingId).not.toBe(pair.meetingId);
  });

  it("parties_keep_reading_after_the_relationship_ends", async () => {
    const pair = await scheduledPair();
    await runAs(db.pool, pair.mentee, "SELECT complete_relationship($1)", [pair.requestId]);
    expect(await countAs(pair.mentee, "SELECT count(*)::int AS n FROM meetings")).toBe(1);
    const names = await asUser(db.pool, pair.mentee, async (c) =>
      (await c.query<{ first: string }>("SELECT counterparty_first_name AS first FROM my_meetings")).rows,
    );
    expect(names).toEqual([{ first: "Layla" }]);
  });

  it("administrators_see_counts_only", async () => {
    await scheduledPair();
    const admin = await makePerson(db.pool, { admin: true });
    const counts = await asUser(db.pool, admin, async (c) =>
      (await c.query<{ held: number; upcoming: number }>(
        "SELECT meetings_held AS held, meetings_upcoming AS upcoming FROM admin_dashboard",
      )).rows,
    );
    expect(counts).toEqual([{ held: 0, upcoming: 1 }]);
    const member = await makePerson(db.pool);
    expect(await countAs(member, "SELECT count(*)::int AS n FROM admin_dashboard")).toBe(0);
  });
});

describe("writes go through the functions", () => {
  it("parties_cannot_write_rows_directly", async () => {
    const pair = await scheduledPair();
    for (const party of [pair.mentee, pair.mentor]) {
      await expect(
        runAs(db.pool, party, "UPDATE meetings SET status = 'completed' WHERE id = $1", [pair.meetingId]),
      ).rejects.toThrow(/permission denied/);
      await expect(runAs(db.pool, party, "UPDATE meetings SET agenda = 'x'")).rejects.toThrow(/permission denied/);
      await expect(runAs(db.pool, party, "DELETE FROM meetings")).rejects.toThrow(/permission denied/);
      await expect(
        runAs(
          db.pool,
          party,
          `INSERT INTO availability_slots (relationship_id, proposed_by, batch_id, starts_at, ends_at)
           VALUES ($1, app_uid(), gen_random_uuid(), now() + interval '1 day', now() + interval '1 day 1 hour')`,
          [pair.relationshipId],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(runAs(db.pool, party, "UPDATE availability_slots SET status = 'chosen'")).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("members_cannot_run_the_job_functions_or_the_helpers", async () => {
    const pair = await scheduledPair();
    for (const sql of [
      "SELECT complete_past_meetings(now() + interval '30 days')",
      "SELECT meeting_prompt(now() + interval '30 days')",
      `SELECT close_meetings_of_departing('${pair.mentor}')`,
      `SELECT lock_active_relationship('${pair.relationshipId}')`,
    ]) {
      await expect(runAs(db.pool, pair.mentee, sql)).rejects.toThrow(/permission denied/);
    }
  });
});
