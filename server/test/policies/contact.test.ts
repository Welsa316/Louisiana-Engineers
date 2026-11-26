import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, newAccount, onboard, professionalPayload, rowsAs, runAs } from "./fixtures";

/**
 * contact_preferences and release_contact (02 sections 4.3, 4.5 and 5.4):
 * the row is the owner's alone; values leave only through release_contact,
 * and only the methods the professional shares with members.
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

interface ContactOptions {
  methods: string[];
  share: string[];
  contactEmail?: string | null;
  phone?: string | null;
  booking?: string | null;
  linkedin?: string | null;
}

/** A listed professional with the given contact preferences, written as the table owner. */
async function professionalWith(options: ContactOptions, person: Parameters<typeof makePerson>[1] = {}): Promise<string> {
  const id = await makePerson(db.pool, { email: `pro-${Math.random().toString(36).slice(2)}@example.test`, ...person });
  await asSystem(db.pool, async (client) => {
    if (options.linkedin) {
      await client.query("UPDATE profiles SET linkedin_url = $2 WHERE id = $1", [id, options.linkedin]);
    }
    await client.query(
      `INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
       VALUES ($1, $2::contact_method[], $3::contact_method[], $4, $5, $6)`,
      [id, options.methods, options.share, options.contactEmail ?? null, options.phone ?? null, options.booking ?? null],
    );
  });
  return id;
}

const release = (viewer: string | null, profile: string) =>
  rowsAs<{ method: string; value: string }>(db.pool, viewer, "SELECT method::text, value FROM release_contact($1)", [profile]);

const contactViews = async (profile: string) =>
  (
    await db.pool.query<{ actor_id: string; detail: Record<string, unknown> }>(
      "SELECT actor_id, detail FROM audit_log WHERE action = 'contact.viewed' AND subject_id = $1 ORDER BY id",
      [profile],
    )
  ).rows;

describe("contact_preferences row-level security", () => {
  it("contact_preferences_unreadable_by_members_and_admins", async () => {
    const owner = await professionalWith({ methods: ["mest", "email", "phone"], share: ["email"], phone: "+15045550100" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });

    for (const viewer of [null, member, admin]) {
      expect(await rowsAs(db.pool, viewer, "SELECT profile_id FROM contact_preferences")).toEqual([]);
      // Writes to someone else's row reach nothing.
      await runAs(db.pool, viewer, "UPDATE contact_preferences SET share_with_members = '{email,phone}'");
    }
    const row = await db.pool.query("SELECT share_with_members::text[] AS share_with_members FROM contact_preferences WHERE profile_id = $1", [owner]);
    expect(row.rows[0].share_with_members).toEqual(["email"]);

    // The owner reads and edits their own.
    expect(await rowsAs(db.pool, owner, "SELECT phone FROM contact_preferences")).toEqual([{ phone: "+15045550100" }]);
    await runAs(db.pool, owner, "UPDATE contact_preferences SET share_with_members = '{email,phone}' WHERE profile_id = app_uid()");
    const after = await db.pool.query("SELECT share_with_members::text[] AS share_with_members FROM contact_preferences WHERE profile_id = $1", [owner]);
    expect(after.rows[0].share_with_members).toEqual(["email", "phone"]);
    await expect(runAs(db.pool, owner, "DELETE FROM contact_preferences WHERE profile_id = app_uid()")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("contact_preferences_constraints", async () => {
    const owner = await professionalWith({ methods: ["mest"], share: [] });
    const refused = [
      "UPDATE contact_preferences SET methods = '{email}' WHERE profile_id = app_uid()", // mest always on
      "UPDATE contact_preferences SET share_with_members = '{mest}' WHERE profile_id = app_uid()",
      "UPDATE contact_preferences SET share_with_members = '{email}' WHERE profile_id = app_uid()", // not in methods
      "UPDATE contact_preferences SET methods = '{mest,phone}' WHERE profile_id = app_uid()", // no phone value
      "UPDATE contact_preferences SET methods = '{mest,booking}' WHERE profile_id = app_uid()", // no link
      "UPDATE contact_preferences SET phone = '504-555-0100' WHERE profile_id = app_uid()", // not E.164
      "UPDATE contact_preferences SET booking_url = 'http://cal.example.test/x' WHERE profile_id = app_uid()",
    ];
    for (const sql of refused) {
      await expect(runAs(db.pool, owner, sql), sql).rejects.toThrow(/violates check constraint/);
    }
  });
});

describe("release_contact", () => {
  it("release_contact_shared_methods_only_for_members", async () => {
    const pro = await professionalWith(
      {
        methods: ["mest", "email", "linkedin", "booking"],
        share: ["linkedin", "booking"],
        booking: "https://cal.example.test/pro",
        linkedin: "https://www.linkedin.com/in/example-pro",
      },
      { email: "pro-signin@example.test" },
    );
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const unverified = await makePerson(db.pool, { kind: "student", visibility: "hidden", verified: false });
    const suspended = await makePerson(db.pool, { kind: "student", visibility: "hidden", suspended: true });

    expect(await release(member, pro)).toEqual([
      { method: "linkedin", value: "https://www.linkedin.com/in/example-pro" },
      { method: "booking", value: "https://cal.example.test/pro" },
    ]);
    for (const viewer of [null, unverified, suspended]) {
      expect(await release(viewer, pro)).toEqual([]);
    }

    // Email resolves to the sign-in address unless a contact address is set.
    await asSystem(db.pool, (client) =>
      client.query("UPDATE contact_preferences SET share_with_members = '{email}' WHERE profile_id = $1", [pro]),
    );
    expect(await release(member, pro)).toEqual([{ method: "email", value: "pro-signin@example.test" }]);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE contact_preferences SET contact_email = 'office@example.test' WHERE profile_id = $1", [pro]),
    );
    expect(await release(member, pro)).toEqual([{ method: "email", value: "office@example.test" }]);

    // A profile the member cannot see releases nothing, even with methods shared.
    const hidden = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { visibility: "hidden" });
    const pending = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { approval: "pending" });
    expect(await release(member, hidden)).toEqual([]);
    expect(await release(member, pending)).toEqual([]);
    // A members-only profile releases to members.
    const membersOnly = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { visibility: "members" });
    expect((await release(member, membersOnly)).map((r) => r.method)).toEqual(["email"]);
    // Nothing shared, nothing released.
    const quiet = await professionalWith({ methods: ["mest", "email"], share: [] });
    expect(await release(member, quiet)).toEqual([]);
  });

  it("release_contact_phone_never_without_opt_in", async () => {
    const account = await newAccount(db.pool);
    // Onboarding with phone among the methods but not shared.
    await onboard(
      db.pool,
      account,
      professionalPayload({ contact: { methods: ["mest", "email", "phone"], shareWithMembers: ["email"], phone: "+15045550199" } }),
    );
    await asSystem(db.pool, (client) => client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [account]));
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    const released = await release(member, account);
    expect(released.map((r) => r.method)).toEqual(["email"]);
    expect(JSON.stringify(released)).not.toContain("5550199");

    // Once the professional opts in, members get it.
    await runAs(db.pool, account, "UPDATE contact_preferences SET share_with_members = '{email,phone}' WHERE profile_id = app_uid()");
    expect((await release(member, account)).map((r) => r.method)).toEqual(["email", "phone"]);
  });

  it("release_contact_audited_once", async () => {
    const pro = await professionalWith({ methods: ["mest", "email", "phone"], share: ["email", "phone"], phone: "+15045550111" });
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const another = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    await release(member, pro);
    await release(member, pro);
    await release(another, pro);
    // A visitor's empty answer is not logged.
    await release(null, pro);

    const views = await contactViews(pro);
    expect(views.map((v) => v.actor_id)).toEqual([member, another]);
    // The entry says which methods were shown, never their values.
    expect(JSON.stringify(views)).not.toContain("5550111");
    expect(JSON.stringify(views)).not.toContain("@example.test");
    expect(views[0].detail).toEqual({ methods: ["email", "phone"] });

    // Nothing released, nothing logged.
    const quiet = await professionalWith({ methods: ["mest"], share: [] });
    await release(member, quiet);
    expect(await contactViews(quiet)).toEqual([]);
  });
});
