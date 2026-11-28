import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { audit } from "../../src/audit";
import { makePerson, scalarAs } from "./fixtures";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  // Config rows are seeded by the migration and kept by truncateAll; put
  // back anything a test changed.
  await asSystem(db.pool, (client) =>
    client.query(
      `UPDATE config SET value = d.value
         FROM (VALUES ('request_expiry_days', '14'::jsonb), ('reminder_days', '[5, 10]'::jsonb),
                      ('pending_cap', '3'::jsonb), ('default_max_active', '3'::jsonb),
                      ('daily_request_limit', '5'::jsonb), ('daily_report_limit', '3'::jsonb),
                      ('magic_links_per_hour', '5'::jsonb), ('platform_paused', 'false'::jsonb),
                      ('retention_months', '24'::jsonb)) AS d(key, value)
        WHERE config.key = d.key`,
    ),
  );
});

const isMember = (viewer: string | null) => scalarAs<boolean>(db.pool, viewer, "SELECT is_member() AS value");
const isAdmin = (viewer: string | null) => scalarAs<boolean>(db.pool, viewer, "SELECT is_admin() AS value");

describe("role helpers", () => {
  it("is_member_false_for_unverified_suspended_or_deleting", async () => {
    const verified = await makePerson(db.pool);
    const notOnboarded = await makePerson(db.pool, { kind: null, approval: "pending" });
    const unverified = await makePerson(db.pool, { verified: false });
    const suspended = await makePerson(db.pool, { suspended: true });
    const deleted = await makePerson(db.pool, { deleted: true });
    const anonymized = await makePerson(db.pool, { anonymized: true });
    const deleting = await makePerson(db.pool);
    const keptAccount = await makePerson(db.pool);
    await asSystem(db.pool, async (client) => {
      await client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'public')`,
        [deleting],
      );
      await client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility, canceled_at)
         VALUES ($1, now() + interval '14 days', 'public', now())`,
        [keptAccount],
      );
    });

    expect(await isMember(verified)).toBe(true);
    expect(await isMember(notOnboarded)).toBe(true);
    expect(await isMember(keptAccount)).toBe(true);

    expect(await isMember(null)).toBe(false);
    expect(await isMember("00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(await isMember(unverified)).toBe(false);
    expect(await isMember(suspended)).toBe(false);
    expect(await isMember(deleted)).toBe(false);
    expect(await isMember(anonymized)).toBe(false);
    expect(await isMember(deleting)).toBe(false);
  });

  it("is_admin_true_only_with_unrevoked_role", async () => {
    const admin = await makePerson(db.pool, { admin: true });
    const revoked = await makePerson(db.pool, { admin: true });
    const member = await makePerson(db.pool);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [revoked]),
    );

    expect(await isAdmin(admin)).toBe(true);
    expect(await isAdmin(revoked)).toBe(false);
    expect(await isAdmin(member)).toBe(false);
    expect(await isAdmin(null)).toBe(false);

    // admin_roles: administrators read every row, a holder reads their own,
    // nobody else reads any, and nobody writes directly.
    const rows = (viewer: string | null) =>
      scalarAs<number>(db.pool, viewer, "SELECT count(*)::int AS value FROM admin_roles");
    expect(await rows(admin)).toBe(2);
    expect(await rows(revoked)).toBe(1);
    expect(await rows(member)).toBe(0);
    expect(await rows(null)).toBe(0);
    await expect(
      asUser(db.pool, member, (client) => client.query("INSERT INTO admin_roles (profile_id) VALUES ($1)", [member])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("audit", () => {
  it("write_audit_strips_private_keys", async () => {
    const actor = await makePerson(db.pool);
    const admin = await makePerson(db.pool, { admin: true });
    const subject = await makePerson(db.pool);
    const detail = {
      email: "layla@example.test",
      phone: "504-555-0100",
      why: "I want to learn levee design",
      goals: "Pass the PE exam",
      scheduling_note: "Weekday evenings",
      mentor_note: "Happy to help",
      field: "visibility",
      before: "public",
      nested: { email: "nested@example.test", keep: 1, deeper: [{ phone: "504-555-0199", ok: true }] },
    };

    // Real callers are SECURITY DEFINER functions (section 4.5); this wrapper
    // stands in for one, so the actor comes from the caller's app.user_id.
    await asSystem(db.pool, (client) =>
      client.query(`
        CREATE OR REPLACE FUNCTION test_definer_audit(subject uuid, detail jsonb) RETURNS bigint
        LANGUAGE sql SECURITY DEFINER SET search_path = public
        AS $$ SELECT write_audit('profile.updated', 'profile', subject, detail) $$;
        GRANT EXECUTE ON FUNCTION test_definer_audit(uuid, jsonb) TO app_user;`),
    );
    await asUser(db.pool, actor, (client) => client.query("SELECT test_definer_audit($1, $2)", [subject, detail]));
    // System context (jobs, the seed) records no actor.
    await asSystem(db.pool, (client) =>
      client.query("SELECT write_audit('request.expired', 'profile', $1, $2)", [subject, { why: "secret", n: 2 }]),
    );
    // The TypeScript helper is a thin caller of the same function, for jobs.
    const id = await asSystem(db.pool, (client) =>
      audit(client, "contact.viewed", "profile", subject, { goals: "secret", method: "email" }),
    );
    expect(typeof id).toBe("string");

    const rows = await asSystem(db.pool, async (client) => {
      const r = await client.query<{ actor_id: string | null; action: string; subject_id: string; detail: unknown }>(
        "SELECT actor_id, action, subject_id, detail FROM audit_log ORDER BY id",
      );
      return r.rows;
    });
    expect(rows).toEqual([
      {
        actor_id: actor,
        action: "profile.updated",
        subject_id: subject,
        detail: { field: "visibility", before: "public", nested: { keep: 1, deeper: [{ ok: true }] } },
      },
      { actor_id: null, action: "request.expired", subject_id: subject, detail: { n: 2 } },
      { actor_id: null, action: "contact.viewed", subject_id: subject, detail: { method: "email" } },
    ]);
    const serialized = JSON.stringify(rows);
    for (const secret of ["example.test", "504-555", "levee", "PE exam", "Weekday", "Happy", "secret"]) {
      expect(serialized).not.toContain(secret);
    }

    // Only administrators read the log, and nobody edits it.
    const count = (viewer: string | null) =>
      scalarAs<number>(db.pool, viewer, "SELECT count(*)::int AS value FROM audit_log");
    expect(await count(admin)).toBe(3);
    expect(await count(actor)).toBe(0);
    expect(await count(null)).toBe(0);
    await expect(
      asUser(db.pool, admin, (client) =>
        client.query("INSERT INTO audit_log (action, subject_type) VALUES ('forged', 'profile')"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, admin, (client) => client.query("DELETE FROM audit_log")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asSystem(db.pool, (client) => client.query("UPDATE audit_log SET action = 'edited'")),
    ).rejects.toThrow(/mest\.audit_append_only/);
  });
});

describe("config", () => {
  const read = (viewer: string | null, key: string) =>
    scalarAs<unknown>(db.pool, viewer, "SELECT value FROM config WHERE key = $1", [key]);

  it("config_seeded_and_readable_by_everyone", async () => {
    const member = await makePerson(db.pool);
    const all = await asUser(db.pool, null, async (client) => {
      const r = await client.query<{ key: string; value: unknown }>("SELECT key, value FROM config ORDER BY key");
      return Object.fromEntries(r.rows.map((row) => [row.key, row.value]));
    });
    expect(all).toEqual({
      daily_report_limit: 3,
      daily_request_limit: 5,
      default_max_active: 3,
      magic_links_per_hour: 5,
      pending_cap: 3,
      platform_paused: false,
      reminder_days: [5, 10],
      request_expiry_days: 14,
      retention_months: 24,
    });
    expect(await read(member, "pending_cap")).toBe(3);
    await expect(
      asUser(db.pool, member, (client) => client.query("UPDATE config SET value = '9' WHERE key = 'pending_cap'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("admin_update_config_validates_per_key_and_audits", async () => {
    const admin = await makePerson(db.pool, { admin: true });
    const member = await makePerson(db.pool);
    const update = (viewer: string | null, key: string, value: unknown) =>
      asUser(db.pool, viewer, (client) =>
        client.query("SELECT admin_update_config($1, $2::jsonb)", [key, JSON.stringify(value)]),
      );

    await expect(update(member, "pending_cap", 5)).rejects.toThrow(/mest\.forbidden/);
    await expect(update(null, "pending_cap", 5)).rejects.toThrow(/mest\.forbidden/);

    const accepted: [string, unknown][] = [
      ["request_expiry_days", 3 + 8],
      ["request_expiry_days", 60],
      ["reminder_days", [2, 7]],
      ["pending_cap", 1],
      ["pending_cap", 10],
      ["default_max_active", 10],
      ["daily_request_limit", 50],
      ["daily_report_limit", 20],
      ["magic_links_per_hour", 1],
      ["platform_paused", true],
      ["retention_months", 6],
      ["retention_months", 60],
    ];
    for (const [key, value] of accepted) {
      await update(admin, key, value);
      expect(await read(admin, key), key).toEqual(value);
    }

    // Current state: request_expiry_days 60, reminder_days [2, 7].
    const rejected: [string, unknown][] = [
      ["request_expiry_days", 2],
      ["request_expiry_days", 61],
      ["request_expiry_days", 14.5],
      ["request_expiry_days", "14"],
      ["request_expiry_days", 7], // not above the last reminder day
      ["reminder_days", [7, 2]],
      ["reminder_days", [5, 5]],
      ["reminder_days", [0, 5]],
      ["reminder_days", [5, 60]],
      ["reminder_days", [5, "x"]],
      ["reminder_days", 5],
      ["pending_cap", 0],
      ["pending_cap", 11],
      ["default_max_active", 0],
      ["default_max_active", 11],
      ["daily_request_limit", 0],
      ["daily_request_limit", 51],
      ["daily_report_limit", 21],
      ["magic_links_per_hour", 21],
      ["platform_paused", "yes"],
      ["platform_paused", 1],
      ["retention_months", 5],
      ["retention_months", 61],
      ["no_such_key", 1],
    ];
    for (const [key, value] of rejected) {
      await expect(update(admin, key, value), `${key}=${JSON.stringify(value)}`).rejects.toThrow(/mest\.invalid_config/);
    }
    expect(await read(admin, "pending_cap")).toBe(10);
    expect(
      await scalarAs<number>(db.pool, admin, "SELECT count(*)::int AS value FROM config WHERE key = 'no_such_key'"),
    ).toBe(0);

    const entries = await asSystem(db.pool, async (client) => {
      const r = await client.query<{ actor_id: string; action: string; detail: { key: string; value: unknown } }>(
        "SELECT actor_id, action, detail FROM audit_log ORDER BY id",
      );
      return r.rows;
    });
    expect(entries).toHaveLength(accepted.length);
    expect(entries.every((entry) => entry.actor_id === admin && entry.action === "config.updated")).toBe(true);
    expect(entries[0].detail).toMatchObject({ key: "request_expiry_days", previous: 14, value: 11 });
  });
});

describe("integration review hardening", () => {
  it("write_audit_refused_to_app_user", async () => {
    // Entries come only from SECURITY DEFINER functions and system jobs, so a
    // request cannot forge one, and an anonymous request cannot pass off a
    // null-actor entry as a job's.
    const member = await makePerson(db.pool);
    for (const viewer of [member, null]) {
      await expect(
        asUser(db.pool, viewer, (client) =>
          client.query("SELECT write_audit('forged.entry', 'profile', NULL, '{}')"),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("owner_cannot_move_last_active_or_created_at", async () => {
    // Directory relevance sorts by last_active_at; only touch_last_active()
    // may move it.
    const owner = await makePerson(db.pool);
    for (const sql of [
      "UPDATE profiles SET last_active_at = now() + interval '1 year' WHERE id = app_uid()",
      "UPDATE profiles SET created_at = now() - interval '5 years' WHERE id = app_uid()",
    ]) {
      await expect(asUser(db.pool, owner, (client) => client.query(sql))).rejects.toThrow(/mest\.protected_field/);
    }
  });

  it("linkedin_url_must_be_https_and_region_is_capped", async () => {
    const owner = await makePerson(db.pool);
    await expect(
      asUser(db.pool, owner, (client) =>
        client.query("UPDATE profiles SET linkedin_url = 'http://linkedin.com/in/x' WHERE id = app_uid()"),
      ),
    ).rejects.toThrow(/check constraint/);
    await asUser(db.pool, owner, (client) =>
      client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/x' WHERE id = app_uid()"),
    );
    // Since 0020 a region must be an active regions row, whose id is a slug
    // of at most 60 characters; the region trigger refuses a longer one first.
    await expect(
      asSystem(db.pool, (client) =>
        client.query("UPDATE profiles SET region = $1 WHERE id = $2", ["a".repeat(61), owner]),
      ),
    ).rejects.toThrow(/mest\.invalid_region/);
  });

  it("reminder_days_capped_at_two", async () => {
    // mentorship_requests.reminders_sent counts to 2, so a third day could
    // never be sent.
    const admin = await makePerson(db.pool, { admin: true });
    await expect(
      asUser(db.pool, admin, (client) => client.query("SELECT admin_update_config('reminder_days', '[3, 6, 9]')")),
    ).rejects.toThrow(/mest\.invalid_config/);
    await asUser(db.pool, admin, (client) => client.query("SELECT admin_update_config('reminder_days', '[4]')"));
  });
});
