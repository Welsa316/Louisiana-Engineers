import pg from "pg";
import { env } from "../env";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * Two pools per process. The owner pool (`DATABASE_URL`) runs migrations,
 * jobs, the pre-identity auth module and the seed. The request pool logs in
 * as `mest_request`, a plain member of `app_user`, so SQL in a request can
 * never `RESET ROLE` back to the owner or a superuser.
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
let sharedRequest: Pool | undefined;

/** The login role the request pool uses (created by migration 0001). */
export const REQUEST_ROLE = "mest_request";

/**
 * The request pool's connection string: `REQUEST_DATABASE_URL` when set
 * (required in production, where the role has a password), otherwise
 * `DATABASE_URL` with the user swapped to `mest_request` and no password,
 * which works with local trust authentication.
 */
export function requestUrlFor(ownerUrl: string, explicit?: string): string {
  if (explicit) return explicit;
  const url = new URL(ownerUrl);
  url.username = REQUEST_ROLE;
  url.password = "";
  return url.toString();
}

/** The process-wide pool for `DATABASE_URL`, created on first use. */
export function getPool(): Pool {
  if (!shared) shared = createPool(env.DATABASE_URL);
  return shared;
}

/** The process-wide request pool, created on first use. */
export function getRequestPool(): Pool {
  if (!sharedRequest) {
    if (env.NODE_ENV === "production" && !env.REQUEST_DATABASE_URL) {
      throw new Error("REQUEST_DATABASE_URL is required in production (role mest_request; see the runbook)");
    }
    sharedRequest = createPool(requestUrlFor(env.DATABASE_URL, env.REQUEST_DATABASE_URL));
  }
  return sharedRequest;
}

/** Replaces the process-wide request pool (test harness only). */
export function setRequestPool(pool: Pool | undefined): void {
  sharedRequest = pool;
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
  const pools = [shared, sharedRequest].filter((p): p is Pool => p !== undefined);
  shared = undefined;
  sharedRequest = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}
