import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, scalarAs, sorted, visibleProfileIds } from "./fixtures";

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

/** One profile in every state the listing rule has to tell apart. */
async function population() {
  const pool = db.pool;
  return {
    publicPro: await makePerson(pool),
    membersPro: await makePerson(pool, { visibility: "members" }),
    hiddenPro: await makePerson(pool, { visibility: "hidden" }),
    pendingPro: await makePerson(pool, { approval: "pending" }),
    declinedPro: await makePerson(pool, { approval: "declined" }),
    adminHiddenPro: await makePerson(pool, { adminHidden: true }),
    adminHiddenMembersPro: await makePerson(pool, { adminHidden: true, visibility: "members" }),
    anonymizedPro: await makePerson(pool, { anonymized: true }),
    // A student whose row somehow says public and approved is still never listed.
    student: await makePerson(pool, { kind: "student", visibility: "public" }),
    notOnboarded: await makePerson(pool, { kind: null, approval: "pending" }),
  };
}

describe("profiles row-level security", () => {
  it("anon_reads_public_professionals_only", async () => {
    const p = await population();
    expect(await visibleProfileIds(db.pool, null)).toEqual([p.publicPro]);

    // Signed in but not a member (unverified): the public rows plus their own.
    const unverified = await makePerson(db.pool, { verified: false, kind: null, approval: "pending" });
    expect(await visibleProfileIds(db.pool, unverified)).toEqual(sorted([p.publicPro, unverified]));
  });

  it("member_reads_members_visibility_not_hidden", async () => {
    const p = await population();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    expect(await visibleProfileIds(db.pool, member)).toEqual(sorted([p.publicPro, p.membersPro, member]));

    // A suspended account is not a member, so it falls back to the visitor rule.
    const suspended = await makePerson(db.pool, { kind: "student", visibility: "hidden", suspended: true });
    expect(await visibleProfileIds(db.pool, suspended)).toEqual(sorted([p.publicPro, suspended]));

    // An account inside its deletion grace period is not a member either.
    const leaving = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'hidden')`,
        [leaving],
      ),
    );
    expect(await visibleProfileIds(db.pool, leaving)).toEqual(sorted([p.publicPro, leaving]));
  });

  it("owner_reads_own_pending_profile", async () => {
    const p = await population();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });

    for (const own of [p.pendingPro, p.declinedPro, p.hiddenPro, p.adminHiddenPro, p.notOnboarded]) {
      const seen = await visibleProfileIds(db.pool, own);
      expect(seen).toContain(own);
    }
    expect(await visibleProfileIds(db.pool, member)).not.toContain(p.pendingPro);
    expect(await visibleProfileIds(db.pool, null)).not.toContain(p.pendingPro);

    // The owner reads the whole row, including the state columns.
    const row = await asUser(db.pool, p.pendingPro, async (client) => {
      const r = await client.query<{ approval_state: string }>("SELECT approval_state FROM profiles WHERE id = $1", [
        p.pendingPro,
      ]);
      return r.rows[0];
    });
    expect(row.approval_state).toBe("pending");
  });

  it("student_profiles_never_listed", async () => {
    const p = await population();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const otherStudent = await makePerson(db.pool, { kind: "student", visibility: "members" });

    expect(await visibleProfileIds(db.pool, null)).not.toContain(p.student);
    expect(await visibleProfileIds(db.pool, null)).not.toContain(otherStudent);
    expect(await visibleProfileIds(db.pool, member)).not.toContain(p.student);
    expect(await visibleProfileIds(db.pool, member)).not.toContain(otherStudent);
    expect(await visibleProfileIds(db.pool, p.student)).toContain(p.student);
  });

  it("admin_reads_every_profile", async () => {
    const p = await population();
    const admin = await makePerson(db.pool, { admin: true });
    const seen = await visibleProfileIds(db.pool, admin);
    expect(seen).toEqual(sorted([...Object.values(p), admin]));

    // A revoked administrator is an ordinary member again.
    await asSystem(db.pool, (client) => client.query("UPDATE admin_roles SET revoked_at = now() WHERE profile_id = $1", [admin]));
    expect(await visibleProfileIds(db.pool, admin)).toEqual(sorted([p.publicPro, p.membersPro, admin]));
  });

  it("owner_update_cannot_change_approval_state", async () => {
    const owner = await makePerson(db.pool, { approval: "pending" });

    const protectedChanges: [string, unknown][] = [
      ["approval_state", "approved"],
      ["kind", "student"],
      ["anonymized_at", new Date()],
      ["admin_hidden_at", new Date()],
      ["mission_accepted_at", new Date()],
    ];
    for (const [column, value] of protectedChanges) {
      await expect(
        asUser(db.pool, owner, (client) => client.query(`UPDATE profiles SET ${column} = $2 WHERE id = $1`, [owner, value])),
        column,
      ).rejects.toThrow(/mest\.protected_field/);
    }

    // An administrator acting directly is refused the same columns; they move
    // only through the definer functions.
    const admin = await makePerson(db.pool, { admin: true });
    await expect(
      asUser(db.pool, admin, (client) =>
        client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [owner]),
      ),
    ).rejects.toThrow(/mest\.protected_field/);

    // Ordinary columns are the owner's to change, and the row really changes.
    await asUser(db.pool, owner, (client) =>
      client.query("UPDATE profiles SET first_name = 'Layla', visibility = 'members' WHERE id = $1", [owner]),
    );
    const after = await asSystem(db.pool, async (client) => {
      const r = await client.query<{ first_name: string; visibility: string; approval_state: string }>(
        "SELECT first_name, visibility, approval_state FROM profiles WHERE id = $1",
        [owner],
      );
      return r.rows[0];
    });
    expect(after).toEqual({ first_name: "Layla", visibility: "members", approval_state: "pending" });

    // Someone else's row is out of reach: the update matches nothing.
    const stranger = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const touched = await asUser(db.pool, stranger, async (client) => {
      const r = await client.query("UPDATE profiles SET first_name = 'Mallory' WHERE id = $1", [owner]);
      return r.rowCount;
    });
    expect(touched).toBe(0);

    // The table owner (definer functions, the auth module, jobs) can change state.
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [owner]),
    );
    // It now lists for members (the owner chose members-only above).
    expect(await visibleProfileIds(db.pool, stranger)).toContain(owner);
    expect(await visibleProfileIds(db.pool, null)).not.toContain(owner);
  });

  it("app_user_cannot_insert_or_delete_profiles_or_touch_auth_tables", async () => {
    const member = await makePerson(db.pool);
    await expect(
      asUser(db.pool, member, (client) =>
        client.query("INSERT INTO profiles (id, first_name, last_name) VALUES (gen_random_uuid(), 'A', 'B')"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, member, (client) => client.query("DELETE FROM profiles WHERE id = $1", [member])),
    ).rejects.toThrow(/permission denied/);
    for (const table of ["users", "sessions", "auth_tokens", "job_runs"]) {
      await expect(
        asUser(db.pool, member, (client) => client.query(`SELECT * FROM ${table}`)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("profile_access_distinguishes_members_only_from_none", async () => {
    const p = await population();
    const member = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true });
    const access = (viewer: string | null, id: string) =>
      scalarAs<string>(db.pool, viewer, "SELECT profile_access($1)::text AS value", [id]);

    expect(await access(null, p.publicPro)).toBe("visible");
    expect(await access(null, p.membersPro)).toBe("members_only");
    expect(await access(null, p.hiddenPro)).toBe("none");
    expect(await access(null, p.pendingPro)).toBe("none");
    expect(await access(null, p.adminHiddenMembersPro)).toBe("none");
    expect(await access(null, p.student)).toBe("none");
    expect(await access(null, "00000000-0000-4000-8000-000000000000")).toBe("none");

    expect(await access(member, p.membersPro)).toBe("visible");
    expect(await access(member, p.pendingPro)).toBe("none");
    expect(await access(member, p.hiddenPro)).toBe("none");

    expect(await access(p.pendingPro, p.pendingPro)).toBe("visible");
    expect(await access(admin, p.hiddenPro)).toBe("visible");

    // Signed in but unverified: a members-only profile still answers members_only.
    const unverified = await makePerson(db.pool, { verified: false, kind: null, approval: "pending" });
    expect(await access(unverified, p.membersPro)).toBe("members_only");
  });

  it("account_deletions_owner_and_admin_read_only", async () => {
    const owner = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const other = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true });
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'hidden')`,
        [owner],
      ),
    );
    const count = (viewer: string | null) =>
      scalarAs<number>(db.pool, viewer, "SELECT count(*)::int AS value FROM account_deletions");
    expect(await count(owner)).toBe(1);
    expect(await count(admin)).toBe(1);
    expect(await count(other)).toBe(0);
    expect(await count(null)).toBe(0);
    await expect(
      asUser(db.pool, owner, (client) => client.query("UPDATE account_deletions SET canceled_at = now()")),
    ).rejects.toThrow(/permission denied/);

    // At most one open deletion per member.
    await expect(
      asSystem(db.pool, (client) =>
        client.query(
          `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
           VALUES ($1, now(), 'hidden')`,
          [owner],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
