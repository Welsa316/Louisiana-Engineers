import pg from "pg";
import { env } from "../env";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * One connection pool per process. The pool connects as the database owner;
 * request transactions switch to the non-bypassing `app_user` role (Task 4's
 * `withUser`), and only jobs, the auth module and the seed stay as the owner.
 */
export function createPool(connectionString: string, options: Partial<pg.PoolConfig> = {}): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...options,
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });
  return pool;
}

let shared: Pool | undefined;

/** The process-wide pool for `DATABASE_URL`, created on first use. */
export function getPool(): Pool {
  if (!shared) shared = createPool(env.DATABASE_URL);
  return shared;
}

/**
 * Replaces the process-wide pool. The test harness points it at the
 * worktree's test database so `withUser` and `withSystem` reach it; nothing
 * else calls this.
 */
export function setPool(pool: Pool | undefined): void {
  shared = pool;
}

export async function closePool(): Promise<void> {
  if (!shared) return;
  const pool = shared;
  shared = undefined;
  await pool.end();
}
