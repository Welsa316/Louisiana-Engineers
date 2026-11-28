import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withSystem } from "../../src/db/tx";
import { seedMeetings } from "../../seed/meetings";
import { seedRequestId } from "../../seed/requests";
import { SEED, runSeed } from "../../seed/seed";
import { createTestDb, truncateAll, type TestDb } from "../harness";
import { rowsAs } from "../policies/fixtures";

/**
 * The seeded schedule the scheduling screens and their e2e spec start from
 * (Task 31), and the request seed's reset with meetings in place: a re-run
 * must clear every meeting and proposed time between seeded people, or
 * deleting an unlisted relationship trips the meetings' foreign keys.
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

const seedAllWithMeetings = async () => {
  await runSeed();
  await withSystem(seedMeetings);
};

interface MeetingView extends Record<string, unknown> {
  request_id: string;
  status: string;
  met: boolean | null;
  future: boolean;
  created_by_me: boolean;
}

const meetingsOf = (key: string) =>
  rowsAs<MeetingView>(
    db.pool,
    SEED[key].id,
    `SELECT request_id, status::text AS status, met, starts_at > now() AS future, created_by_me
       FROM my_meetings ORDER BY starts_at`,
  );

const openSlotsOf = (key: string, requestKey: string) =>
  rowsAs<{ mine: boolean; future: boolean; minutes: number }>(
    db.pool,
    SEED[key].id,
    `SELECT s.proposed_by = app_uid() AS mine, s.starts_at > now() AS future,
            (extract(epoch FROM s.ends_at - s.starts_at) / 60)::int AS minutes
       FROM availability_slots s
       JOIN mentorship_relationships rel ON rel.id = s.relationship_id
      WHERE rel.request_id = $1 AND s.status = 'proposed'
      ORDER BY s.starts_at`,
    [seedRequestId(requestKey)],
  );

async function addUnlistedRelationshipWithMeeting(): Promise<string> {
  // Amina and Layla, accepted outside the seed (as the e2e specs do), with a proposal and a meeting.
  const { rows } = await db.pool.query<{ id: string; rel: string }>(
    `WITH r AS (
       INSERT INTO mentorship_requests (mentee_id, mentor_id, kind, topic_id, why, format, mode, status, expires_at, responded_at)
       VALUES ($1, $2, 'mentorship', 'professional-licensure',
               'I would like an hour on the FE exam with someone who passed it while working.',
               'one-time', 'online', 'accepted', now() + interval '14 days', now())
       RETURNING id, mentee_id, mentor_id
     )
     INSERT INTO mentorship_relationships (request_id, mentee_id, mentor_id, topic_id, shared_methods, started_at)
     SELECT r.id, r.mentee_id, r.mentor_id, 'professional-licensure', '{email}'::contact_method[], now() FROM r
     RETURNING request_id AS id, id AS rel`,
    [SEED["amina-rahman"].id, SEED["layla-haddad"].id],
  );
  const { id, rel } = rows[0];
  const slot = await db.pool.query<{ id: string }>(
    `INSERT INTO availability_slots (relationship_id, proposed_by, batch_id, starts_at, ends_at, status)
     VALUES ($1, $2, gen_random_uuid(), now() + interval '2 days', now() + interval '2 days 45 minutes', 'chosen')
     RETURNING id`,
    [rel, SEED["layla-haddad"].id],
  );
  await db.pool.query(
    `INSERT INTO meetings (relationship_id, slot_id, starts_at, duration_min, mode, created_by)
     VALUES ($1, $2, now() + interval '2 days', 45, 'online', $3)`,
    [rel, slot.rows[0].id, SEED["amina-rahman"].id],
  );
  return id;
}

describe("seeded meetings", () => {
  it("seed_reruns_with_meetings_on_an_unlisted_relationship", async () => {
    await runSeed();
    const unlisted = await addUnlistedRelationshipWithMeeting();

    await runSeed();

    const left = await db.pool.query("SELECT 1 FROM mentorship_requests WHERE id = $1", [unlisted]);
    expect(left.rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM meetings")).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM availability_slots")).rowCount).toBe(0);
  });

  it("seed_meetings_writes_the_listed_schedule", async () => {
    await seedAllWithMeetings();

    // Amina and Zainab (req-1001): one met in the past awaiting the answer, one to come.
    const amina = await meetingsOf("amina-rahman");
    expect(amina.map(({ request_id, met, future }) => ({ request_id, met, future }))).toEqual([
      { request_id: seedRequestId("req-1001"), met: null, future: false },
      { request_id: seedRequestId("req-1001"), met: null, future: true },
    ]);
    expect(amina.map((m) => m.status)).toEqual(["completed", "upcoming"]);

    // Sumaya and Layla (req-1005): three open times from Layla to choose from.
    const sumaya = await openSlotsOf("sumaya-osman", "req-1005");
    expect(sumaya).toHaveLength(3);
    expect(sumaya.every((s) => !s.mine && s.future && s.minutes >= 15 && s.minutes <= 180)).toBe(true);
    expect(await openSlotsOf("layla-haddad", "req-1005")).toEqual(sumaya.map((s) => ({ ...s, mine: true })));

    // Layla and Idris (req-1006, completed): the meeting they held.
    const layla = await meetingsOf("layla-haddad");
    expect(layla).toEqual([
      { request_id: seedRequestId("req-1006"), status: "completed", met: true, future: false, created_by_me: true },
    ]);

    // Seeding schedules nobody's day: no notifications, no email.
    expect((await db.pool.query("SELECT 1 FROM notifications")).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM email_outbox")).rowCount).toBe(0);
  });

  it("seed_meetings_puts_a_changed_schedule_back", async () => {
    await seedAllWithMeetings();
    // What the e2e spec does: a choice made, a meeting canceled, an answer given.
    await db.pool.query(`UPDATE availability_slots SET status = 'declined'`);
    await db.pool.query(`UPDATE meetings SET status = 'canceled', canceled_by = created_by, canceled_at = now()`);

    await seedAllWithMeetings();

    expect((await meetingsOf("amina-rahman")).map((m) => m.status)).toEqual(["completed", "upcoming"]);
    expect(await openSlotsOf("sumaya-osman", "req-1005")).toHaveLength(3);
    expect((await db.pool.query("SELECT 1 FROM meetings")).rowCount).toBe(3);
    expect((await db.pool.query("SELECT 1 FROM availability_slots")).rowCount).toBe(6);
  });

  it("seed_meetings_runs_again_on_its_own", async () => {
    // Once seed.ts calls it, the e2e reset runs it a second time straight after.
    await seedAllWithMeetings();
    await db.pool.query(`UPDATE meetings SET status = 'canceled', canceled_by = created_by, canceled_at = now()`);

    await withSystem(seedMeetings);

    expect((await meetingsOf("amina-rahman")).map((m) => m.status)).toEqual(["completed", "upcoming"]);
    expect((await db.pool.query("SELECT 1 FROM meetings")).rowCount).toBe(3);
    expect((await db.pool.query("SELECT 1 FROM availability_slots")).rowCount).toBe(6);
  });
});
