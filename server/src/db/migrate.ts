import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "./pool";
import { serverRoot } from "../paths";

/** Cluster-wide advisory lock so two processes never migrate at once. */
const MIGRATION_LOCK = 7231;

export interface MigrationResult {
  /** File names applied by this run, in order. */
  applied: string[];
  /** Rows in schema_migrations after the run. */
  total: number;
}

export function migrationsDir(): string {
  return resolve(serverRoot(), "migrations");
}

/**
 * Applies every `server/migrations/*.sql` file not yet recorded, in name
 * order, each inside its own transaction, under `pg_advisory_lock(7231)`.
 * Forward-only: there are no down migrations.
 */
export async function runMigrations(pool: Pool, dir: string = migrationsDir()): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const done = new Set(
        (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((row) => row.name),
      );
      for (const name of files) {
        if (done.has(name)) continue;
        const sql = await readFile(resolve(dir, name), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
          });
        }
        applied.push(name);
      }
      const total = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
      return { applied, total: Number(total.rows[0].count) };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}
