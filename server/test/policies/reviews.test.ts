import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs, scalarAs, studentPayload } from "./fixtures";

/**
 * The approval queue and the administrator functions: profile_reviews,
 * admin_review_profile, admin_set_verified, admin_grant and admin_revoke,
 * admin_review_tag, admin_add_vocabulary, admin_list_members, the
 * admin_dashboard view, and touch_last_active.
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

async function submitted(overrides: Record<string, unknown> = {}): Promise<{ profile: string; review: string }> {
  const profile = await newAccount(db.pool);
  await onboard(db.pool, profile, professionalPayload(overrides));
  const review = await db.pool.query<{ id: string }>("SELECT id FROM profile_reviews WHERE profile_id = $1", [profile]);
  return { profile, review: review.rows[0].id };
}

describe("profile_reviews", () => {
  it("subject_reads_own_reviews_admin_reads_all", async () => {
    const a = await submitted();
    const b = await submitted({ firstName: "Other" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });

    const sql = "SELECT profile_id, decision, notes FROM profile_reviews ORDER BY profile_id";
    expect(await rowsAs(db.pool, a.profile, sql)).toEqual([{ profile_id: a.profile, decision: null, notes: null }]);
    expect(await rowsAs(db.pool, member, sql)).toEqual([]);
    expect(await rowsAs(db.pool, null, sql)).toEqual([]);
    expect((await rowsAs(db.pool, admin, sql)).map((r) => r.profile_id).sort()).toEqual([a.profile, b.profile].sort());
    // Who reviewed is not the subject's to read; nobody writes directly.
    await expect(runAs(db.pool, a.profile, "SELECT reviewer_id FROM profile_reviews")).rejects.toThrow(/permission denied/);
    for (const viewer of [a.profile, admin]) {
      await expect(runAs(db.pool, viewer, "UPDATE profile_reviews SET decision = 'approved'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        runAs(db.pool, viewer, "INSERT INTO profile_reviews (profile_id, snapshot) VALUES (app_uid(), '{}')"),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("admin_review_profile_decides_notifies_and_audits", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const approved = await submitted();
    const declined = await submitted({ firstName: "Declined" });

    await expect(runAs(db.pool, member, "SELECT admin_review_profile($1, 'approved', NULL)", [approved.review])).rejects.toThrow(
      /mest\.forbidden/,
    );
    await runAs(db.pool, admin, "SELECT admin_review_profile($1, 'approved', NULL)", [approved.review]);
    await runAs(db.pool, admin, "SELECT admin_review_profile($1, 'declined', 'Please describe your current role.')", [
      declined.review,
    ]);
    // A decided review stays decided.
    await expect(runAs(db.pool, admin, "SELECT admin_review_profile($1, 'declined', 'x')", [approved.review])).rejects.toThrow(
      /mest\.review_closed/,
    );

    const states = await db.pool.query<{ id: string; approval_state: string }>(
      "SELECT id, approval_state FROM profiles WHERE id IN ($1, $2)",
      [approved.profile, declined.profile],
    );
    expect(Object.fromEntries(states.rows.map((r) => [r.id, r.approval_state]))).toEqual({
      [approved.profile]: "approved",
      [declined.profile]: "declined",
    });
    const review = await db.pool.query("SELECT reviewer_id, decision, notes, decided_at IS NOT NULL AS decided FROM profile_reviews WHERE id = $1", [
      declined.review,
    ]);
    expect(review.rows[0]).toEqual({ reviewer_id: admin, decision: "declined", notes: "Please describe your current role.", decided: true });
    // The declined member reads the decision and notes.
    expect(await rowsAs(db.pool, declined.profile, "SELECT decision, notes FROM profile_reviews")).toEqual([
      { decision: "declined", notes: "Please describe your current role." },
    ]);

    const notes = await db.pool.query<{ recipient_id: string; template: string; category: string }>(
      "SELECT recipient_id, template, category FROM notifications WHERE recipient_id IN ($1, $2) ORDER BY template",
      [approved.profile, declined.profile],
    );
    expect(notes.rows).toEqual([
      { recipient_id: approved.profile, template: "profile-approved", category: "profile" },
      { recipient_id: declined.profile, template: "profile-declined", category: "profile" },
    ]);
    const audits = await db.pool.query<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM audit_log WHERE action IN ('profile.approved', 'profile.declined') ORDER BY action",
    );
    expect(audits.rows).toEqual([
      { action: "profile.approved", actor_id: admin },
      { action: "profile.declined", actor_id: admin },
    ]);
  });

  it("declined_professional_can_resubmit", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const first = await submitted();
    await runAs(db.pool, admin, "SELECT admin_review_profile($1, 'declined', 'Add your title.')", [first.review]);
    await onboard(db.pool, first.profile, professionalPayload({ title: "Senior Water Resources Engineer" }));
    const reviews = await db.pool.query("SELECT decision FROM profile_reviews WHERE profile_id = $1 ORDER BY submitted_at", [
      first.profile,
    ]);
    expect(reviews.rows).toEqual([{ decision: "declined" }, { decision: null }]);
    const state = await db.pool.query("SELECT approval_state, title FROM profiles JOIN professional_details ON profile_id = id WHERE id = $1", [
      first.profile,
    ]);
    expect(state.rows[0]).toEqual({ approval_state: "pending", title: "Senior Water Resources Engineer" });
    // An approved or pending professional cannot onboard again.
    await expect(onboard(db.pool, first.profile, professionalPayload())).rejects.toThrow(/mest\.already_onboarded/);
  });
});

describe("verification", () => {
  it("admin_set_verified_sets_clears_and_notifies", async () => {
    const pro = await makePerson(db.pool);
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await expect(runAs(db.pool, pro, "SELECT admin_set_verified($1, 'linkedin')", [pro])).rejects.toThrow(/mest\.forbidden/);
    await runAs(db.pool, admin, "SELECT admin_set_verified($1, 'linkedin')", [pro]);
    expect(await scalarAs(db.pool, null, "SELECT verified AS value FROM directory_entries WHERE id = $1", [pro])).toBe(true);
    expect(
      (await db.pool.query("SELECT 1 FROM notifications WHERE recipient_id = $1 AND template = 'profile-verified'", [pro]))
        .rowCount,
    ).toBe(1);
    await runAs(db.pool, admin, "SELECT admin_set_verified($1, NULL)", [pro]);
    const row = await db.pool.query("SELECT verified, verified_method FROM professional_details WHERE profile_id = $1", [pro]);
    expect(row.rows[0]).toEqual({ verified: false, verified_method: null });
    const actions = await db.pool.query<{ action: string }>("SELECT action FROM audit_log WHERE subject_id = $1 ORDER BY id", [pro]);
    expect(actions.rows.map((r) => r.action)).toEqual(["profile.verified", "profile.unverified"]);
  });
});

describe("administrator roles", () => {
  it("admin_revoke_refuses_below_two", async () => {
    const a = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const b = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const c = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const active = async () =>
      (await db.pool.query<{ profile_id: string }>("SELECT profile_id FROM admin_roles WHERE revoked_at IS NULL ORDER BY profile_id"))
        .rows.map((r) => r.profile_id);

    await expect(runAs(db.pool, a, "SELECT admin_revoke($1)", [b])).rejects.toThrow(/mest\.admin_minimum/);
    await expect(runAs(db.pool, c, "SELECT admin_grant($1)", [c])).rejects.toThrow(/mest\.forbidden/);

    await runAs(db.pool, a, "SELECT admin_grant($1)", [c]);
    expect(await active()).toEqual([a, b, c].sort());
    expect(await scalarAs(db.pool, c, "SELECT is_admin() AS value")).toBe(true);
    const granted = await db.pool.query("SELECT granted_by FROM admin_roles WHERE profile_id = $1", [c]);
    expect(granted.rows[0].granted_by).toBe(a);

    await runAs(db.pool, c, "SELECT admin_revoke($1)", [a]);
    expect(await active()).toEqual([b, c].sort());
    await expect(runAs(db.pool, b, "SELECT admin_revoke($1)", [c])).rejects.toThrow(/mest\.admin_minimum/);
    // Granting again restores the role.
    await runAs(db.pool, b, "SELECT admin_grant($1)", [a]);
    expect(await active()).toEqual([a, b, c].sort());

    const actions = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action LIKE 'admin.%' ORDER BY id",
    );
    expect(actions.rows.map((r) => r.action)).toEqual(["admin.granted", "admin.revoked", "admin.granted"]);
  });

  it("admin_list_members_has_no_email", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden", email: "chief@example.test", firstName: "Chief" });
    const student = await newAccount(db.pool, { email: "sami.river@students.example.test" });
    await onboard(db.pool, student, studentPayload());
    const pro = await newAccount(db.pool, { email: "noor@delta.example.test" });
    await onboard(db.pool, pro, professionalPayload());

    const rows = await rowsAs<Record<string, unknown>>(db.pool, admin, "SELECT * FROM admin_list_members(1, 20, NULL)");
    expect(rows).toHaveLength(3);
    const text = JSON.stringify(rows);
    for (const address of ["chief@", "sami.river@", "noor@"]) {
      expect(text).not.toContain(address);
    }
    const byName = Object.fromEntries(rows.map((r) => [r.first_name, r]));
    expect(byName.Sami).toMatchObject({ kind: "student", approval_state: "approved", mentor_status: null, email_domain: "students.example.test", total: 3 });
    expect(byName.Noor).toMatchObject({ kind: "professional", approval_state: "pending", mentor_status: "active", email_domain: "delta.example.test" });
    for (const forbidden of ["email", "phone", "linkedin_url", "contact_email"]) {
      expect(Object.keys(rows[0])).not.toContain(forbidden);
    }
    // Paging and the name search.
    expect(await rowsAs(db.pool, admin, "SELECT first_name FROM admin_list_members(1, 20, 'noor')")).toEqual([{ first_name: "Noor" }]);
    expect(await rowsAs(db.pool, admin, "SELECT first_name FROM admin_list_members(2, 2, NULL)")).toHaveLength(1);
    // Members cannot call it.
    await expect(runAs(db.pool, student, "SELECT * FROM admin_list_members(1, 20, NULL)")).rejects.toThrow(/mest\.forbidden/);
  });
});

describe("vocabulary administration", () => {
  it("admin_review_tag_approves_or_rejects_proposed_tags", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const { profile } = await submitted({ expertise: ["Marsh terracing", "Sediment budgets"] });
    const tag = async (label: string) =>
      (await db.pool.query<{ id: string; status: string }>("SELECT id, status FROM expertise_tags WHERE label = $1", [label])).rows[0];

    await expect(runAs(db.pool, profile, "SELECT admin_review_tag($1, 'approved')", [(await tag("Marsh terracing")).id])).rejects.toThrow(
      /mest\.forbidden/,
    );
    await runAs(db.pool, admin, "SELECT admin_review_tag($1, 'approved')", [(await tag("Marsh terracing")).id]);
    await runAs(db.pool, admin, "SELECT admin_review_tag($1, 'rejected')", [(await tag("Sediment budgets")).id]);
    expect((await tag("Marsh terracing")).status).toBe("approved");
    expect((await tag("Sediment budgets")).status).toBe("rejected");
    // A rejected tag leaves the profile.
    const linked = await db.pool.query<{ label: string }>(
      "SELECT t.label FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id WHERE pe.profile_id = $1",
      [profile],
    );
    expect(linked.rows.map((r) => r.label)).toEqual(["Marsh terracing"]);
    await expect(runAs(db.pool, admin, "SELECT admin_review_tag($1, 'proposed')", [(await tag("Marsh terracing")).id])).rejects.toThrow(
      /mest\.invalid_decision/,
    );
    // Proposing a rejected label again is refused.
    const again = await newAccount(db.pool);
    await expect(onboard(db.pool, again, professionalPayload({ expertise: ["sediment budgets", "Levee design"] }))).rejects.toThrow(
      /mest\.tag_rejected/,
    );
  });

  it("admin_add_vocabulary_adds_disciplines_and_topics", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await runAs(db.pool, admin, "SELECT admin_add_vocabulary('discipline', 'naval-arch', 'Naval architecture', 'Engineering')");
    await runAs(db.pool, admin, "SELECT admin_add_vocabulary('topic', 'patents-test', 'Patents and IP')");
    expect(await rowsAs(db.pool, null, "SELECT label, group_name FROM disciplines WHERE id = 'naval-arch'")).toEqual([
      { label: "Naval architecture", group_name: "Engineering" },
    ]);
    expect(await rowsAs(db.pool, null, "SELECT label, active FROM mentorship_topics WHERE id = 'patents-test'")).toEqual([
      { label: "Patents and IP", active: true },
    ]);
    await expect(runAs(db.pool, admin, "SELECT admin_add_vocabulary('topic', 'patents-test', 'Again')")).rejects.toThrow(
      /mest\.duplicate/,
    );
    await expect(runAs(db.pool, admin, "SELECT admin_add_vocabulary('discipline', 'Bad Id', 'Bad')")).rejects.toThrow(
      /mest\.invalid_vocabulary/,
    );
    await expect(runAs(db.pool, admin, "SELECT admin_add_vocabulary('region', 'x', 'Somewhere')")).rejects.toThrow(
      /mest\.invalid_vocabulary/,
    );
    await expect(runAs(db.pool, member, "SELECT admin_add_vocabulary('topic', 'sneaky', 'Sneaky')")).rejects.toThrow(
      /mest\.forbidden/,
    );
    expect(
      (await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'vocabulary.added'")).rowCount,
    ).toBe(2);
  });
});

describe("dashboard and activity", () => {
  it("admin_dashboard_counts_for_admins_only", async () => {
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });
    await makePerson(db.pool);
    await makePerson(db.pool, { visibility: "members" });
    const student = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await submitted();
    const mentor = await submitted({ firstName: "Mentor" });
    await asSystem(db.pool, (client) => client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [mentor.profile]));

    const [counts] = await rowsAs(db.pool, admin, "SELECT * FROM admin_dashboard");
    expect(counts).toEqual({ approved_professionals: 4, pending_professionals: 1, students: 1, active_mentors: 1 });
    expect(await rowsAs(db.pool, student, "SELECT * FROM admin_dashboard")).toEqual([]);
    expect(await rowsAs(db.pool, null, "SELECT * FROM admin_dashboard")).toEqual([]);
  });

  it("touch_last_active_at_most_daily", async () => {
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const read = async () =>
      (await db.pool.query<{ at: Date | null }>("SELECT last_active_at AS at FROM profiles WHERE id = $1", [member])).rows[0].at;
    expect(await read()).toBeNull();
    expect(await scalarAs(db.pool, member, "SELECT touch_last_active() AS value")).toBe(true);
    const first = await read();
    expect(first).not.toBeNull();
    expect(await scalarAs(db.pool, member, "SELECT touch_last_active() AS value")).toBe(false);
    expect(await read()).toEqual(first);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET last_active_at = now() - interval '25 hours' WHERE id = $1", [member]),
    );
    expect(await scalarAs(db.pool, member, "SELECT touch_last_active() AS value")).toBe(true);
    expect(await scalarAs(db.pool, null, "SELECT touch_last_active() AS value")).toBe(false);
  });
});
