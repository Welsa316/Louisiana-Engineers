import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, asSystem, asUser, type TestDb } from "../harness";
import { migrationsDir, runMigrations } from "../../src/db/migrate";

const open: TestDb[] = [];

afterAll(async () => {
  for (const db of open) await db.close();
});

describe("migrations", () => {
  it("migrations_apply_and_app_uid_scopes", async () => {
    const db = await createTestDb();
    open.push(db);

    // Every migration file on disk is recorded exactly once, 0001 among them.
    const files = (await readdir(migrationsDir())).filter((name) => name.endsWith(".sql")).sort();
    const recorded = await db.pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(recorded.rows.map((row) => row.name)).toEqual(files);
    expect(files).toContain("0001_extensions_and_roles.sql");

    // A second run applies nothing and changes nothing.
    const again = await runMigrations(db.pool);
    expect(again.applied).toEqual([]);
    expect(again.total).toBe(files.length);

    // The extensions and the application role exist.
    const extensions = await db.pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pgcrypto') ORDER BY extname",
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual(["citext", "pgcrypto"]);

    // app_uid() is null outside a user transaction and the acting id inside one.
    const outside = await db.pool.query<{ uid: string | null }>("SELECT app_uid() AS uid");
    expect(outside.rows[0].uid).toBeNull();

    const inSystem = await asSystem(db.pool, async (client) => {
      const r = await client.query<{ uid: string | null; role: string }>(
        "SELECT app_uid() AS uid, current_user AS role",
      );
      return r.rows[0];
    });
    expect(inSystem.uid).toBeNull();
    expect(inSystem.role).not.toBe("app_user");

    const userId = randomUUID();
    const inUser = await asUser(db.pool, userId, async (client) => {
      const r = await client.query<{ uid: string | null; role: string }>(
        "SELECT app_uid() AS uid, current_user AS role",
      );
      return r.rows[0];
    });
    expect(inUser.uid).toBe(userId);
    expect(inUser.role).toBe("app_user");

    const anonymous = await asUser(db.pool, null, async (client) => {
      const r = await client.query<{ uid: string | null }>("SELECT app_uid() AS uid");
      return r.rows[0].uid;
    });
    expect(anonymous).toBeNull();

    // The setting does not leak out of the transaction.
    const after = await db.pool.query<{ uid: string | null }>("SELECT app_uid() AS uid");
    expect(after.rows[0].uid).toBeNull();

    // Dropping and recreating the database leaves the cluster-wide role in
    // place, and the migration still applies cleanly on top of it.
    await db.close();
    open.pop();
    const second = await createTestDb();
    open.push(second);
    const role = await second.pool.query<{ rolname: string; rolcanlogin: boolean }>(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'app_user'",
    );
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0].rolcanlogin).toBe(false);
    const recordedAgain = await second.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );
    expect(Number(recordedAgain.rows[0].count)).toBe(files.length);
  });
});
