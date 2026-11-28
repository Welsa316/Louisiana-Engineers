import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminMember, AdminReviewItem, AdminRole } from "@shared/types/admin";
import type { Paged } from "@shared/types/common";
import type { DirectoryResponse } from "@shared/types/directory";
import type { AdminReport } from "@shared/types/reports";
import type { PublicVocabulary } from "@shared/types/vocabulary";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminRoutes } from "../../src/routes/admin";
import { createConfigRoutes } from "../../src/routes/config";
import { createDirectoryRoutes } from "../../src/routes/directory";
import { createMeRoutes } from "../../src/routes/me";
import { createAdminReportRoutes } from "../../src/routes/reports";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, scalarAs } from "../policies/fixtures";

/**
 * Regions through the API (Task 38): the regions in
 * `GET /api/config/vocabulary`, the directory's region filter, a member
 * choosing a region, and the administration lists and grant screen for a
 * chapter administrator scoped to one region.
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
const NOLA = "greater-new-orleans";
const BR = "baton-rouge";

const app = testApp(
  new Hono()
    .route("/config", createConfigRoutes({}))
    .route("/directory", createDirectoryRoutes())
    .route("/me", createMeRoutes())
    .route("/admin", new Hono().route("/", createAdminReportRoutes()).route("/", adminRoutes)),
);

async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function call(who: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (who) headers.cookie = await cookieFor(who);
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

async function addRegion(id: string, label: string, active = true, sort = 2): Promise<void> {
  await db.pool.query("INSERT INTO regions (id, label, sort_order, active) VALUES ($1, $2, $3, $4)", [id, label, sort, active]);
}

describe("regions in the vocabulary", () => {
  it("vocabulary_lists_active_regions_in_order", async () => {
    const before = await json<PublicVocabulary>(await call(null, "GET", "/config/vocabulary"));
    expect(before.regions).toEqual([{ id: NOLA, label: "Greater New Orleans" }]);
    expect(before.topics.length).toBeGreaterThan(0);

    await addRegion(BR, "Greater Baton Rouge");
    await addRegion("acadiana", "Acadiana", false, 3);
    const after = await json<PublicVocabulary>(await call(null, "GET", "/config/vocabulary"));
    expect(after.regions).toEqual([
      { id: NOLA, label: "Greater New Orleans" },
      { id: BR, label: "Greater Baton Rouge" },
    ]);
  });
});

describe("a member's region", () => {
  it("profile_patch_moves_to_an_active_region_and_refuses_another", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    await addRegion("acadiana", "Acadiana", false, 3);
    const pro = await newAccount(db.pool);
    await onboard(db.pool, pro, professionalPayload());

    const refused = await call(pro, "PATCH", "/me/profile", { region: "acadiana" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ code: "invalid_region" });

    const moved = await json<{ region: string }>(await call(pro, "PATCH", "/me/profile", { region: BR }));
    expect(moved.region).toBe(BR);
  });
});

describe("the directory's region filter", () => {
  it("directory_filters_by_region", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    const nola = await makePerson(db.pool, { firstName: "Nola" });
    const br = await makePerson(db.pool, { region: BR, firstName: "Baton" });

    const all = await json<DirectoryResponse>(await call(null, "GET", "/directory"));
    expect(all.items.map((i) => i.id).sort()).toEqual([nola, br].sort());
    const inBr = await json<DirectoryResponse>(await call(null, "GET", `/directory?region=${BR}`));
    expect(inBr.items.map((i) => i.id)).toEqual([br]);
    expect(inBr.total).toBe(1);
    expect(inBr.facets.disciplines).toEqual([{ id: "civil", count: 1 }]);
    const none = await json<DirectoryResponse>(await call(null, "GET", "/directory?region=atlantis"));
    expect(none.items).toEqual([]);

    expect((await call(null, "GET", "/directory?region=Not%20a%20slug")).status).toBe(400);
  });
});

describe("chapter administrators in the administration area", () => {
  async function chapters() {
    await addRegion(BR, "Greater Baton Rouge");
    const global = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gia", lastName: "Global" });
    const global2 = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gus", lastName: "Global" });
    const chapter = await makePerson(db.pool, {
      admin: true,
      adminRegion: BR,
      region: BR,
      visibility: "hidden",
      firstName: "Cara",
      lastName: "Chapter",
    });
    return { global, global2, chapter };
  }

  it("admins_list_shows_each_scope_and_grant_takes_one", async () => {
    const { global, chapter } = await chapters();
    const brMember = await makePerson(db.pool, { region: BR, kind: "student", visibility: "hidden", firstName: "Bo" });

    const list = await json<Paged<AdminRole>>(await call(chapter, "GET", "/admin/admins"));
    const byName = Object.fromEntries(list.items.map((a) => [a.firstName, a]));
    expect(byName.Gia).toMatchObject({ regionId: null, regionLabel: null });
    expect(byName.Cara).toMatchObject({ regionId: BR, regionLabel: "Greater Baton Rouge", isSelf: true });

    // A chapter administrator grants its own region; every region is refused.
    const wide = await call(chapter, "POST", "/admin/admins", { profileId: brMember });
    expect(wide.status).toBe(409);
    expect(await wide.json()).toEqual({ code: "out_of_region" });
    await json(await call(chapter, "POST", "/admin/admins", { profileId: brMember, regionId: BR }));
    expect(await scalarAs(db.pool, brMember, "SELECT is_admin_for($1) AS value", [BR])).toBe(true);

    // An administrator for every region widens it (null is every region).
    await json(await call(global, "POST", "/admin/admins", { profileId: brMember, regionId: null }));
    expect(await scalarAs(db.pool, brMember, "SELECT is_admin_for($1) AS value", [NOLA])).toBe(true);

    const bad = await call(global, "POST", "/admin/admins", { profileId: brMember, regionId: "Not a slug" });
    expect(bad.status).toBe(400);
  });

  it("chapter_admin_lists_only_its_region", async () => {
    const { global, chapter } = await chapters();
    const nolaPending = await newAccount(db.pool);
    await onboard(db.pool, nolaPending, professionalPayload({ firstName: "Nora" }));
    const brPending = await newAccount(db.pool);
    await onboard(db.pool, brPending, professionalPayload({ firstName: "Bree", region: BR }));
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const nolaPro = await makePerson(db.pool, { firstName: "Nolan" });
    const brPro = await makePerson(db.pool, { firstName: "Brett", region: BR });
    for (const target of [nolaPro, brPro]) {
      await scalarAs(db.pool, reporter, "SELECT report_profile($1, 'spam', 'Selling courses.') AS value", [target]);
    }

    const reviews = await json<Paged<AdminReviewItem>>(await call(chapter, "GET", "/admin/reviews?status=pending"));
    expect(reviews.items.map((r) => r.profileId)).toEqual([brPending]);
    expect(reviews.total).toBe(1);
    const allReviews = await json<Paged<AdminReviewItem>>(await call(global, "GET", "/admin/reviews?status=pending"));
    expect(allReviews.total).toBe(2);

    const members = await json<Paged<AdminMember>>(await call(chapter, "GET", "/admin/members?size=50"));
    expect(members.items.every((m) => m.region === BR)).toBe(true);
    expect(members.items.map((m) => m.id).sort()).toEqual([chapter, brPending, brPro].sort());

    const reports = await json<Paged<AdminReport>>(await call(chapter, "GET", "/admin/reports?status=open"));
    expect(reports.items.map((r) => r.profile.id)).toEqual([brPro]);
    expect(reports.total).toBe(1);
    const allReports = await json<Paged<AdminReport>>(await call(global, "GET", "/admin/reports?status=open"));
    expect(allReports.total).toBe(2);

    // Acting outside the region answers out_of_region.
    const hide = await call(chapter, "POST", `/admin/profiles/${nolaPro}/hide`);
    expect(hide.status).toBe(409);
    expect(await hide.json()).toEqual({ code: "out_of_region" });
  });
});
