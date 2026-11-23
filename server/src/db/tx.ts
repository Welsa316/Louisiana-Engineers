import type pg from "pg";
import { getPool, getRequestPool, type Pool, type PoolClient } from "./pool";

/**
 * One transaction's connection. Services receive a `Db`, never a pool, so
 * every statement they run belongs to the transaction `withUser` or
 * `withSystem` opened for them.
 */
export interface Db {
  /** The rows of a parameterized query. */
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Exactly one row, or throws. */
  one<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T>;
  /** Zero or one row; throws on more than one. */
  maybeOne<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
  /** The underlying client, for the rare caller that needs `rowCount` or a cursor. */
  readonly client: PoolClient;
}

export function wrapClient(client: PoolClient): Db {
  return {
    client,
    async query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query<T>(sql, params);
      return result.rows;
    },
    async one<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T> {
      const result = await client.query<T>(sql, params);
      if (result.rows.length !== 1) throw new Error(`expected one row, got ${result.rows.length}`);
      return result.rows[0];
    },
    async maybeOne<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await client.query<T>(sql, params);
      if (result.rows.length > 1) throw new Error(`expected at most one row, got ${result.rows.length}`);
      const row: T | undefined = result.rows[0];
      return row ?? null;
    },
  };
}

/**
 * Runs `fn` inside BEGIN/COMMIT on one pooled connection, rolling back and
 * rethrowing when it throws. `setup` runs first, inside the transaction.
 * A connection whose rollback fails is destroyed rather than returned to the
 * pool, so a broken session can never serve the next request.
 */
async function transaction<T>(
  pool: Pool,
  setup: (client: PoolClient) => Promise<void>,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    try {
      await client.query("BEGIN");
    } catch (error) {
      // A connection that cannot start a transaction is not reused.
      broken = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    try {
      await setup(client);
      const result = await fn(wrapClient(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw error;
    }
  } finally {
    client.release(broken);
  }
}

/**
 * Every API request's database work. The transaction runs as the
 * non-bypassing `app_user` role, so Row Level Security applies, with
 * `app.user_id` set to the acting user (empty for an anonymous visitor, which
 * `app_uid()` reads as null). Both settings are transaction-local and end
 * with the COMMIT or ROLLBACK.
 */
export function withUser<T>(userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  // The request pool logs in as mest_request, so a RESET ROLE inside `fn`
  // cannot leave app_user's rights.
  return transaction(getRequestPool(), async (client) => {
    await client.query("SET LOCAL ROLE app_user");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
  }, fn);
}

/**
 * A transaction as the table owner, which bypasses Row Level Security.
 * Allowed only in jobs (`server/src/jobs/*`), the pre-identity auth module
 * (`server/src/auth/*`), the seed and the `admin-grant` CLI.
 */
export function withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return transaction(getPool(), async () => {}, fn);
}
