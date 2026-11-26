import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs, scalarAs, sorted, studentPayload } from "./fixtures";

/**
 * mentorship_settings, mentor_topics and notification_preferences, with the
 * functions that move mentorship status: set_mentorship_status, set_kind,
 * admin_hide_profile and admin_restore_profile.
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

/** An approved, listed mentor created through onboarding. */
async function mentor(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await newAccount(db.pool);
  await onboard(db.pool, id, professionalPayload(overrides));
  await asSystem(db.pool, (client) => client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [id]));
  return id;
}

const status = async (id: string) =>
  (
    await db.pool.query<{ status: string; previous_status: string | null; paused_until: string | null }>(
      "SELECT status, previous_status, to_char(paused_until, 'YYYY-MM-DD') AS paused_until FROM mentorship_settings WHERE profile_id = $1",
      [id],
    )
  ).rows[0];

describe("mentorship_settings row-level security", () => {
  it("settings_follow_the_profile_and_max_active_is_owner_only", async () => {
    const listed = await mentor();
    const membersOnly = await mentor({ visibility: "members" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const pending = await newAccount(db.pool);
    await onboard(db.pool, pending, professionalPayload());

    const sql = "SELECT profile_id, status FROM mentorship_settings ORDER BY profile_id";
    const ids = (rows: { profile_id: string }[]) => rows.map((r) => r.profile_id);
    expect(ids(await rowsAs(db.pool, null, sql))).toEqual([listed]);
    expect(ids(await rowsAs(db.pool, member, sql))).toEqual(sorted([listed, membersOnly]));
    expect(ids(await rowsAs(db.pool, pending, sql))).toEqual(sorted([listed, membersOnly, pending]));
    expect(ids(await rowsAs(db.pool, admin, sql))).toEqual(sorted([listed, membersOnly, pending]));
    // Topics follow the same rule.
    const topics = await rowsAs<{ profile_id: string }>(db.pool, null, "SELECT DISTINCT profile_id FROM mentor_topics");
    expect(topics.map((r) => r.profile_id)).toEqual([listed]);

    // max_active is the owner's alone; everyone else reads has_capacity.
    for (const viewer of [null, member, admin, listed]) {
      await expect(runAs(db.pool, viewer, "SELECT max_active FROM mentorship_settings")).rejects.toThrow(/permission denied/);
    }
    expect(await rowsAs(db.pool, listed, "SELECT profile_id, max_active FROM my_mentorship_settings()")).toEqual([
      { profile_id: listed, max_active: 3 },
    ]);
    expect(await rowsAs(db.pool, member, "SELECT * FROM my_mentorship_settings()")).toEqual([]);
  });

  it("owner_edits_offer_but_not_status", async () => {
    const owner = await mentor();
    const other = await mentor({ firstName: "Other" });
    await runAs(
      db.pool,
      owner,
      "UPDATE mentorship_settings SET max_active = 1, availability = 'Mornings', duration_min = 30 WHERE profile_id = app_uid()",
    );
    await runAs(db.pool, owner, "UPDATE mentorship_settings SET max_active = 9 WHERE profile_id = $1", [other]);
    const rows = await db.pool.query("SELECT profile_id, max_active, availability FROM mentorship_settings ORDER BY profile_id");
    expect(Object.fromEntries(rows.rows.map((r) => [r.profile_id, [r.max_active, r.availability]]))).toEqual({
      [owner]: [1, "Mornings"],
      [other]: [3, "Weekday evenings"],
    });
    for (const sql of [
      "UPDATE mentorship_settings SET status = 'off' WHERE profile_id = app_uid()",
      "UPDATE mentorship_settings SET previous_status = 'active' WHERE profile_id = app_uid()",
      "UPDATE mentorship_settings SET paused_until = '2030-01-01' WHERE profile_id = app_uid()",
      "INSERT INTO mentorship_settings (profile_id) VALUES (app_uid())",
      "DELETE FROM mentorship_settings WHERE profile_id = app_uid()",
    ]) {
      await expect(runAs(db.pool, owner, sql), sql).rejects.toThrow(/permission denied/);
    }
    await expect(
      runAs(db.pool, owner, "UPDATE mentorship_settings SET max_active = 11 WHERE profile_id = app_uid()"),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("students_have_no_mentorship_settings", async () => {
    const student = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await expect(
      asSystem(db.pool, (client) => client.query("INSERT INTO mentorship_settings (profile_id) VALUES ($1)", [student])),
    ).rejects.toThrow(/mest\.not_professional/);
  });

  it("notification_preferences_owner_only", async () => {
    const owner = await newAccount(db.pool);
    await onboard(db.pool, owner, studentPayload());
    const other = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    expect(await rowsAs(db.pool, owner, "SELECT email_requests, email_product_updates FROM notification_preferences")).toEqual([
      { email_requests: true, email_product_updates: false },
    ]);
    for (const viewer of [null, other, admin]) {
      expect(await rowsAs(db.pool, viewer, "SELECT profile_id FROM notification_preferences")).toEqual([]);
    }
  });
});

describe("set_mentorship_status", () => {
  it("mentoring_requires_participation", async () => {
    const pro = await mentor({ participation: ["directory", "networking"], mentorship: undefined });
    expect((await status(pro)).status).toBe("off");
    await expect(runAs(db.pool, pro, "SELECT set_mentorship_status('active', NULL)")).rejects.toThrow(
      /mest\.mentoring_not_offered/,
    );
    // Adding mentoring to participation is not enough without topics and an audience.
    await runAs(
      db.pool,
      pro,
      "UPDATE professional_details SET participation = '{directory,networking,mentoring}' WHERE profile_id = app_uid()",
    );
    await expect(runAs(db.pool, pro, "SELECT set_mentorship_status('active', NULL)")).rejects.toThrow(
      /mest\.mentorship_incomplete/,
    );
    await runAs(db.pool, pro, "UPDATE mentorship_settings SET audience = '{undergrad}' WHERE profile_id = app_uid()");
    await runAs(db.pool, pro, "INSERT INTO mentor_topics (profile_id, topic_id) VALUES (app_uid(), 'graduate-school')");
    await runAs(db.pool, pro, "SELECT set_mentorship_status('active', NULL)");
    expect((await status(pro)).status).toBe("active");

    // Dropping mentoring from participation turns the offer off.
    await runAs(db.pool, pro, "UPDATE professional_details SET participation = '{directory}' WHERE profile_id = app_uid()");
    expect((await status(pro)).status).toBe("off");
  });

  it("pause_stores_resume_date_and_off_clears_it", async () => {
    const pro = await mentor();
    await runAs(db.pool, pro, "SELECT set_mentorship_status('paused', '2030-02-01')");
    expect(await status(pro)).toEqual({ status: "paused", previous_status: null, paused_until: "2030-02-01" });
    await expect(runAs(db.pool, pro, "SELECT set_mentorship_status('paused', '2000-01-01')")).rejects.toThrow(
      /mest\.invalid_resume_date/,
    );
    await runAs(db.pool, pro, "SELECT set_mentorship_status('off', NULL)");
    expect(await status(pro)).toEqual({ status: "off", previous_status: null, paused_until: null });
    // Only for oneself: a student has no offer to change.
    const student = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await expect(runAs(db.pool, student, "SELECT set_mentorship_status('active', NULL)")).rejects.toThrow(
      /mest\.not_professional/,
    );
    await expect(runAs(db.pool, null, "SELECT set_mentorship_status('active', NULL)")).rejects.toThrow(/mest\.forbidden/);
  });
});

describe("administrator hide and restore", () => {
  it("admin_hide_sets_mentorship_off_and_restore_returns_it", async () => {
    const pro = await mentor();
    await runAs(db.pool, pro, "SELECT set_mentorship_status('paused', '2030-02-01')");
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    await expect(runAs(db.pool, member, "SELECT admin_hide_profile($1)", [pro])).rejects.toThrow(/mest\.forbidden/);
    await runAs(db.pool, admin, "SELECT admin_hide_profile($1)", [pro]);
    expect(await status(pro)).toMatchObject({ status: "off", previous_status: "paused" });
    expect(await scalarAs(db.pool, null, "SELECT profile_access($1) AS value", [pro])).toBe("none");
    // The owner cannot turn it back on while hidden.
    await expect(runAs(db.pool, pro, "SELECT set_mentorship_status('active', NULL)")).rejects.toThrow(/mest\.profile_hidden/);
    // Hiding twice keeps the first previous status.
    await runAs(db.pool, admin, "SELECT admin_hide_profile($1)", [pro]);
    expect((await status(pro)).previous_status).toBe("paused");

    await runAs(db.pool, admin, "SELECT admin_restore_profile($1)", [pro]);
    expect(await status(pro)).toEqual({ status: "paused", previous_status: null, paused_until: "2030-02-01" });
    expect(await scalarAs(db.pool, null, "SELECT profile_access($1) AS value", [pro])).toBe("visible");
    const actions = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE subject_id = $1 AND action LIKE 'profile.%' ORDER BY id",
      [pro],
    );
    expect(actions.rows.map((r) => r.action)).toEqual(["profile.submitted", "profile.hidden", "profile.restored"]);
  });

  it("restore_after_mentoring_dropped_while_hidden_stays_off", async () => {
    const pro = await mentor();
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await runAs(db.pool, admin, "SELECT admin_hide_profile($1)", [pro]);
    await runAs(db.pool, pro, "UPDATE professional_details SET participation = '{directory}' WHERE profile_id = app_uid()");
    await runAs(db.pool, admin, "SELECT admin_restore_profile($1)", [pro]);
    expect((await status(pro)).status).toBe("off");
  });

  it("owner_cannot_clear_admin_hidden", async () => {
    const pro = await mentor();
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await runAs(db.pool, admin, "SELECT admin_hide_profile($1)", [pro]);
    await expect(runAs(db.pool, pro, "UPDATE profiles SET admin_hidden_at = NULL WHERE id = app_uid()")).rejects.toThrow(
      /mest\.protected_field/,
    );
    // Re-choosing visibility does not bring the profile back either.
    await runAs(db.pool, pro, "UPDATE profiles SET visibility = 'public' WHERE id = app_uid()");
    expect(await scalarAs(db.pool, null, "SELECT profile_access($1) AS value", [pro])).toBe("none");
    const hidden = await db.pool.query("SELECT admin_hidden_at IS NOT NULL AS hidden FROM profiles WHERE id = $1", [pro]);
    expect(hidden.rows[0].hidden).toBe(true);
  });
});

describe("set_kind", () => {
  it("student_to_professional_enters_the_queue_and_back", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const account = await newAccount(db.pool);
    await onboard(db.pool, account, studentPayload());

    await runAs(db.pool, account, "SELECT set_kind('professional')");
    const after = await db.pool.query("SELECT kind, approval_state, visibility FROM profiles WHERE id = $1", [account]);
    expect(after.rows[0]).toEqual({ kind: "professional", approval_state: "pending", visibility: "public" });
    expect((await db.pool.query("SELECT 1 FROM profile_reviews WHERE profile_id = $1 AND decision IS NULL", [account])).rowCount).toBe(1);
    expect(await status(account)).toMatchObject({ status: "off" });
    const notified = await db.pool.query("SELECT recipient_id FROM notifications WHERE template = 'profile-submitted'");
    expect(notified.rows).toEqual([{ recipient_id: admin }]);

    // And back: approved student again, hidden, the open review withdrawn.
    await runAs(db.pool, account, "SELECT set_kind('student')");
    const back = await db.pool.query("SELECT kind, approval_state, visibility FROM profiles WHERE id = $1", [account]);
    expect(back.rows[0]).toEqual({ kind: "student", approval_state: "approved", visibility: "hidden" });
    expect((await db.pool.query("SELECT 1 FROM profile_reviews WHERE profile_id = $1 AND decision IS NULL", [account])).rowCount).toBe(0);
    // The same kind again is a no-op; before onboarding it is refused.
    await runAs(db.pool, account, "SELECT set_kind('student')");
    const fresh = await newAccount(db.pool);
    await expect(runAs(db.pool, fresh, "SELECT set_kind('student')")).rejects.toThrow(/mest\.not_onboarded/);
  });
});
