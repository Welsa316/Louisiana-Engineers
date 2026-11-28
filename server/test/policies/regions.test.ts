import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminPhoto } from "@shared/types/photos";
import type { Paged } from "@shared/types/common";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { adminPhotoRoutes } from "../../src/routes/photos";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs, scalarAs } from "./fixtures";

/**
 * Regions and chapter administrators (Phase 4, migration 0020): the
 * `regions` vocabulary behind `profiles.region`, `admin_roles.region_id`
 * (null means every region), `is_admin_for(region)`, and every
 * administrator function that acts on a profile checking the profile's
 * region against the caller's scope.
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
});

const NOLA = "greater-new-orleans";
const BR = "baton-rouge";

async function addRegion(id: string, label: string, active = true): Promise<void> {
  await db.pool.query("INSERT INTO regions (id, label, sort_order, active) VALUES ($1, $2, 2, $3)", [id, label, active]);
}

/**
 * Two administrators for every region (the minimum stays satisfied), one
 * chapter administrator for Baton Rouge, and one listed professional in each
 * region.
 */
async function chapters() {
  await addRegion(BR, "Greater Baton Rouge");
  const global = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gia" });
  const global2 = await makePerson(db.pool, { admin: true, visibility: "hidden", firstName: "Gus" });
  const chapter = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden", firstName: "Cara" });
  const nolaPro = await makePerson(db.pool, { firstName: "Nola" });
  const brPro = await makePerson(db.pool, { region: BR, firstName: "Baton" });
  return { global, global2, chapter, nolaPro, brPro };
}

describe("regions", () => {
  it("regions_seeded_and_readable_by_everyone_written_by_no_one", async () => {
    const rows = await rowsAs<{ id: string; label: string; active: boolean }>(
      db.pool,
      null,
      "SELECT id, label, active FROM regions ORDER BY sort_order, id",
    );
    expect(rows).toEqual([{ id: NOLA, label: "Greater New Orleans", active: true }]);

    const member = await makePerson(db.pool);
    await expect(runAs(db.pool, member, "INSERT INTO regions (id, label) VALUES ('x-region', 'X region')")).rejects.toThrow(
      /permission denied/,
    );
    const admin = await makePerson(db.pool, { admin: true });
    await expect(runAs(db.pool, admin, "UPDATE regions SET label = 'Renamed'")).rejects.toThrow(/permission denied/);
  });

  it("profile_region_must_be_an_active_region", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    await addRegion("acadiana", "Acadiana", false);
    const member = await makePerson(db.pool);

    // Unknown and inactive regions are refused, whoever writes them.
    await expect(runAs(db.pool, member, "UPDATE profiles SET region = 'atlantis' WHERE id = app_uid()")).rejects.toThrow(
      /mest\.invalid_region/,
    );
    await expect(runAs(db.pool, member, "UPDATE profiles SET region = 'acadiana' WHERE id = app_uid()")).rejects.toThrow(
      /mest\.invalid_region/,
    );
    await expect(makePerson(db.pool, { region: "acadiana" })).rejects.toThrow(/mest\.invalid_region/);

    await runAs(db.pool, member, "UPDATE profiles SET region = $1 WHERE id = app_uid()", [BR]);
    expect(await scalarAs(db.pool, member, "SELECT region AS value FROM profiles WHERE id = app_uid()")).toBe(BR);

    // A profile already in a region that was later retired keeps it and can
    // still edit everything else.
    await db.pool.query("UPDATE regions SET active = false WHERE id = $1", [BR]);
    await runAs(db.pool, member, "UPDATE profiles SET location = 'Baton Rouge, LA' WHERE id = app_uid()");
    await runAs(db.pool, member, "UPDATE profiles SET region = region, location = 'Zachary, LA' WHERE id = app_uid()");
    expect(await scalarAs(db.pool, member, "SELECT region AS value FROM profiles WHERE id = app_uid()")).toBe(BR);
  });

  it("onboarding_takes_an_active_region_and_refuses_another", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    const pro = await newAccount(db.pool);
    await expect(onboard(db.pool, pro, professionalPayload({ region: "atlantis" }))).rejects.toThrow(/mest\.invalid_region/);
    await onboard(db.pool, pro, professionalPayload({ region: BR }));
    expect(await scalarAs(db.pool, pro, "SELECT region AS value FROM profiles WHERE id = app_uid()")).toBe(BR);

    // Without a region the default stands.
    const other = await newAccount(db.pool);
    await onboard(db.pool, other, professionalPayload());
    expect(await scalarAs(db.pool, other, "SELECT region AS value FROM profiles WHERE id = app_uid()")).toBe(NOLA);
  });
});

describe("chapter administrators", () => {
  it("is_admin_for_scopes_by_region", async () => {
    const { global, chapter, nolaPro } = await chapters();
    const isAdminFor = (who: string | null, region: string | null) =>
      scalarAs<boolean>(db.pool, who, "SELECT is_admin_for($1) AS value", [region]);

    expect(await isAdminFor(global, NOLA)).toBe(true);
    expect(await isAdminFor(global, BR)).toBe(true);
    expect(await isAdminFor(global, null)).toBe(true);
    expect(await isAdminFor(chapter, BR)).toBe(true);
    expect(await isAdminFor(chapter, NOLA)).toBe(false);
    // Null asks "every region", which a chapter administrator is not.
    expect(await isAdminFor(chapter, null)).toBe(false);
    expect(await isAdminFor(nolaPro, NOLA)).toBe(false);
    expect(await isAdminFor(null, NOLA)).toBe(false);
    // is_admin() itself is unchanged: a chapter administrator is an administrator.
    expect(await scalarAs(db.pool, chapter, "SELECT is_admin() AS value")).toBe(true);

    // A revoked or suspended chapter administrator is no longer one anywhere.
    await db.pool.query("UPDATE users SET suspended_at = now() WHERE id = $1", [chapter]);
    expect(await isAdminFor(chapter, BR)).toBe(false);
  });

  it("chapter_admin_acts_only_on_profiles_in_its_region", async () => {
    const { chapter, nolaPro, brPro } = await chapters();

    for (const sql of [
      "SELECT admin_hide_profile($1)",
      "SELECT admin_restore_profile($1)",
      "SELECT admin_set_verified($1, 'personal_knowledge')",
      "SELECT admin_member_domain($1)",
    ]) {
      await expect(runAs(db.pool, chapter, sql, [nolaPro]), sql).rejects.toThrow(/mest\.out_of_region/);
    }
    const nola = await db.pool.query("SELECT admin_hidden_at FROM profiles WHERE id = $1", [nolaPro]);
    expect(nola.rows[0].admin_hidden_at).toBeNull();

    await runAs(db.pool, chapter, "SELECT admin_hide_profile($1)", [brPro]);
    await runAs(db.pool, chapter, "SELECT admin_set_verified($1, 'personal_knowledge')", [brPro]);
    expect(await scalarAs(db.pool, chapter, "SELECT admin_member_domain($1) AS value", [brPro])).toBe("example.test");
    await runAs(db.pool, chapter, "SELECT admin_restore_profile($1)", [brPro]);
    const br = await db.pool.query<{ hidden: boolean; verified: boolean }>(
      `SELECT p.admin_hidden_at IS NOT NULL AS hidden, d.verified
         FROM profiles p JOIN professional_details d ON d.profile_id = p.id WHERE p.id = $1`,
      [brPro],
    );
    expect(br.rows[0]).toEqual({ hidden: false, verified: true });
    const actions = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE actor_id = $1 ORDER BY id",
      [chapter],
    );
    expect(actions.rows.map((r) => r.action)).toEqual(["profile.hidden", "profile.verified", "profile.restored"]);
  });

  it("chapter_admin_reviews_only_its_regions_queue", async () => {
    const { global, chapter } = await chapters();
    const nolaPending = await newAccount(db.pool);
    await onboard(db.pool, nolaPending, professionalPayload());
    const brPending = await newAccount(db.pool);
    await onboard(db.pool, brPending, professionalPayload({ region: BR }));
    const reviewOf = async (profile: string) =>
      (await db.pool.query<{ id: string }>("SELECT id FROM profile_reviews WHERE profile_id = $1", [profile])).rows[0].id;

    await expect(
      runAs(db.pool, chapter, "SELECT admin_review_profile($1, 'approved', null)", [await reviewOf(nolaPending)]),
    ).rejects.toThrow(/mest\.out_of_region/);
    await runAs(db.pool, chapter, "SELECT admin_review_profile($1, 'approved', null)", [await reviewOf(brPending)]);
    await runAs(db.pool, global, "SELECT admin_review_profile($1, 'approved', null)", [await reviewOf(nolaPending)]);
    const states = await db.pool.query<{ id: string; approval_state: string }>(
      "SELECT id, approval_state FROM profiles WHERE id = ANY ($1::uuid[])",
      [[nolaPending, brPending]],
    );
    expect(states.rows.every((r) => r.approval_state === "approved")).toBe(true);
  });

  it("chapter_admin_resolves_only_reports_on_its_region", async () => {
    const { chapter, nolaPro, brPro } = await chapters();
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const report = (profile: string) =>
      scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'spam', 'Selling courses.') AS value", [profile]);
    const onNola = await report(nolaPro);
    const onBr = await report(brPro);

    // Refused before any action runs, so dismissing is refused as well.
    await expect(
      runAs(db.pool, chapter, "SELECT admin_resolve_report($1, 'resolved', null, 'hide_profile')", [onNola]),
    ).rejects.toThrow(/mest\.out_of_region/);
    await expect(
      runAs(db.pool, chapter, "SELECT admin_resolve_report($1, 'dismissed', null, 'none')", [onNola]),
    ).rejects.toThrow(/mest\.out_of_region/);
    await runAs(db.pool, chapter, "SELECT admin_resolve_report($1, 'resolved', null, 'hide_profile')", [onBr]);
    const hidden = await db.pool.query<{ id: string }>(
      "SELECT id FROM profiles WHERE admin_hidden_at IS NOT NULL ORDER BY id",
    );
    expect(hidden.rows.map((r) => r.id)).toEqual([brPro]);
    const open = await db.pool.query<{ id: string }>("SELECT id FROM reports WHERE status = 'open'");
    expect(open.rows.map((r) => r.id)).toEqual([onNola]);
  });

  it("chapter_admin_direct_updates_stop_at_its_region", async () => {
    const { chapter, nolaPro, brPro } = await chapters();
    // The administrator update policies follow the scope too, so a direct
    // UPDATE outside the region touches no row.
    const touched = await asUser(db.pool, chapter, async (client) => {
      const a = await client.query("UPDATE profiles SET location = 'Changed, LA' WHERE id = $1", [nolaPro]);
      const b = await client.query("UPDATE professional_details SET title = 'Changed' WHERE profile_id = $1", [nolaPro]);
      const c = await client.query("UPDATE profiles SET location = 'Baker, LA' WHERE id = $1", [brPro]);
      return [a.rowCount, b.rowCount, c.rowCount];
    });
    expect(touched).toEqual([0, 0, 1]);
    // Nor can it move a profile out of its region.
    await expect(runAs(db.pool, chapter, "UPDATE profiles SET region = $2 WHERE id = $1", [brPro, NOLA])).rejects.toThrow(
      /row-level security/,
    );
  });

  it("chapter_admin_lists_only_members_of_its_region", async () => {
    const { global, global2, chapter, nolaPro, brPro } = await chapters();
    const listed = async (who: string, region: string | null = null) =>
      (
        await rowsAs<{ id: string; total: number }>(
          db.pool,
          who,
          "SELECT id, total FROM admin_list_members(1, 50, null, null, null, null, null, $1)",
          [region],
        )
      )
        .map((r) => r.id)
        .sort();

    expect(await listed(chapter)).toEqual([chapter, brPro].sort());
    expect(await listed(chapter, NOLA)).toEqual([]);
    expect(await listed(global)).toEqual([global, global2, chapter, nolaPro, brPro].sort());
    expect(await listed(global, BR)).toEqual([chapter, brPro].sort());
  });

  it("grant_chooses_a_scope_within_the_callers_own", async () => {
    const { global, chapter, nolaPro, brPro } = await chapters();
    const brStudent = await makePerson(db.pool, { kind: "student", region: BR, visibility: "hidden" });
    const scope = async (who: string) =>
      (await db.pool.query<{ region_id: string | null }>(
        "SELECT region_id FROM admin_roles WHERE profile_id = $1 AND revoked_at IS NULL",
        [who],
      )).rows[0]?.region_id;

    // A chapter administrator grants its own region only, and only to members in it.
    await expect(runAs(db.pool, chapter, "SELECT admin_grant($1)", [brPro])).rejects.toThrow(/mest\.out_of_region/);
    await expect(runAs(db.pool, chapter, "SELECT admin_grant($1, $2)", [brPro, NOLA])).rejects.toThrow(/mest\.out_of_region/);
    await expect(runAs(db.pool, chapter, "SELECT admin_grant($1, $2)", [nolaPro, BR])).rejects.toThrow(/mest\.out_of_region/);
    await runAs(db.pool, chapter, "SELECT admin_grant($1, $2)", [brPro, BR]);
    expect(await scope(brPro)).toBe(BR);
    expect(await scalarAs(db.pool, brPro, "SELECT is_admin_for($1) AS value", [NOLA])).toBe(false);

    // An unknown region is refused.
    await expect(runAs(db.pool, global, "SELECT admin_grant($1, 'atlantis')", [nolaPro])).rejects.toThrow(
      /mest\.invalid_region/,
    );

    // An administrator for every region grants any scope, and changes one.
    await runAs(db.pool, global, "SELECT admin_grant($1, $2)", [brStudent, BR]);
    expect(await scope(brStudent)).toBe(BR);
    await runAs(db.pool, global, "SELECT admin_grant($1)", [brStudent]);
    expect(await scope(brStudent)).toBeNull();
    // A chapter administrator cannot narrow (or touch) a wider role.
    await expect(runAs(db.pool, chapter, "SELECT admin_grant($1, $2)", [brStudent, BR])).rejects.toThrow(
      /mest\.out_of_region/,
    );

    const audit = await db.pool.query<{ subject_id: string; detail: { region: string | null } }>(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'admin.granted' ORDER BY id",
    );
    expect(audit.rows.map((r) => [r.subject_id, r.detail.region])).toEqual([
      [brPro, BR],
      [brStudent, BR],
      [brStudent, null],
    ]);
  });

  it("chapter_admin_cannot_revoke_a_wider_or_other_region_role", async () => {
    const { global, global2, chapter } = await chapters();
    await addRegion("acadiana", "Acadiana");
    const brAdmin = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });
    const otherAdmin = await makePerson(db.pool, { admin: true, adminRegion: "acadiana", region: BR, visibility: "hidden" });

    await expect(runAs(db.pool, chapter, "SELECT admin_revoke($1)", [global])).rejects.toThrow(/mest\.out_of_region/);
    await expect(runAs(db.pool, chapter, "SELECT admin_revoke($1)", [otherAdmin])).rejects.toThrow(/mest\.out_of_region/);
    await runAs(db.pool, chapter, "SELECT admin_revoke($1)", [brAdmin]);
    await runAs(db.pool, global, "SELECT admin_revoke($1)", [otherAdmin]);
    const active = await db.pool.query<{ profile_id: string }>(
      "SELECT profile_id FROM admin_roles WHERE revoked_at IS NULL ORDER BY profile_id",
    );
    expect(active.rows.map((r) => r.profile_id)).toEqual([global, global2, chapter].sort());
  });

  it("the_last_administrator_for_every_region_stays", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    const global = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const chapterA = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });
    const chapterB = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });

    // Three administrators can act, but only one of them everywhere: that
    // one can be neither revoked nor narrowed to a region.
    await expect(runAs(db.pool, chapterA, "SELECT admin_revoke($1)", [global])).rejects.toThrow(/mest\.out_of_region/);
    await expect(runAs(db.pool, global, "SELECT admin_revoke($1)", [global])).rejects.toThrow(/mest\.last_global_admin/);
    await expect(runAs(db.pool, global, "SELECT admin_grant($1, $2)", [global, BR])).rejects.toThrow(
      /mest\.last_global_admin/,
    );

    // With a second one for every region, the first can be narrowed.
    await runAs(db.pool, global, "SELECT admin_grant($1)", [chapterB]);
    await runAs(db.pool, global, "SELECT admin_grant($1, $2)", [global, BR]);
    const scopes = await db.pool.query<{ profile_id: string; region_id: string | null }>(
      "SELECT profile_id, region_id FROM admin_roles WHERE revoked_at IS NULL",
    );
    expect(Object.fromEntries(scopes.rows.map((r) => [r.profile_id, r.region_id]))).toEqual({
      [global]: BR,
      [chapterA]: BR,
      [chapterB]: null,
    });
  });
});

describe("wider administrators", () => {
  it("chapter_admin_cannot_sanction_a_wider_administrator_in_its_region", async () => {
    // A region-wide administrator's own profile sits in a region; a chapter
    // administrator for that region covers the profile but not the role.
    const { global, global2 } = await chapters();
    const nolaChapter = await makePerson(db.pool, { admin: true, adminRegion: NOLA, visibility: "hidden", firstName: "Nora" });
    const nolaPeer = await makePerson(db.pool, { admin: true, adminRegion: NOLA, firstName: "Nell" });
    // Listed, so a member can report the profile.
    await db.pool.query("UPDATE profiles SET visibility = 'public' WHERE id = $1", [global]);
    const reporter = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const report = (profile: string) =>
      scalarAs<string>(db.pool, reporter, "SELECT report_profile($1, 'spam', 'Selling courses.') AS value", [profile]);
    const onGlobal = await report(global);

    for (const action of ["suspend_requests", "remove_account", "hide_profile"]) {
      await expect(
        runAs(db.pool, nolaChapter, "SELECT admin_resolve_report($1, 'resolved', null, $2)", [onGlobal, action]),
        action,
      ).rejects.toThrow(/mest\.out_of_region/);
    }
    for (const sql of ["SELECT admin_hide_profile($1)", "SELECT admin_restore_profile($1)"]) {
      await expect(runAs(db.pool, nolaChapter, sql, [global]), sql).rejects.toThrow(/mest\.out_of_region/);
    }

    const state = await db.pool.query<{ suspended: boolean; hidden: boolean; leaving: boolean }>(
      `SELECT u.suspended_at IS NOT NULL AS suspended, p.admin_hidden_at IS NOT NULL AS hidden,
              EXISTS (SELECT 1 FROM account_deletions d WHERE d.profile_id = u.id) AS leaving
         FROM users u JOIN profiles p ON p.id = u.id WHERE u.id = $1`,
      [global],
    );
    expect(state.rows[0]).toEqual({ suspended: false, hidden: false, leaving: false });
    expect((await db.pool.query("SELECT acting_global_admin_count(NULL) AS n")).rows[0].n).toBe(2);
    expect((await db.pool.query("SELECT status FROM reports WHERE id = $1", [onGlobal])).rows[0].status).toBe("open");

    // The same chapter administrator still decides a report on a peer with
    // the same scope, and a region-wide one decides the report on the other.
    const onPeer = await report(nolaPeer);
    await runAs(db.pool, nolaChapter, "SELECT admin_resolve_report($1, 'resolved', null, 'suspend_requests')", [onPeer]);
    await runAs(db.pool, global2, "SELECT admin_resolve_report($1, 'resolved', null, 'hide_profile')", [onGlobal]);
    const suspended = await db.pool.query<{ id: string }>("SELECT id FROM users WHERE suspended_at IS NOT NULL");
    expect(suspended.rows.map((r) => r.id)).toEqual([nolaPeer]);
    const hidden = await db.pool.query<{ id: string }>("SELECT id FROM profiles WHERE admin_hidden_at IS NOT NULL");
    expect(hidden.rows.map((r) => r.id)).toEqual([global]);
  });

  it("the_last_administrator_for_every_region_cannot_leave", async () => {
    await addRegion(BR, "Greater Baton Rouge");
    const global = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const chapterA = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });
    const chapterB = await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });
    await makePerson(db.pool, { admin: true, adminRegion: BR, region: BR, visibility: "hidden" });

    // Three others can act, so the two-administrator minimum holds, but
    // none acts for every region.
    await expect(runAs(db.pool, global, "SELECT request_account_deletion(false, null)")).rejects.toThrow(
      /mest\.last_global_admin/,
    );
    expect((await db.pool.query("SELECT 1 FROM account_deletions")).rowCount).toBe(0);
    // A chapter administrator may still leave.
    await runAs(db.pool, chapterA, "SELECT request_account_deletion(false, null)");

    // Once another administrator acts for every region, the first may leave.
    await runAs(db.pool, global, "SELECT admin_grant($1)", [chapterB]);
    await runAs(db.pool, global, "SELECT request_account_deletion(false, null)");
    const leaving = await db.pool.query<{ profile_id: string }>("SELECT profile_id FROM account_deletions");
    expect(leaving.rows.map((r) => r.profile_id).sort()).toEqual([global, chapterA].sort());
  });
});

describe("photo moderation", () => {
  const ORIGIN = "http://127.0.0.1:8787";
  const app = testApp(new Hono().route("/admin", adminPhotoRoutes));

  async function cookieFor(userId: string): Promise<string> {
    return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
  }

  async function call(cookie: string, method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, cookie: `mest_session=${cookie}` };
    if (json !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(`/api${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text();
    return { status: res.status, body: text && res.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(text) : null };
  }

  /** A photo row for `profile`, written as the owner: pending, or already approved. */
  async function photoOf(profile: string, status: "pending" | "approved"): Promise<string> {
    const image = Buffer.alloc(512, 7);
    image.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const row = await db.pool.query<{ id: string }>(
      `INSERT INTO profile_photos (profile_id, image, content_type, byte_size, status, reviewed_at)
       VALUES ($1, $2, 'image/jpeg', $3, $4::photo_status, CASE WHEN $4 = 'pending' THEN NULL ELSE now() END)
       RETURNING id`,
      [profile, image, image.byteLength, status],
    );
    return row.rows[0].id;
  }

  it("chapter_admin_moderates_only_photos_in_its_region", async () => {
    const { global, chapter, nolaPro, brPro } = await chapters();
    const nolaWaiting = await photoOf(nolaPro, "pending");
    const brWaiting = await photoOf(brPro, "pending");
    const nolaShown = await makePerson(db.pool, { firstName: "Shown" });
    const nolaApproved = await photoOf(nolaShown, "approved");
    const chapterCookie = await cookieFor(chapter);
    const globalCookie = await cookieFor(global);
    const listed = async (cookie: string, status: string) => {
      const res = await call(cookie, "GET", `/admin/photos?status=${status}`);
      expect(res.status).toBe(200);
      const body = res.body as Paged<AdminPhoto>;
      return { ids: body.items.map((i) => i.id).sort(), total: body.total };
    };

    // The queue and the decided tabs hold only the chapter's own region,
    // including an approved photo the policy would show any member.
    expect(await listed(chapterCookie, "pending")).toEqual({ ids: [brWaiting], total: 1 });
    expect(await listed(chapterCookie, "approved")).toEqual({ ids: [], total: 0 });
    // Past the last page the count still leaves the other region out.
    expect((await call(chapterCookie, "GET", "/admin/photos?status=pending&page=2")).body.total).toBe(1);

    // Another region's image is not found, waiting or approved.
    expect((await call(chapterCookie, "GET", `/admin/photos/${nolaWaiting}/image`)).status).toBe(404);
    expect((await call(chapterCookie, "GET", `/admin/photos/${nolaApproved}/image`)).status).toBe(404);
    expect((await call(chapterCookie, "GET", `/admin/photos/${brWaiting}/image`)).status).toBe(200);

    // Nor can the chapter administrator decide it, either way.
    for (const decision of ["approved", "rejected"]) {
      const res = await call(chapterCookie, "POST", `/admin/photos/${nolaWaiting}`, { decision });
      expect(res.status, decision).toBe(409);
      expect(res.body).toEqual({ code: "out_of_region" });
    }
    const takeDown = await call(chapterCookie, "POST", `/admin/photos/${nolaApproved}`, { decision: "rejected" });
    expect(takeDown.body).toEqual({ code: "out_of_region" });
    await expect(runAs(db.pool, chapter, "SELECT admin_review_photo($1, 'approved')", [nolaWaiting])).rejects.toThrow(
      /mest\.out_of_region/,
    );
    const states = await db.pool.query<{ id: string; status: string }>(
      "SELECT id, status::text AS status FROM profile_photos ORDER BY id",
    );
    expect(Object.fromEntries(states.rows.map((r) => [r.id, r.status]))).toEqual({
      [nolaWaiting]: "pending",
      [brWaiting]: "pending",
      [nolaApproved]: "approved",
    });

    // The read policy itself: another region's waiting photo is not readable.
    const readable = await rowsAs<{ id: string }>(db.pool, chapter, "SELECT id FROM profile_photos ORDER BY id");
    expect(readable.map((r) => r.id).sort()).toEqual([brWaiting, nolaApproved].sort());

    // Its own region's photo it decides as before.
    expect((await call(chapterCookie, "POST", `/admin/photos/${brWaiting}`, { decision: "approved" })).status).toBe(200);

    // An administrator for every region still sees and decides everything.
    expect(await listed(globalCookie, "pending")).toEqual({ ids: [nolaWaiting], total: 1 });
    expect(await listed(globalCookie, "approved")).toEqual({ ids: [brWaiting, nolaApproved].sort(), total: 2 });
    expect((await call(globalCookie, "GET", `/admin/photos/${nolaWaiting}/image`)).status).toBe(200);
    expect((await call(globalCookie, "POST", `/admin/photos/${nolaWaiting}`, { decision: "rejected" })).status).toBe(200);
    const all = await rowsAs<{ id: string }>(db.pool, global, "SELECT id FROM profile_photos");
    expect(all).toHaveLength(3);
  });
});
