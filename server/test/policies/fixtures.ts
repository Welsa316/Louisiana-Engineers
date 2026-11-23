import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../../src/db/pool";
import { asSystem, asUser } from "../harness";

/**
 * Arranges `users` and `profiles` rows as the table owner, the way the auth
 * module and the seed do, so policy tests can then read them as `app_user`.
 */
export interface PersonOptions {
  email?: string;
  verified?: boolean;
  kind?: "student" | "professional" | null;
  approval?: "pending" | "approved" | "declined";
  visibility?: "public" | "members" | "hidden";
  adminHidden?: boolean;
  anonymized?: boolean;
  suspended?: boolean;
  deleted?: boolean;
  admin?: boolean;
  firstName?: string;
  lastName?: string;
}

export async function makePerson(pool: Pool, options: PersonOptions = {}): Promise<string> {
  const id = randomUUID();
  await asSystem(pool, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, suspended_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        options.deleted ? null : (options.email ?? `${id}@example.test`),
        options.verified === false ? null : new Date(),
        options.suspended ? new Date() : null,
        options.deleted ? new Date() : null,
      ],
    );
    await client.query(
      `INSERT INTO profiles (id, first_name, last_name, kind, approval_state, visibility, admin_hidden_at, anonymized_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        options.firstName ?? "Test",
        options.lastName ?? `Person ${id.slice(0, 8)}`,
        options.kind === undefined ? "professional" : options.kind,
        options.approval ?? "approved",
        options.visibility ?? "public",
        options.adminHidden ? new Date() : null,
        options.anonymized ? new Date() : null,
      ],
    );
    if (options.admin) {
      await client.query("INSERT INTO admin_roles (profile_id) VALUES ($1)", [id]);
    }
  });
  return id;
}

/** Profile ids `userId` (null for a visitor) can read, sorted. */
export async function visibleProfileIds(pool: Pool, userId: string | null): Promise<string[]> {
  return asUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>("SELECT id FROM profiles ORDER BY id");
    return result.rows.map((row) => row.id);
  });
}

/** One scalar from a query run as `userId`. */
export async function scalarAs<T>(pool: Pool, userId: string | null, sql: string, params: unknown[] = []): Promise<T> {
  return asUser(pool, userId, async (client: PoolClient) => {
    const result = await client.query<{ value: T }>(sql, params);
    return result.rows[0].value;
  });
}

export function sorted(ids: string[]): string[] {
  return [...ids].sort();
}
