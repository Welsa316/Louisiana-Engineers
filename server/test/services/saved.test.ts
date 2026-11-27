import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { savedRoutes } from "../../src/routes/saved";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { runAs } from "../policies/fixtures";
import { makeMentor, makeStudent, sendRequest } from "../policies/request-fixtures";

/**
 * `GET /api/me/saved` (Task 22's Saved page): the caller's own saved
 * profiles, newest first, as directory cards. Only profiles the caller can
 * still find in the directory are listed; a save of a profile that has since
 * been hidden stays in the table (the owner can unhide) but is not shown.
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

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(savedRoutes);

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

async function getSaved(cookie: string | null, query = ""): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  const res = await app.request(`/api/saved${query}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function save(saver: string, saved: string): Promise<void> {
  await runAs(db.pool, saver, "SELECT save_profile($1)", [saved]);
}

describe("GET /api/me/saved", () => {
  it("saved_lists_own_saves_only_newest_first", async () => {
    const amina = await makeStudent(db.pool, { firstName: "Amina" });
    const other = await makeStudent(db.pool, { firstName: "Hamza" });
    const layla = await makeMentor(db.pool, { firstName: "Layla", lastName: "Haddad" });
    const omar = await makeMentor(db.pool, { firstName: "Omar", lastName: "Siddiqui" });
    const yusuf = await makeMentor(db.pool, { firstName: "Yusuf", lastName: "Hassan" });

    await save(amina, layla);
    await save(amina, omar);
    await save(other, yusuf);
    // Make the order unambiguous: Omar was saved after Layla.
    await asSystem(db.pool, (client) =>
      client.query(
        `UPDATE saved_profiles SET created_at = now() - interval '1 day' WHERE saver_id = $1 AND saved_id = $2`,
        [amina, layla],
      ),
    );

    const mine = await getSaved(await cookieFor(amina));
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(2);
    expect(mine.body.items.map((e: { id: string }) => e.id)).toEqual([omar, layla]);
    // Directory cards: names and the mentorship line, never contact or exact years.
    expect(mine.body.items[0]).toMatchObject({ firstName: "Omar", lastName: "Siddiqui", mentorStatus: "active", hasCapacity: true });
    const keys = Object.keys(mine.body.items[0]);
    for (const banned of ["email", "phone", "linkedinUrl", "yearsExperience", "contactEmail", "maxActive"]) {
      expect(keys).not.toContain(banned);
    }

    const theirs = await getSaved(await cookieFor(other));
    expect(theirs.body.items.map((e: { id: string }) => e.id)).toEqual([yusuf]);
  });

  it("saved_pages_with_page_and_size", async () => {
    const amina = await makeStudent(db.pool);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await makeMentor(db.pool, { lastName: `Mentor ${i}` });
      await save(amina, id);
      ids.push(id);
    }
    const cookie = await cookieFor(amina);
    const first = await getSaved(cookie, "?page=1&size=2");
    const second = await getSaved(cookie, "?page=2&size=2");
    expect(first.body.total).toBe(3);
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    const seen = [...first.body.items, ...second.body.items].map((e: { id: string }) => e.id).sort();
    expect(seen).toEqual([...ids].sort());

    expect((await getSaved(cookie, "?size=51")).status).toBe(400);
  });

  it("saved_omits_profiles_no_longer_listed", async () => {
    const amina = await makeStudent(db.pool);
    const listed = await makeMentor(db.pool);
    const hidden = await makeMentor(db.pool);
    await save(amina, listed);
    await save(amina, hidden);
    // An open request makes Amina a counterparty, so the row policies still
    // let her read the hidden profile; the list must still leave it out.
    await sendRequest(db.pool, amina, hidden);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET visibility = 'hidden' WHERE id = $1", [hidden]),
    );

    const mine = await getSaved(await cookieFor(amina));
    expect(mine.body.items.map((e: { id: string }) => e.id)).toEqual([listed]);
    expect(mine.body.total).toBe(1);
  });

  it("saved_requires_sign_in", async () => {
    const visitor = await getSaved(null);
    expect(visitor.status).toBe(401);
    expect(visitor.body).toEqual({ code: "unauthenticated" });
  });
});
