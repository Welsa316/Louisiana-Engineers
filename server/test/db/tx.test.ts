import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem, withUser } from "../../src/db/tx";
import { createTestDb, type TestDb } from "../harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  // A scratch table owned by the migrating role; default privileges let
  // app_user write to it, and no policy is involved.
  await db.pool.query("CREATE TABLE tx_probe (id serial PRIMARY KEY, note text NOT NULL)");
});

afterAll(async () => {
  await db.pool.query("DROP TABLE IF EXISTS tx_probe");
  await db.close();
});

async function probeNotes(): Promise<string[]> {
  const result = await db.pool.query<{ note: string }>("SELECT note FROM tx_probe ORDER BY id");
  return result.rows.map((row) => row.note);
}

/** Who every idle connection in the pool acts as once a transaction is over. */
async function idleIdentities(): Promise<{ role: string; uid: string | null }[]> {
  const clients = await Promise.all(Array.from({ length: 5 }, () => db.pool.connect()));
  try {
    return await Promise.all(
      clients.map(async (client) => {
        const r = await client.query<{ role: string; uid: string | null }>(
          "SELECT current_user AS role, app_uid() AS uid",
        );
        return r.rows[0];
      }),
    );
  } finally {
    for (const client of clients) client.release();
  }
}

describe("transaction helpers", () => {
  it("with_user_sets_role_and_uid_and_rolls_back_on_throw", async () => {
    const owner = (await db.pool.query<{ role: string }>("SELECT current_user AS role")).rows[0].role;
    expect(owner).not.toBe("app_user");

    // Inside withUser the transaction runs as app_user with app.user_id set.
    const userId = randomUUID();
    const inside = await withUser(userId, (tx) =>
      tx.one<{ role: string; uid: string | null }>("SELECT current_user AS role, app_uid() AS uid"),
    );
    expect(inside.role).toBe("app_user");
    expect(inside.uid).toBe(userId);

    // An anonymous visitor is app_user with no id.
    const anon = await withUser(null, (tx) =>
      tx.one<{ role: string; uid: string | null }>("SELECT current_user AS role, app_uid() AS uid"),
    );
    expect(anon).toEqual({ role: "app_user", uid: null });

    // Success commits.
    await withUser(userId, (tx) => tx.query("INSERT INTO tx_probe (note) VALUES ($1)", ["kept"]));
    expect(await probeNotes()).toEqual(["kept"]);

    // A throw after a write rolls the write back and rethrows the same error.
    const boom = new Error("boom");
    await expect(
      withUser(userId, async (tx) => {
        await tx.query("INSERT INTO tx_probe (note) VALUES ($1)", ["discarded"]);
        const seen = await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM tx_probe");
        expect(seen.n).toBe(2); // visible inside its own transaction
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await probeNotes()).toEqual(["kept"]);

    // A failing statement (Postgres aborts the transaction) also rolls back.
    await expect(
      withUser(userId, async (tx) => {
        await tx.query("INSERT INTO tx_probe (note) VALUES ($1)", ["also discarded"]);
        await tx.query("INSERT INTO tx_probe (note) VALUES (NULL)");
      }),
    ).rejects.toThrow(/null value/);
    expect(await probeNotes()).toEqual(["kept"]);

    // Neither the role nor the user id survives onto a pooled connection.
    for (const idle of await idleIdentities()) {
      expect(idle).toEqual({ role: owner, uid: null });
    }

    // Two concurrent users each see only their own id.
    const [a, b] = [randomUUID(), randomUUID()];
    const seen = await Promise.all(
      [a, b].map((id) =>
        withUser(id, async (tx) => {
          await tx.query("SELECT pg_sleep(0.05)");
          return (await tx.one<{ uid: string }>("SELECT app_uid() AS uid")).uid;
        }),
      ),
    );
    expect(seen).toEqual([a, b]);
  });

  it("with_system_runs_as_owner_and_rolls_back_on_throw", async () => {
    const owner = (await db.pool.query<{ role: string }>("SELECT current_user AS role")).rows[0].role;
    const inside = await withSystem((tx) =>
      tx.one<{ role: string; uid: string | null }>("SELECT current_user AS role, app_uid() AS uid"),
    );
    expect(inside).toEqual({ role: owner, uid: null });

    await db.pool.query("TRUNCATE tx_probe");
    await withSystem((tx) => tx.query("INSERT INTO tx_probe (note) VALUES ('system')"));
    await expect(
      withSystem(async (tx) => {
        await tx.query("INSERT INTO tx_probe (note) VALUES ('gone')");
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(await probeNotes()).toEqual(["system"]);
  });

  it("db_one_and_maybe_one_enforce_row_counts", async () => {
    await db.pool.query("TRUNCATE tx_probe");
    await db.pool.query("INSERT INTO tx_probe (note) VALUES ('a'), ('b')");

    await withSystem(async (tx) => {
      const rows = await tx.query<{ note: string }>("SELECT note FROM tx_probe ORDER BY id");
      expect(rows).toEqual([{ note: "a" }, { note: "b" }]);

      expect(await tx.one<{ note: string }>("SELECT note FROM tx_probe WHERE note = $1", ["a"])).toEqual({
        note: "a",
      });
      await expect(tx.one("SELECT note FROM tx_probe WHERE note = 'z'")).rejects.toThrow(/expected one row, got 0/);
      await expect(tx.one("SELECT note FROM tx_probe")).rejects.toThrow(/expected one row, got 2/);

      expect(await tx.maybeOne("SELECT note FROM tx_probe WHERE note = 'z'")).toBeNull();
      expect(await tx.maybeOne<{ note: string }>("SELECT note FROM tx_probe WHERE note = 'b'")).toEqual({
        note: "b",
      });
    });
    await expect(withSystem((tx) => tx.maybeOne("SELECT note FROM tx_probe"))).rejects.toThrow(
      /expected at most one row, got 2/,
    );
  });
});
