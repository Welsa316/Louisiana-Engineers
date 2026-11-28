import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminReviewDetail, AdminRole } from "@shared/types/admin";
import type { Paged } from "@shared/types/common";
import type { AdminRequestItem } from "@shared/types/reports";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminRoutes } from "../../src/routes/admin";
import { createAdminReportRoutes } from "../../src/routes/reports";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload } from "../policies/fixtures";
import { makeMentor, makeStudent, sendRequest } from "../policies/request-fixtures";

/**
 * A chapter administrator through the API (Task 39, migration 0023): a
 * review outside its region answers 404, the requests list holds only
 * requests with a party in its region, the settings answer out_of_region,
 * and the administrators list still names every administrator.
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
  await db.pool.query("DELETE FROM regions WHERE id <> 'greater-new-orleans'");
  await db.pool.query("UPDATE config SET value = 'false' WHERE key = 'platform_paused'");
});

const ORIGIN = "http://127.0.0.1:8787";
const BR = "baton-rouge";

const app = testApp(new Hono().route("/admin", new Hono().route("/", createAdminReportRoutes()).route("/", adminRoutes)));

async function call(who: string, method: string, path: string, body?: unknown): Promise<Response> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), who, null));
  const headers: Record<string, string> = { origin: ORIGIN, cookie: `mest_session=${session.value}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

async function admins() {
  await db.pool.query("INSERT INTO regions (id, label, sort_order) VALUES ($1, 'Greater Baton Rouge', 2)", [BR]);
  const global = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gia" });
  await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gus" });
  const chapter = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden", firstName: "Cara" });
  return { global, chapter };
}

describe("a chapter administrator through the API", () => {
  it("review_outside_the_region_answers_not_found", async () => {
    const { global, chapter } = await admins();
    const nolaPending = await newAccount(db.pool);
    await onboard(db.pool, nolaPending, professionalPayload());
    const brPending = await newAccount(db.pool);
    await onboard(db.pool, brPending, professionalPayload({ region: BR }));
    const reviewOf = async (profile: string) =>
      (await db.pool.query<{ id: string }>("SELECT id FROM profile_reviews WHERE profile_id = $1", [profile])).rows[0].id;

    const outside = await call(chapter, "GET", `/admin/reviews/${await reviewOf(nolaPending)}`);
    expect(outside.status).toBe(404);
    expect(await outside.json()).toEqual({ code: "not_found" });
    const inside = await json<AdminReviewDetail>(await call(chapter, "GET", `/admin/reviews/${await reviewOf(brPending)}`));
    expect(inside.profileId).toBe(brPending);
    const wide = await json<AdminReviewDetail>(await call(global, "GET", `/admin/reviews/${await reviewOf(nolaPending)}`));
    expect(wide.profileId).toBe(nolaPending);
  });

  it("requests_list_holds_only_requests_with_a_party_in_the_region", async () => {
    const { global, chapter } = await admins();
    const mentor = await makeMentor(db.pool);
    const nolaStudent = await makeStudent(db.pool);
    const brStudent = await makeStudent(db.pool, { region: BR });
    const inNola = await sendRequest(db.pool, nolaStudent, mentor);
    const across = await sendRequest(db.pool, brStudent, mentor);

    const mine = await json<Paged<AdminRequestItem>>(await call(chapter, "GET", "/admin/requests"));
    expect(mine.items.map((r) => r.id)).toEqual([across]);
    expect(mine.total).toBe(1);
    const filtered = await json<Paged<AdminRequestItem>>(await call(chapter, "GET", `/admin/requests?profile=${nolaStudent}`));
    expect(filtered).toEqual({ items: [], total: 0 });
    const all = await json<Paged<AdminRequestItem>>(await call(global, "GET", "/admin/requests"));
    expect(all.items.map((r) => r.id).sort()).toEqual([inNola, across].sort());
  });

  it("settings_and_vocabulary_answer_out_of_region", async () => {
    const { global, chapter } = await admins();
    for (const [method, path, body] of [
      ["PATCH", "/admin/config", { pending_cap: 4 }],
      ["POST", "/admin/vocabulary", { kind: "topic", id: "flood-risk", label: "Flood risk" }],
      ["POST", "/admin/topics/professional-licensure/retire", undefined],
    ] as const) {
      const res = await call(chapter, method, path, body);
      expect(res.status, path).toBe(409);
      expect(await res.json()).toEqual({ code: "out_of_region" });
    }
    await json(await call(global, "PATCH", "/admin/config", { pending_cap: 4 }));
    await json(await call(global, "POST", "/admin/vocabulary", { kind: "topic", id: "flood-risk", label: "Flood risk" }));
  });

  it("administrators_list_names_every_administrator", async () => {
    const { chapter } = await admins();
    const list = await json<Paged<AdminRole>>(await call(chapter, "GET", "/admin/admins"));
    expect(list.total).toBe(3);
    expect(list.items.map((a) => a.firstName).sort()).toEqual(["Cara", "Gia", "Gus"]);
  });
});
