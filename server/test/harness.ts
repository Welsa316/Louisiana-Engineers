import pg from "pg";
import { env } from "../src/env";
import { createPool, type Pool, type PoolClient } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";

/**
 * Test database helpers. Each agent (worktree) gets its own database named
 * after WORKTREE_ID so parallel runs never share state; within a run, test
 * files execute one at a time (see vitest.config.ts).
 */
export const WORKTREE_ID = process.env.WORKTREE_ID ?? "local";

/**
 * Tables filled by migrations rather than by tests. `truncateAll` leaves them
 * alone; later schema tasks add theirs here.
 */
export const MIGRATION_SEEDED_TABLES: string[] = ["schema_migrations", "config"];

export interface TestDb {
  pool: Pool;
  url: string;
  name: string;
  close(): Promise<void>;
}

export function testDbName(): string {
  return `mest_test_${WORKTREE_ID.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()}`;
}

function testBaseUrl(): string {
  const base = env.DATABASE_URL_TEST;
  if (!base) throw new Error("DATABASE_URL_TEST is not set; see .env.example");
  return base;
}

/**
 * Drops and recreates the worktree's test database from the maintenance
 * connection, runs every migration, and returns a pool connected to it.
 */
export async function createTestDb(): Promise<TestDb> {
  const name = testDbName();
  const maintenance = new URL(testBaseUrl());
  maintenance.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(testBaseUrl());
  url.pathname = `/${name}`;
  const pool = createPool(url.toString(), { max: 5 });
  await runMigrations(pool);
  return {
    pool,
    url: url.toString(),
    name,
    close: () => pool.end(),
  };
}

/**
 * Runs `fn` in one transaction as the non-bypassing `app_user` role with
 * `app.user_id` set to `userId` (empty for an anonymous visitor), the same
 * shape as the API's `withUser`. Commits on success, rolls back on throw.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE app_user");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` in one transaction as the table owner (bypasses RLS), the shape
 * of the API's `withSystem`, for arranging test data.
 */
export async function asSystem<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Empties every table in `public` except the migration-seeded ones and any
 * named in `keep`. Call between tests that share a database.
 */
export async function truncateAll(pool: Pool, keep: string[] = []): Promise<void> {
  const skip = new Set([...MIGRATION_SEEDED_TABLES, ...keep]);
  const result = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const tables = result.rows.map((row) => row.tablename).filter((name) => !skip.has(name));
  if (tables.length === 0) return;
  await pool.query(`TRUNCATE ${tables.map((name) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
